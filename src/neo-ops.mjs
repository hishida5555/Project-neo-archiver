// ページ内実行オペレーションの共有定義。neoOp() は自己完結関数で、
// 実行手段を選ばない:
//   CDP 経路:   opExpr() で式化し Runtime.evaluate に投入（neo-page.mjs）
//   拡張経路:   chrome.scripting.executeScript({ world:'MAIN', func: neoOp, args })
// トークンはページ内に留め、どちらの経路でも外部に持ち出さない。
export const NEO_ORIGIN = 'https://projectneo.adobe.com';
export const API_BASE = 'https://project-neo.adobe.io/service/core/api';
export const GRAPHQL = 'https://project-neo.adobe.io/service/core/graphql';
export const API_KEY = 'prd-project-neo';
export const OP_CTX = { apiKey: API_KEY, graphQL: GRAPHQL, apiBase: API_BASE, neoOrigin: NEO_ORIGIN };

// CDP Runtime.evaluate 用の式を生成。neoOp.toString() をページ内で即時呼び出しする。
export const opExpr = (op, arg) =>
  `(${neoOp.toString()})(${JSON.stringify(op)},${JSON.stringify(arg === undefined ? null : arg)},${JSON.stringify(OP_CTX)})`;

// ページ内で実行されるオペレーション本体。モジュール外の識別子を参照しないこと
// （toString() でページ側へ転送されるため）。戻り値は structured clone 可能なものに限る。
export async function neoOp(op, arg, C) {
  const w = window;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // webpack store (__neoStore) と __archToken() をページにインストールし、
  // auth.status 確定（CHECKING_STATUS 以外）まで待機する。
  const install = async () => {
    const tryInstall = () => {
      try {
        if (typeof w.__neoReq !== 'function' && Array.isArray(w.webpackChunk_N_E)) {
          w.webpackChunk_N_E.push([['pneoArch' + Math.random().toString(36).slice(2)], {}, (r) => { w.__neoReq = r; }]);
        }
        if (typeof w.__neoReq === 'function' && !w.__neoStore) w.__neoStore = w.__neoReq(26649).y;
      } catch {}
      return !!w.__neoStore;
    };
    for (let i = 0; i < 360 && !tryInstall(); i++) await sleep(250);
    if (!w.__neoStore) throw new Error('webpack store unavailable (is a Neo page loaded?)');
    for (let i = 0; i < 360; i++) {
      const s = w.__neoStore.getState()?.auth?.status;
      if (s && s !== 'CHECKING_STATUS') break;
      await sleep(250);
    }
    w.__archToken = async () => {
      let t = w.__neoStore.getState()?.auth?.tokenInfo?.token;
      if (!t) { try { t = (await w.__neoReq(92972).A.getAccessTokenAsync())?.token; } catch {} }
      return t;
    };
  };

  const neoFetch = async (path, opts = {}) => {
    const token = await w.__archToken();
    if (!token) throw new Error('access token unavailable (login state?)');
    const headers = { 'authorization': 'Bearer ' + token, 'x-api-key': C.apiKey, ...(opts.headers || {}) };
    const res = await fetch(path, { ...opts, headers });
    return { status: res.status, text: await res.text() };
  };

  const gql = async (query, variables) => {
    const r = await neoFetch(C.graphQL, {
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

  switch (op) {
    case 'auth': {
      await install();
      const st = w.__neoStore.getState();
      const token = await w.__archToken();
      const lu = st?.auth?.localUser;
      return {
        ok: true, status: st?.auth?.status,
        userUuid: lu?.uuid || null,
        displayName: lu?.displayName || lu?.name || lu?.email || null,
        hasToken: !!token,
        // トークンがあっても localUser が無ければ匿名/サインアウト状態とみなす
        signedIn: !!lu?.uuid,
      };
    }
    case 'list': {
      await install();
      const ownerUserUuid = w.__neoStore.getState()?.auth?.localUser?.uuid;
      // 未サインインで ownerUserUuid=null のまま投げると公開一覧が返り、
      // 自分のプロジェクトのように見えてしまうため拒否する
      if (!ownerUserUuid) return { ok: false, error: 'not signed in to Neo (anonymous session)' };
      const entries = [];
      let cursor = null;
      for (let i = 0; i < 50; i++) {
        const d = await gql(QUERIES.list, { ownerUserUuid, limit: 100, cursor, archived: false });
        entries.push(...(d.projects.entries || []));
        cursor = d.projects.metadata?.nextCursor || null;
        if (!cursor || !(d.projects.entries || []).length) break;
      }
      return { ok: true, entries };
    }
    case 'download': {
      await install();
      const r = await neoFetch(C.apiBase + '/projects/' + arg.uuid + '/document');
      if (r.status !== 200) return { ok: false, status: r.status };
      return { ok: true, status: r.status, text: r.text };
    }
    case 'thumb': {
      // サムネイル URL は認証不要のため install はスキップ（画像 CDN への素の fetch）
      const res = await fetch(arg.url);
      if (!res.ok) return { ok: false, status: res.status };
      const bytes = new Uint8Array(await res.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return { ok: true, b64: btoa(bin), type: res.headers.get('content-type') || 'image/jpeg' };
    }
    case 'create': {
      await install();
      const d = await gql(QUERIES.create, { name: arg.name, document: arg.document, tags: arg.tags, public: false });
      return { ok: true, created: d.createProjectWithDocument };
    }
    case 'uploadThumb': {
      await install();
      const r = await neoFetch(C.apiBase + '/projects/' + arg.uuid + '/presigned-image-url');
      if (r.status !== 200) return { ok: false, stage: 'presign', status: r.status };
      const url = r.text.trim();
      const bin = atob(arg.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([bytes]));
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#1e2128'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0);
      const jpg = await new Promise((r2) => c.toBlob(r2, 'image/jpeg', 0.85));
      const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/jpg', 'Cache-Control': 'no-cache, no-store, must-revalidate' }, body: jpg });
      return { ok: put.status === 200, status: put.status };
    }
    case 'reload': {
      // アップロード反映を Neo 一覧に表示させるためページを再読み込みする
      try { w.location.reload(); } catch {}
      return { ok: true };
    }
    default:
      throw new Error('unknown op: ' + op);
  }
}
