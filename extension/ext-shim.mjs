// public/app.js を無改修で動かすための互換レイヤ。
//  - fetch('/api/*') を ext-api.mjs のローカル実装へ振り分け
//  - <img src="/api/thumb/..."> と <a href="/api/library-file/..."> は fetch を
//    経由しないため、blob URL への差し替えを別途行う
//  - ヘッダの "Library folder" ボタンで File System Access のフォルダを選択
import { handle } from './ext-api.mjs';
import * as lib from './ext-lib.mjs';

// ---- fetch シム ----
const origFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  if (url.startsWith('/api/')) return handle(url, init || {});
  return origFetch(input, init);
};

// ---- サムネイル画像の差し替え ----
const thumbCache = new Map();
async function swapThumb(img) {
  const m = (img.getAttribute('src') || '').match(/^\/api\/thumb\/(.+)$/);
  if (!m) return;
  const name = decodeURIComponent(m[1]);
  try {
    let u = thumbCache.get(name);
    if (!u) {
      const blob = await lib.thumbBlob(name);
      if (!blob) return;
      u = URL.createObjectURL(blob);
      thumbCache.set(name, u);
    }
    img.src = u;
  } catch {}
}
new MutationObserver((muts) => {
  for (const mut of muts) {
    for (const n of mut.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'IMG') swapThumb(n);
      n.querySelectorAll?.('img[src^="/api/thumb/"]').forEach(swapThumb);
    }
  }
}).observe(document.body, { childList: true, subtree: true });

// ---- library-file ダウンロードリンクの差し替え ----
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="/api/library-file/"]');
  if (!a) return;
  e.preventDefault();
  const name = decodeURIComponent(a.getAttribute('href').slice('/api/library-file/'.length));
  lib.readFile(name).then((text) => {
    if (text == null) throw new Error('file not found: ' + name);
    const u = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const t = document.createElement('a');
    t.href = u;
    t.download = a.getAttribute('download') || name;
    t.click();
    setTimeout(() => URL.revokeObjectURL(u), 10000);
  }).catch((err) => {
    const log = document.getElementById('log');
    if (log) log.textContent += `[${new Date().toLocaleTimeString()}] save: ${err.message}\n`;
  });
}, true);

// ---- ライブラリフォルダ選択 UI ----
// 未設定/未許可のときだけ強調表示にし、設定済みならフォルダ名をボタンに表示する。
const shimLog = (s) => {
  const log = document.getElementById('log');
  if (log) log.textContent += `[${new Date().toLocaleTimeString()}] ${s}\n`;
};
const syncLibUI = async () => {
  const btn = document.getElementById('btnLibDir');
  if (!btn) return;
  const h = await lib.storedDir();
  let ok = false;
  try { ok = h && (await h.queryPermission({ mode: 'readwrite' })) === 'granted'; } catch {}
  btn.classList.toggle('accent', !ok);
  btn.textContent = ok ? h.name : 'Select Local Library Folder';
  btn.title = h ? `Library: ${h.name}` : 'Choose the local library folder';
};
document.getElementById('btnLibDir')?.addEventListener('click', async () => {
  try {
    if (typeof window.showDirectoryPicker !== 'function') throw new Error('File System Access API is not available in this browser');
    const h = await lib.pickDir();
    shimLog(`library: ${h.name}`);
  } catch (e) {
    if (e?.name === 'AbortError') { await syncLibUI(); return; } // ユーザキャンセル
    // ピッカーが開けない環境向けに、既存ハンドルの権限再要求を試みる
    try {
      const h = await lib.ensureDir(true);
      if (h) { shimLog(`library: ${h.name} (permission restored)`); await syncLibUI(); return; }
    } catch {}
    shimLog(`library: ${e.message || e}`);
  }
  await syncLibUI();
});
syncLibUI();
