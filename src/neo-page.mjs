// ページ内実行レイヤ。全ての Adobe API 呼び出しをログイン済み projectneo.adobe.com
// ページ内の fetch として実行する（=ネイティブアプリの認証コンテキスト）。
// トークンはページ内に留め、サーバ側には一切持ち出さない。
import { CDPSession, findNeoTarget } from './cdp.mjs';

export const NEO_ORIGIN = 'https://projectneo.adobe.com';
export const API_BASE = 'https://project-neo.adobe.io/service/core/api';
export const GRAPHQL = 'https://project-neo.adobe.io/service/core/graphql';
export const API_KEY = 'prd-project-neo';

// 認証セットアップ用のページ内コード。__archToken() を window にインストールし、
// auth.status 確定（CHECKING_STATUS 以外）まで内部で待機する。
const AUTH_SETUP = `(async () => {
  const w = window;
  const install = () => {
    try {
      if (typeof w.__neoReq !== 'function' && Array.isArray(w.webpackChunk_N_E)) {
        w.webpackChunk_N_E.push([['pneoArch' + Math.random().toString(36).slice(2)], {}, (r) => { w.__neoReq = r; }]);
      }
      if (typeof w.__neoReq === 'function' && !w.__neoStore) w.__neoStore = w.__neoReq(26649).y;
    } catch {}
    return !!w.__neoStore;
  };
  for (let i = 0; i < 360 && !install(); i++) await new Promise((r) => setTimeout(r, 250));
  if (!w.__neoStore) return { ok: false, error: 'webpack store unavailable (is a Neo page loaded?)' };
  for (let i = 0; i < 360; i++) {
    const s = w.__neoStore.getState()?.auth?.status;
    if (s && s !== 'CHECKING_STATUS') break;
    await new Promise((r) => setTimeout(r, 250));
  }
  w.__archToken = async () => {
    let t = w.__neoStore.getState()?.auth?.tokenInfo?.token;
    if (!t) { try { t = (await w.__neoReq(92972).A.getAccessTokenAsync())?.token; } catch {} }
    return t;
  };
  const st = w.__neoStore.getState();
  const token = await w.__archToken();
  return { ok: true, status: st?.auth?.status, userUuid: st?.auth?.localUser?.uuid || null, hasToken: !!token };
})()`;

// 各操作で共通するページ内ユーティリティ。
const PAGE_LIB = `
const apiKey = ${JSON.stringify(API_KEY)};
const graphQL = ${JSON.stringify(GRAPHQL)};
const apiBase = ${JSON.stringify(API_BASE)};
const neoFetch = async (path, opts = {}) => {
  const token = await window.__archToken();
  if (!token) throw new Error('access token unavailable (login state?)');
  const headers = { 'authorization': 'Bearer ' + token, 'x-api-key': apiKey, ...(opts.headers || {}) };
  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  return { status: res.status, text };
};
const gql = async (query, variables) => {
  const r = await neoFetch(graphQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  let json = null;
  try { json = JSON.parse(r.text); } catch {}
  if (!json) throw new Error('graphql http ' + r.status);
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
};
`;

const QUERIES = {
  list: `query GetProjects($ownerUserUuid: ID, $limit: Int, $cursor: String, $archived: Boolean) {
    projects(ownerUserUuid: $ownerUserUuid, limit: $limit, cursor: $cursor, archived: $archived) {
      metadata { nextCursor totalCount }
      entries { uuid adobeAssetId name imageUrl tags ownerUserUuid insertedAt updatedAt public featured archived
        documentFrameSize { width height }
        owner { adobeUserId adobeUserDisplayName } }
    }
  }`,
  create: `mutation CreateProjectWithDocument($name: String!, $document: String!, $tags: [String!], $public: Boolean) {
    createProjectWithDocument(name: $name, document: $document, tags: $tags, public: $public) {
      uuid adobeAssetId name tags ownerUserUuid insertedAt updatedAt public
      documentFrameSize { width height }
    }
  }`,
};

const OPS = {
  listProjects: `(async () => {
    ${PAGE_LIB}
    const ownerUserUuid = __neoStore.getState()?.auth?.localUser?.uuid;
    const entries = [];
    let cursor = null;
    for (let i = 0; i < 50; i++) {
      const d = await gql(${JSON.stringify(QUERIES.list)}, { ownerUserUuid, limit: 100, cursor, archived: false });
      entries.push(...(d.projects.entries || []));
      cursor = d.projects.metadata?.nextCursor || null;
      if (!cursor || !(d.projects.entries || []).length) break;
    }
    return { ok: true, entries };
  })()`,
  downloadDocument: `(async () => {
    ${PAGE_LIB}
    const r = await neoFetch(apiBase + '/projects/' + ARG.uuid + '/document');
    if (r.status !== 200) return { ok: false, status: r.status };
    return { ok: true, status: r.status, text: r.text };
  })()`,
  fetchThumb: `(async () => {
    const res = await fetch(ARG.url);
    if (!res.ok) return { ok: false, status: res.status };
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { ok: true, b64: btoa(bin), type: res.headers.get('content-type') || 'image/jpeg' };
  })()`,
  createProject: `(async () => {
    ${PAGE_LIB}
    const d = await gql(${JSON.stringify(QUERIES.create)}, { name: ARG.name, document: ARG.document, tags: ARG.tags, public: false });
    return { ok: true, created: d.createProjectWithDocument };
  })()`,
  uploadThumb: `(async () => {
    ${PAGE_LIB}
    const res = await neoFetch(apiBase + '/projects/' + ARG.uuid + '/presigned-image-url');
    if (res.status !== 200) return { ok: false, stage: 'presign', status: res.status };
    const url = res.text.trim();
    const bin = atob(ARG.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes]));
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1e2128'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0);
    const jpg = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/jpg', 'Cache-Control': 'no-cache, no-store, must-revalidate' }, body: jpg });
    return { ok: put.status === 200, status: put.status };
  })()`,
};

export class NeoPage {
  constructor(cdpBase) {
    this.cdpBase = cdpBase;
    this.session = null;
    this.targetId = null;
  }

  async _connect() {
    const t = await findNeoTarget(this.cdpBase, NEO_ORIGIN);
    this.targetId = t.id;
    this.session = await new CDPSession(t.webSocketDebuggerUrl).connect();
  }

  async ensure() {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (!this.session || this.session.ws?.readyState !== 1 || this.targetId == null) await this._connect();
        const auth = await this.session.evaluate(AUTH_SETUP, { timeoutMs: 120000 });
        if (auth?.ok && auth.hasToken) return auth;
        if (auth?.ok === false) throw new Error(auth.error);
        throw new Error('not authenticated — open ' + NEO_ORIGIN + ' and sign in (status=' + auth?.status + ')');
      } catch (e) {
        this._reset();
        if (attempt === 2) throw e;
      }
    }
  }

  _reset() {
    try { this.session?.close(); } catch {}
    this.session = null;
    this.targetId = null;
  }

  async eval(op, arg) {
    const expr = OPS[op].replace(/\bARG\b/g, JSON.stringify(arg === undefined ? null : arg));
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.ensure();
        return await this.session.evaluate(expr);
      } catch (e) {
        this._reset();
        if (attempt === 1) throw e;
      }
    }
  }

  async listProjects() { return (await this.eval('listProjects')).entries; }
  async downloadDocument(uuid) { return this.eval('downloadDocument', { uuid }); }
  async fetchThumb(url) { return this.eval('fetchThumb', { url }); }
  async createProject({ name, document, tags = ['lifestyle', 'tech'] }) {
    const r = await this.eval('createProject', { name, document, tags });
    return r.created;
  }
  async uploadThumb({ uuid, b64 }) { return this.eval('uploadThumb', { uuid, b64 }); }

  close() { this._reset(); }
}
