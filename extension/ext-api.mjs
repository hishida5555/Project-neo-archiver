// /api/* エンドポイントの拡張版実装（src/server.mjs のハンドラと同等の振る舞い）。
// Adobe API 呼び出しは chrome.scripting.executeScript で Neo タブの MAIN world に
// neoOp を注入して実行し、ファイル保存は File System Access API (ext-lib.mjs) を使う。
import { neoOp, OP_CTX, NEO_ORIGIN } from '../src/neo-ops.mjs';
import { uniqueName } from '../src/util.mjs';
import * as lib from './ext-lib.mjs';

let chain = Promise.resolve();
const serialize = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function neoTab(create = true) {
  const tabs = await chrome.tabs.query({ url: NEO_ORIGIN + '/*' });
  if (tabs.length) return tabs[0];
  if (!create) throw new Error('Neo tab not found');
  return chrome.tabs.create({ url: NEO_ORIGIN + '/my-projects', active: false });
}

// Neo タブ内で neoOp を実行。タブ読み込み中の注入失敗に備えてリトライする。
async function runOp(op, arg) {
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      const tab = await neoTab();
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: neoOp,
        args: [op, arg === undefined ? null : arg, OP_CTX],
      });
      return r?.result;
    } catch (e) {
      lastErr = e;
      await sleep(700);
    }
  }
  throw lastErr;
}

const blobToB64 = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
};

// ---- API ハンドラ（server.mjs と同じ応答形）----
async function apiStatus(body) {
  try {
    // lazy=1: ポーリング用。Neoタブが無い場合は生成せず未接続を返す
    if (body?.lazy) await neoTab(false);
    const auth = await runOp('auth');
    return { ok: true, cdp: true, auth };
  } catch (e) {
    return { ok: false, cdp: false, error: String(e.message || e) };
  }
}
async function apiProjects() {
  const r = await runOp('list');
  if (!r.ok) throw new Error(r.error || 'list failed');
  return { ok: true, entries: r.entries };
}
async function apiDownload(body) {
  const items = Array.isArray(body.items) ? body.items.slice(0, 500) : [];
  const results = [];
  for (const it of items) {
    try {
      if (!/^[\w-]{8,64}$/.test(it.uuid || '')) throw new Error('invalid uuid');
      const v = await runOp('download', { uuid: it.uuid });
      if (!v.ok) throw new Error('document status ' + v.status);
      JSON.parse(v.text);
      let b64 = null, type = null;
      if (it.imageUrl) {
        const t = await runOp('thumb', { url: it.imageUrl });
        if (t.ok) { b64 = t.b64; type = t.type; }
      }
      const saved = await lib.saveDocument({ uuid: it.uuid, name: it.name, text: v.text, imageB64: b64, imageType: type });
      results.push({ uuid: it.uuid, ok: true, file: saved.file, thumb: saved.thumb });
    } catch (e) {
      results.push({ uuid: it.uuid, ok: false, error: String(e.message || e) });
    }
  }
  return { ok: true, results };
}
async function apiLibrary() {
  return { ok: true, entries: await lib.list(), dirSet: !!(await lib.ensureDir()) };
}
async function apiUpload(body) {
  const files = Array.isArray(body.files) ? body.files.slice(0, 500) : [];
  const lr = await runOp('list');
  if (!lr.ok) throw new Error(lr.error || 'list failed');
  const remote = lr.entries;
  // アップロード先アカウント（uploads[] に記録してポップオーバーに出す）
  let account = null;
  try { const a = await runOp('auth'); account = a.displayName || a.userUuid || null; } catch {}
  const taken = new Set(remote.map((e) => e.name));
  const meta = await lib.meta();
  const results = [];
  for (const f of files) {
    try {
      const doc = await lib.readFile(f);
      if (doc == null) throw new Error('file not found: ' + f);
      JSON.parse(doc);
      const requested = (meta.entries[f] && meta.entries[f].name) || f.replace(/\.neo\.json$|\.json$/i, '');
      const name = body.noDedup ? requested : uniqueName(requested, taken);
      const created = (await runOp('create', { name, document: doc, tags: ['lifestyle', 'tech'] })).created;
      let thumbOk = null;
      const m = await lib.meta();
      if (body.withThumb !== false && m.entries[f]?.thumb) {
        const blob = await lib.thumbBlob(m.entries[f].thumb);
        if (blob) {
          const r = await runOp('uploadThumb', { uuid: created.uuid, b64: await blobToB64(blob) }).catch((e) => ({ ok: false, error: String(e) }));
          thumbOk = !!r.ok;
        }
      }
      await lib.recordUpload(f, { uuid: created.uuid, name, thumbOk, account });
      results.push({ file: f, ok: true, uuid: created.uuid, name, renamed: name !== requested ? requested : undefined, thumb: thumbOk });
    } catch (e) {
      results.push({ file: f, ok: false, error: String(e.message || e) });
    }
  }
  // 成功があれば Neo タブを再読み込みし、一覧に新規プロジェクトを反映させる
  if (results.some((r) => r.ok)) await runOp('reload').catch(() => {});
  return { ok: true, results };
}
async function apiThumb(body) {
  if (!body.b64 || typeof body.b64 !== 'string' || body.b64.length > 48 * 1024 * 1024) throw new Error('b64 required (<=32MB)');
  const name = await lib.saveThumb({ file: body.file, uuid: body.uuid, b64: body.b64, type: body.type });
  return { ok: true, thumb: name };
}

const api = {
  'GET /api/status': apiStatus,
  'GET /api/projects': apiProjects,
  'POST /api/download': apiDownload,
  'GET /api/library': apiLibrary,
  'POST /api/upload': apiUpload,
  'POST /api/thumb': apiThumb,
};

const jres = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

// fetch シムからのエントリポイント。server.mjs のルーティングと同等。
export async function handle(url, init = {}) {
  const u = new URL(url, 'http://x');
  const method = (init.method || 'GET').toUpperCase();
  try {
    const key = method + ' ' + u.pathname;
    if (api[key]) {
      const body = method === 'POST' ? JSON.parse(init.body || '{}') : Object.fromEntries(u.searchParams);
      const out = await serialize(() => api[key](body));
      return jres(out);
    }
    if (method === 'GET' && u.pathname.startsWith('/api/thumb/')) {
      const blob = await lib.thumbBlob(decodeURIComponent(u.pathname.slice(11)));
      return blob ? new Response(blob, { headers: { 'content-type': blob.type || 'image/jpeg' } }) : jres({ ok: false, error: 'not found' }, 404);
    }
    if (method === 'GET' && u.pathname.startsWith('/api/library-file/')) {
      const text = await lib.readFile(decodeURIComponent(u.pathname.slice(18)));
      return text != null ? new Response(text, { headers: { 'content-type': 'application/json' } }) : jres({ ok: false, error: 'not found' }, 404);
    }
    return jres({ ok: false, error: 'not found' }, 404);
  } catch (e) {
    return jres({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
  }
}
