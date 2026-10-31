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
const fmtDate = (s) => (s ? s.slice(0, 16).replace('T', ' ') : '-');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
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

function renderRemote() {
  const ul = $('remoteList');
  ul.textContent = '';
  for (const e of state.remote) {
    const li = el('li', 'card' + (e._sel ? ' card--selected' : ''));
    const chk = el('label', 'card__check');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!e._sel;
    cb.addEventListener('change', () => { e._sel = cb.checked; li.classList.toggle('card--selected', e._sel); syncButtons(); });
    chk.append(cb, el('span', 'card__name', e.name || '(untitled)'));
    li.append(chk, thumb(absUrl(e.imageUrl), e.name), el('div', 'card__meta', `${short(e.uuid)} updated ${fmtDate(e.updatedAt)}`));
    const row = el('div', 'card__row');
    const dl1 = el('button', '', 'Download');
    dl1.addEventListener('click', () => download([e]));
    const studio = el('a', '', 'Open in Neo');
    studio.href = `${NEO_ORIGIN}/studio/${e.uuid}`;
    studio.target = '_blank';
    studio.rel = 'noopener';
    row.append(dl1, studio);
    li.append(row);
    ul.append(li);
  }
  syncButtons();
}

function renderLocal() {
  const ul = $('localList');
  ul.textContent = '';
  for (const e of state.local) {
    const li = el('li', 'card' + (e._sel ? ' card--selected' : ''));
    const chk = el('label', 'card__check');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!e._sel;
    cb.addEventListener('change', () => { e._sel = cb.checked; li.classList.toggle('card--selected', e._sel); syncButtons(); });
    chk.append(cb, el('span', 'card__name', e.name));
    li.append(chk, thumb(e.thumb ? `/api/thumb/${e.thumb}` : null, e.name));
    const ups = e.uploads.length ? ` · ${e.uploads.length} upload${e.uploads.length > 1 ? 's' : ''}` : '';
    li.append(el('div', 'card__meta', `${short(e.uuid)} ${e.bytes}B ${fmtDate(e.savedAt)}${ups}`));
    const row = el('div', 'card__row');
    const ul1 = el('button', '', 'Upload');
    ul1.addEventListener('click', () => upload([e.file]));
    const dl1 = el('a', '', 'Save .json');
    dl1.href = `/api/library-file/${encodeURIComponent(e.file)}`;
    dl1.setAttribute('download', e.file);
    row.append(ul1, dl1);
    li.append(row);
    ul.append(li);
  }
  syncButtons();
}

async function refreshAuth() {
  const b = $('authState');
  b.className = 'badge badge--muted';
  b.textContent = 'checking…';
  try {
    const s = await api('/api/status');
    if (s.auth && s.auth.hasToken) {
      b.className = 'badge badge--ok';
      b.textContent = `authenticated ${short(s.auth.userUuid)}`;
    } else {
      b.className = 'badge badge--ng';
      b.textContent = s.cdp ? 'not authenticated — sign in to Neo' : 'CDP not connected';
      if (s.error) log('status: ' + s.error);
    }
    return s;
  } catch (e) {
    b.className = 'badge badge--ng';
    b.textContent = 'server error';
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

async function download(items) {
  if (state.busy || !items.length) return;
  state.busy = true;
  syncButtons();
  log(`download: ${items.length} item(s)`);
  try {
    const j = await api('/api/download', { items: items.map((e) => ({ uuid: e.uuid, name: e.name, imageUrl: absUrl(e.imageUrl) })) });
    for (const r of j.results) log(`  ${r.ok ? 'OK' : 'FAIL'} ${short(r.uuid)} ${r.file || r.error}`);
  } catch (e) {
    log('download: ' + e.message);
  } finally {
    state.busy = false;
    await refreshLocal();
  }
}

async function upload(files) {
  if (state.busy || !files.length) return;
  state.busy = true;
  syncButtons();
  log(`upload: ${files.length} item(s) — each becomes a NEW project`);
  try {
    const j = await api('/api/upload', { files });
    for (const r of j.results) log(`  ${r.ok ? 'OK' : 'FAIL'} ${r.file} → ${r.ok ? `${r.name || ''} ${r.uuid}${r.renamed ? ` (renamed from ${r.renamed})` : ''}${r.thumb === true ? ' +thumb' : r.thumb === false ? ' (thumb failed)' : ''}` : r.error}`);
  } catch (e) {
    log('upload: ' + e.message);
  } finally {
    state.busy = false;
  }
}

$('btnRefreshAuth').addEventListener('click', refreshAuth);
$('btnRemoteReload').addEventListener('click', refreshRemote);
$('btnLocalReload').addEventListener('click', refreshLocal);
$('btnRemoteAll').addEventListener('click', () => { for (const e of state.remote) e._sel = true; renderRemote(); });
$('btnRemoteNone').addEventListener('click', () => { for (const e of state.remote) e._sel = false; renderRemote(); });
$('btnLocalAll').addEventListener('click', () => { for (const e of state.local) e._sel = true; renderLocal(); });
$('btnLocalNone').addEventListener('click', () => { for (const e of state.local) e._sel = false; renderLocal(); });
$('btnDlSel').addEventListener('click', () => download(state.remote.filter((e) => e._sel)));
$('btnDlAll').addEventListener('click', () => download(state.remote));
$('btnUlSel').addEventListener('click', () => upload(state.local.filter((e) => e._sel).map((e) => e.file)));

(async () => {
  const s = await refreshAuth();
  if (s && s.auth && s.auth.hasToken) await refreshRemote();
  await refreshLocal();
})();
