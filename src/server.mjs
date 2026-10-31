// Neo archiver — ローカル管理サーバ (127.0.0.1 のみ)。
// 設計:
//  - Adobe API 呼び出しは全て CDP 経由でログイン済み Neo ページ内で実行（neo-page.mjs）。
//    本サーバはトークンを一切保持しない。
//  - GUI 同一オリジン配信のみ。CORS ヘッダは付与しない（クロスオリジン利用を想定しない）。
//  - CSRF/DNSリバインディング対策: Host ヘッダ検証 + Sec-Fetch-Site 検証。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NeoPage, NEO_ORIGIN } from './neo-page.mjs';
import { listTargets } from './cdp.mjs';
import { Library } from './library.mjs';
import { json, readBody, safeName, uniqueName } from './util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(arg('port', 8130));
const CDP = arg('cdp', 'http://127.0.0.1:9225');
const LIB_DIR = path.resolve(arg('lib', path.join(root, 'library')));

if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) { console.error('invalid port'); process.exit(2); }

const lib = new Library(LIB_DIR);
const neo = new NeoPage(CDP);
let chain = Promise.resolve();
const serialize = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };

// ---- API ハンドラ ----
async function apiStatus(body) {
  try {
    // lazy=1: ポーリング用。Neoタブが無い場合は生成せず未接続を返す
    if (body?.lazy) {
      const targets = await listTargets(CDP);
      if (!targets.some((t) => t.type === 'page' && String(t.url).startsWith(NEO_ORIGIN))) {
        return { ok: false, cdp: true, error: 'no Neo tab' };
      }
    }
    const auth = await neo.ensure();
    return { ok: true, cdp: true, auth };
  } catch (e) {
    return { ok: false, cdp: false, error: String(e.message || e) };
  }
}
async function apiProjects() {
  const entries = await neo.listProjects();
  return { ok: true, entries };
}
async function apiDownload(body) {
  const items = Array.isArray(body.items) ? body.items.slice(0, 500) : [];
  const results = [];
  for (const it of items) {
    try {
      if (!/^[\w-]{8,64}$/.test(it.uuid || '')) throw new Error('invalid uuid');
      const v = await neo.downloadDocument(it.uuid);
      if (!v.ok) throw new Error('document status ' + v.status);
      JSON.parse(v.text);
      let b64 = null, type = null;
      if (it.imageUrl) {
        const t = await neo.fetchThumb(it.imageUrl);
        if (t.ok) { b64 = t.b64; type = t.type; }
      }
      const saved = lib.saveDocument({ uuid: it.uuid, name: it.name, text: v.text, imageB64: b64, imageType: type });
      results.push({ uuid: it.uuid, ok: true, file: saved.file, thumb: saved.thumb });
    } catch (e) {
      results.push({ uuid: it.uuid, ok: false, error: String(e.message || e) });
    }
  }
  return { ok: true, results };
}
async function apiLibrary() {
  return { ok: true, entries: lib.list() };
}
async function apiUpload(body) {
  const files = Array.isArray(body.files) ? body.files.slice(0, 500) : [];
  const remote = await neo.listProjects();
  // アップロード先アカウント（meta.json の uploads[] に記録してポップオーバーに出す）
  let account = null;
  try { const a = await neo.ensure(); account = a.displayName || a.userUuid || null; } catch {}
  const taken = new Set(remote.map((e) => e.name));
  const meta = lib.meta();
  const results = [];
  for (const f of files) {
    try {
      const p = lib.filePath(f);
      if (!p || !fs.existsSync(p)) throw new Error('file not found: ' + f);
      const doc = fs.readFileSync(p, 'utf8');
      JSON.parse(doc);
      const requested = (meta.entries[f] && meta.entries[f].name) || f.replace(/\.neo\.json$|\.json$/i, '');
      const name = body.noDedup ? requested : uniqueName(requested, taken);
      const created = await neo.createProject({ name, document: doc });
      let thumbOk = null;
      const m = lib.meta().entries[f];
      if (body.withThumb !== false && m && m.thumb) {
        const tp = lib.thumbPath(m.thumb);
        if (tp && fs.existsSync(tp)) {
          const b64 = fs.readFileSync(tp).toString('base64');
          const r = await neo.uploadThumb({ uuid: created.uuid, b64 }).catch((e) => ({ ok: false, error: String(e) }));
          thumbOk = !!r.ok;
        }
      }
      lib.recordUpload(f, { uuid: created.uuid, name, thumbOk, account });
      results.push({ file: f, ok: true, uuid: created.uuid, name, renamed: name !== requested ? requested : undefined, thumb: thumbOk });
    } catch (e) {
      results.push({ file: f, ok: false, error: String(e.message || e) });
    }
  }
  // 成功があれば Neo ページを再読み込みし、一覧に新規プロジェクトを反映させる
  if (results.some((r) => r.ok)) await neo.eval('reload').catch(() => {});
  return { ok: true, results };
}
async function apiThumb(body) {
  if (!body.b64 || typeof body.b64 !== 'string' || body.b64.length > 48 * 1024 * 1024) throw new Error('b64 required (<=32MB)');
  const name = lib.saveThumb({ file: body.file, uuid: body.uuid, b64: body.b64, type: body.type });
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

const PUBLIC_DIR = path.join(root, 'public');
const staticMap = { '/': 'index.html', '/app.js': 'app.js', '/ui.css': 'ui.css' };

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: " + NEO_ORIGIN,
  "connect-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

const securityHeaders = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    // DNS リバインディング対策: Host は 127.0.0.1 / localhost のみ
    const host = String(req.headers.host || '');
    if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}` && host !== `[::1]:${PORT}`) {
      return json(res, 403, { ok: false, error: 'forbidden' }, securityHeaders);
    }
    // CSRF 対策: ブラウザ発のクロスサイト要求を拒否（同一オリジン/直接アクセスのみ許可）
    const site = String(req.headers['sec-fetch-site'] || '');
    if (site && site !== 'same-origin' && site !== 'none') {
      return json(res, 403, { ok: false, error: 'forbidden (cross-site)' }, securityHeaders);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
      return json(res, 405, { ok: false, error: 'method not allowed' }, securityHeaders);
    }
    const method = req.method === 'HEAD' ? 'GET' : req.method;

    const key = method + ' ' + u.pathname;
    if (api[key]) {
      const body = req.method === 'POST' ? await readBody(req) : Object.fromEntries(u.searchParams);
      const out = await serialize(() => api[key](body));
      return json(res, 200, out, securityHeaders);
    }

    // library/thumb のファイル配信（GET のみ・厳格名検証）
    if (method === 'GET' && (u.pathname.startsWith('/api/library-file/') || u.pathname.startsWith('/api/thumb/'))) {
      const isThumb = u.pathname.startsWith('/api/thumb/');
      const name = decodeURIComponent(u.pathname.slice(isThumb ? 11 : 18));
      const p = isThumb ? lib.thumbPath(name) : lib.filePath(name);
      if (!p || !fs.existsSync(p) || !fs.statSync(p).isFile()) {
        return json(res, 404, { ok: false, error: 'not found' }, securityHeaders);
      }
      const st = fs.statSync(p);
      return res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'content-length': st.size, ...securityHeaders }).end(fs.readFileSync(p));
    }

    // 静的配信（同一オリジン）
    if (method === 'GET' && staticMap[u.pathname]) {
      const p = path.join(PUBLIC_DIR, staticMap[u.pathname]);
      if (fs.existsSync(p)) {
        return res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', ...securityHeaders }).end(fs.readFileSync(p));
      }
    }
    json(res, 404, { ok: false, error: 'not found' }, securityHeaders);
  } catch (e) {
    json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) }, securityHeaders);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(JSON.stringify({ ok: true, url: `http://127.0.0.1:${PORT}`, cdp: CDP, lib: LIB_DIR }));
});
