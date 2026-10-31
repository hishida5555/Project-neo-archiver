// File System Access API による library/ 相当の実装。
// ユーザが選択したフォルダに *.neo.json / thumbs/ / meta.json を書き込む。
// ディレクトリハンドルは IndexedDB に保持し、権限は都度確認する。
import { safeName } from '../src/util.mjs';

let dirHandle = null;

const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open('neo-archiver', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const idbGet = async (k) => {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('kv').objectStore('kv').get(k);
    t.onsuccess = () => res(t.result);
    t.onerror = () => rej(t.error);
  });
};
const idbSet = async (k, v) => {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k);
    t.onsuccess = () => res();
    t.onerror = () => rej(t.error);
  });
};

export async function storedDir() {
  if (!dirHandle) dirHandle = (await idbGet('dir')) || null;
  return dirHandle;
}

export async function pickDir() {
  dirHandle = await window.showDirectoryPicker({ id: 'neo-archiver-library', mode: 'readwrite' });
  await idbSet('dir', dirHandle);
  return dirHandle;
}

// readwrite 権限込みのハンドルを返す。未取得なら null。grant=true はユーザ操作内でのみ呼ぶ。
// queryPermission/requestPermission はハンドルの鮮度やChrome版により失敗し得るため握る。
export async function ensureDir(grant = false) {
  const h = await storedDir();
  if (!h) return null;
  const opts = { mode: 'readwrite' };
  try { if ((await h.queryPermission(opts)) === 'granted') return h; } catch {}
  if (grant && typeof h.requestPermission === 'function') {
    try { if ((await h.requestPermission(opts)) === 'granted') return h; } catch {}
  }
  return null;
}

const nameOk = (n) => /^[\w.-]+$/.test(n || '');

const b64ToBlob = (b64, type = 'application/octet-stream') => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};

const sha256hex = async (text) => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

async function thumbsDir() {
  const h = await ensureDir();
  return h ? h.getDirectoryHandle('thumbs', { create: true }) : null;
}

async function readMeta() {
  const h = await ensureDir();
  if (!h) return { entries: {} };
  try {
    const fh = await h.getFileHandle('meta.json');
    return JSON.parse(await (await fh.getFile()).text());
  } catch { return { entries: {} }; }
}

async function writeMeta(m) {
  const h = await ensureDir();
  if (!h) throw new Error('library folder not accessible');
  const fh = await h.getFileHandle('meta.json', { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(m, null, 1));
  await w.close();
}

export const meta = readMeta;

export async function saveDocument({ uuid, name, text, imageB64, imageType }) {
  const h = await ensureDir();
  if (!h) throw new Error('library folder not set — choose one via "Library folder"');
  const fname = `${safeName(name)}-${uuid}.neo.json`;
  if (!nameOk(fname)) throw new Error('unsafe file name');
  const fh = await h.getFileHandle(fname, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
  let thumb = null;
  if (imageB64) {
    const ext = /png/.test(imageType || '') ? '.png' : '.jpg';
    thumb = uuid + ext;
    const td = await thumbsDir();
    const tf = await td.getFileHandle(thumb, { create: true });
    const tw = await tf.createWritable();
    await tw.write(b64ToBlob(imageB64, imageType));
    await tw.close();
  }
  const m = await readMeta();
  const prev = m.entries[fname] || {};
  m.entries[fname] = {
    ...prev,
    uuid, name: name || fname,
    savedAt: new Date().toISOString(),
    bytes: new Blob([text]).size,
    sha256: await sha256hex(text),
    thumb: thumb || prev.thumb || null,
  };
  await writeMeta(m);
  return { file: fname, thumb };
}

export async function readFile(name) {
  if (!nameOk(name)) return null;
  const h = await ensureDir();
  if (!h) return null;
  try {
    const fh = await h.getFileHandle(name);
    return await (await fh.getFile()).text();
  } catch { return null; }
}

export async function thumbBlob(name) {
  if (!nameOk(name)) return null;
  const h = await ensureDir();
  if (!h) return null;
  try {
    const td = await h.getDirectoryHandle('thumbs');
    const fh = await td.getFileHandle(name);
    return await fh.getFile();
  } catch { return null; }
}

export async function saveThumb({ file, uuid, b64, type }) {
  const m = await readMeta();
  if (!uuid && file && m.entries[file]) uuid = m.entries[file].uuid;
  const name = (uuid || 'custom-' + safeName(file || 'thumb')) + (/png/.test(type || '') ? '.png' : '.jpg');
  const td = await thumbsDir();
  if (!td) throw new Error('library folder not accessible');
  const tf = await td.getFileHandle(name, { create: true });
  const tw = await tf.createWritable();
  await tw.write(b64ToBlob(b64, type));
  await tw.close();
  if (file && m.entries[file]) {
    m.entries[file].thumb = name;
    m.entries[file].thumbCustom = true;
    await writeMeta(m);
  }
  return name;
}

export async function recordUpload(file, { uuid, name, thumbOk, account }) {
  const m = await readMeta();
  if (!m.entries[file]) return;
  (m.entries[file].uploads ||= []).push({ at: new Date().toISOString(), uuid, name, thumb: thumbOk ?? null, account: account || null });
  await writeMeta(m);
}

export async function list() {
  const h = await ensureDir();
  if (!h) return [];
  const m = await readMeta();
  const out = [];
  for await (const [name, handle] of h.entries()) {
    if (handle.kind !== 'file' || !name.endsWith('.json') || name === 'meta.json') continue;
    const f = await handle.getFile();
    const e = m.entries[name] || {};
    out.push({
      file: name, name: e.name || name, uuid: e.uuid || null, bytes: f.size,
      savedAt: e.savedAt || new Date(f.lastModified).toISOString(), sha256: e.sha256 || null,
      thumb: e.thumb || null, thumbCustom: !!e.thumbCustom, uploads: e.uploads || [],
    });
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
