const $ = (id) => document.getElementById(id);
const NEO_ORIGIN = 'https://projectneo.adobe.com';
const absUrl = (u) => (u && u.startsWith('/') ? NEO_ORIGIN + u : u);

const state = { remote: [], local: [], busy: false };

const log = (s) => {
  const el = $('log');
  el.textContent += `[${new Date().toLocaleTimeString()}] ${s}\n`;
  el.scrollTop = el.scrollHeight;
};

const api = async (path, body) => {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await res.json();
  if (!j.ok && j.error) throw new Error(j.error);
  return j;
};

const short = (u) => (u ? u.slice(0, 8) + '…' : '-');
const fmtDate = (s) => {
  if (!s) return '-';
  const d = new Date(s);
  const days = (Date.now() - d.getTime()) / 864e5;
  if (days < 1) return d.toTimeString().slice(0, 5);
  if (days < 30) return Math.round(days) + 'd ago';
  return s.slice(0, 10);
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---- タブ切り替え ----
const TABS = [['btnTabDl', 'paneDl'], ['btnTabUl', 'paneUl']];
function activateTab(i) {
  TABS.forEach(([b, p], j) => {
    const on = i === j;
    $(b).classList.toggle('tabs__tab--active', on);
    $(b).setAttribute('aria-selected', String(on));
    $(b).tabIndex = on ? 0 : -1;
    $(p).hidden = !on;
  });
}
TABS.forEach(([b], i) => $(b).addEventListener('click', () => activateTab(i)));
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const cur = TABS.findIndex(([b]) => $(b).getAttribute('aria-selected') === 'true');
  const n = (cur + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
  activateTab(n);
  $(TABS[n][0]).focus();
});

// ---- トースト通知 ----
function toast(msg, kind = 'info') {
  const t = el('div', `toast toast--${kind}`, msg);
  $('toasts').append(t);
  setTimeout(() => { t.classList.add('toast--out'); setTimeout(() => t.remove(), 400); }, 3600);
}

// ---- 進行バー・カード内ステータス ----
function setProg(id, done, total) {
  const w = $(id);
  if (total == null) { w.hidden = true; return; }
  w.hidden = false;
  w.querySelector('i').style.width = (total ? Math.round((done / total) * 100) : 0) + '%';
  w.querySelector('.prog__num').textContent = `${done}/${total}`;
}

// カードの状態表示: queued(待機) / working(処理中バー) / done(完了) / fail(失敗)
const CARD_LABEL = { queued: 'queued…', working: '', done: 'done', fail: 'failed' };
function cardState(sel, key, st) {
  const li = document.querySelector(`${sel} [data-key="${CSS.escape(key)}"]`);
  if (!li) return;
  li.classList.remove('card--queued', 'card--working', 'card--done', 'card--fail');
  if (st) li.classList.add('card--' + st);
  const s = li.querySelector('.card__status span');
  if (s) s.textContent = CARD_LABEL[st] || '';
}

function thumb(url, alt) {
  if (url) {
    const img = document.createElement('img');
    img.className = 'card__thumb';
    img.src = url;
    img.alt = alt || '';
    img.loading = 'lazy';
    img.onerror = () => img.replaceWith(thumb(null, alt));
    return img;
  }
  return el('div', 'card__thumb card__thumb--empty', 'no preview');
}

function syncButtons() {
  const rSel = state.remote.some((e) => e._sel);
  const lSel = state.local.some((e) => e._sel);
  $('btnDlSel').disabled = state.busy || !rSel;
  $('btnDlAll').disabled = state.busy || !state.remote.length;
  $('btnUlSel').disabled = state.busy || !lSel;
  $('btnRemoteReload').disabled = state.busy;
  $('btnLocalReload').disabled = state.busy;
}

// カード本体クリックで選択トグル（内部のボタン/リンク/ラベル操作は除外）
function selectable(li, e, onChange) {
  li.addEventListener('click', (ev) => {
    if (ev.target.closest('button, a, input, label')) return;
    e._sel = !e._sel;
    li.classList.toggle('card--selected', e._sel);
    const cb = li.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = e._sel;
    if (onChange) onChange();
  });
}

function cardStatusEl() {
  const st = el('div', 'card__status');
  st.append(el('i'), el('span'));
  return st;
}

function renderRemote() {
  const ul = $('remoteList');
  ul.textContent = '';
  if (!state.remote.length) {
    ul.append(el('li', 'cards__empty', 'No remote projects — sign in to Neo, then Reload.'));
    return;
  }
  for (const e of state.remote) {
    const li = el('li', 'card' + (e._sel ? ' card--selected' : ''));
    li.dataset.key = e.uuid;
    const chk = el('label', 'card__check');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!e._sel;
    cb.addEventListener('change', () => { e._sel = cb.checked; li.classList.toggle('card--selected', e._sel); syncButtons(); });
    chk.append(cb, el('span', 'card__name', e.name || '(untitled)'));
    li.append(chk, thumb(absUrl(e.imageUrl), e.name), el('div', 'card__meta', `updated ${fmtDate(e.updatedAt)}`));
    const row = el('div', 'card__row');
    const dl1 = el('button', '', 'Download');
    dl1.addEventListener('click', () => download([e]));
    row.append(dl1);
    li.append(row, cardStatusEl());
    selectable(li, e, syncButtons);
    ul.append(li);
  }
  syncButtons();
}

function renderLocal() {
  const ul = $('localList');
  ul.textContent = '';
  if (!state.local.length) {
    ul.append(el('li', 'cards__empty', 'Library is empty. Download projects from the Download tab.'));
    return;
  }
  for (const e of state.local) {
    const li = el('li', 'card' + (e._sel ? ' card--selected' : ''));
    li.dataset.key = e.file;
    const chk = el('label', 'card__check');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!e._sel;
    cb.addEventListener('change', () => { e._sel = cb.checked; li.classList.toggle('card--selected', e._sel); syncButtons(); });
    chk.append(cb, el('span', 'card__name', e.name));
    li.append(chk, thumb(e.thumb ? `/api/thumb/${e.thumb}` : null, e.name));
    const ups = e.uploads.length ? ` · ${e.uploads.length} upload${e.uploads.length > 1 ? 's' : ''}` : '';
    li.append(el('div', 'card__meta', `${fmtDate(e.savedAt)}${ups}`));
    const row = el('div', 'card__row');
    const ul1 = el('button', '', 'Upload');
    ul1.addEventListener('click', () => upload([e.file]));
    row.append(ul1);
    li.append(row, cardStatusEl());
    selectable(li, e, syncButtons);
    ul.append(li);
  }
  syncButtons();
}

async function refreshAuth() {
  const b = $('authLamp');
  b.className = 'lamp lamp--checking';
  b.title = 'checking…';
  try {
    const s = await api('/api/status');
    if (s.auth?.signedIn && s.auth.hasToken) {
      b.className = 'lamp lamp--ok';
      b.title = `authenticated — ${s.auth.displayName || s.auth.userUuid} — click to re-check`;
    } else if (s.auth?.hasToken) {
      // トークンは取れるが localUser が無い = 匿名/サインアウト状態
      b.className = 'lamp lamp--warn';
      b.title = `anonymous session (${s.auth.status || '?'}) — sign in to Neo — click to re-check`;
    } else {
      b.className = 'lamp lamp--ng';
      b.title = (s.cdp ? 'not authenticated — sign in to Neo' : 'Neo tab not connected') + ' — click to re-check';
      if (s.error) log('status: ' + s.error);
    }
    return s;
  } catch (e) {
    b.className = 'lamp lamp--ng';
    b.title = 'unreachable — click to re-check';
    log('status: ' + e.message);
    return null;
  }
}

async function refreshRemote() {
  try {
    const j = await api('/api/projects');
    state.remote = j.entries;
    renderRemote();
    log(`remote: ${j.entries.length} projects`);
  } catch (e) {
    log('projects: ' + e.message);
  }
}

async function refreshLocal() {
  try {
    const j = await api('/api/library');
    state.local = j.entries;
    renderLocal();
    log(`library: ${j.entries.length} files`);
  } catch (e) {
    log('library: ' + e.message);
  }
}

// 一括ダウンロード: 項目単位で呼び出し、進行・成否を逐次反映する
async function download(items) {
  if (state.busy || !items.length) return;
  state.busy = true;
  syncButtons();
  log(`download: ${items.length} item(s)`);
  setProg('dlProg', 0, items.length);
  for (const it of items) cardState('#remoteList', it.uuid, 'queued');
  let ok = 0, fail = 0;
  for (const it of items) {
    cardState('#remoteList', it.uuid, 'working');
    let okItem = false;
    try {
      const j = await api('/api/download', { items: [{ uuid: it.uuid, name: it.name, imageUrl: absUrl(it.imageUrl) }] });
      const r = j.results[0];
      okItem = !!r.ok;
      log(`  ${r.ok ? 'OK' : 'FAIL'} ${short(it.uuid)} ${r.file || r.error}`);
    } catch (e) {
      log(`  FAIL ${short(it.uuid)} ${e.message}`);
    }
    if (okItem) ok++; else fail++;
    cardState('#remoteList', it.uuid, okItem ? 'done' : 'fail');
    setProg('dlProg', ok + fail, items.length);
  }
  setProg('dlProg', 0, null);
  toast(`${ok} downloaded${fail ? ` · ${fail} failed` : ''}`, fail ? 'fail' : 'ok');
  state.busy = false;
  await refreshLocal();
}

// 一括アップロード: 各ファイルは常に新規プロジェクトとして作成される
async function upload(files) {
  if (state.busy || !files.length) return;
  state.busy = true;
  syncButtons();
  log(`upload: ${files.length} item(s) — each becomes a NEW project`);
  setProg('ulProg', 0, files.length);
  for (const f of files) cardState('#localList', f, 'queued');
  let ok = 0, fail = 0;
  for (const f of files) {
    cardState('#localList', f, 'working');
    let okItem = false;
    try {
      const j = await api('/api/upload', { files: [f] });
      const r = j.results[0];
      okItem = !!r.ok;
      log(`  ${r.ok ? 'OK' : 'FAIL'} ${r.file} → ${r.ok ? `${r.name || ''} ${r.uuid}${r.renamed ? ` (renamed from ${r.renamed})` : ''}${r.thumb === true ? ' +thumb' : r.thumb === false ? ' (thumb failed)' : ''}` : r.error}`);
    } catch (e) {
      log(`  FAIL ${f} ${e.message}`);
    }
    if (okItem) ok++; else fail++;
    cardState('#localList', f, okItem ? 'done' : 'fail');
    setProg('ulProg', ok + fail, files.length);
  }
  setProg('ulProg', 0, null);
  toast(`${ok} uploaded${fail ? ` · ${fail} failed` : ''}`, fail ? 'fail' : 'ok');
  state.busy = false;
  await refreshLocal();
  await refreshRemote();
}

$('authLamp').addEventListener('click', refreshAuth);
$('btnRemoteReload').addEventListener('click', refreshRemote);
$('btnLocalReload').addEventListener('click', refreshLocal);
$('btnLocalAll').addEventListener('click', () => { for (const e of state.local) e._sel = true; renderLocal(); });
$('btnLocalNone').addEventListener('click', () => { for (const e of state.local) e._sel = false; renderLocal(); });
$('btnDlSel').addEventListener('click', () => download(state.remote.filter((e) => e._sel)));
$('btnDlAll').addEventListener('click', () => download(state.remote));
$('btnUlSel').addEventListener('click', () => upload(state.local.filter((e) => e._sel).map((e) => e.file)));

(async () => {
  const s = await refreshAuth();
  if (s?.auth?.signedIn && s.auth.hasToken) await refreshRemote();
  await refreshLocal();
})();
