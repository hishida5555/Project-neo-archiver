// ページ内実行レイヤ。全ての Adobe API 呼び出しをログイン済み projectneo.adobe.com
// ページ内の fetch として実行する（=ネイティブアプリの認証コンテキスト）。
// トークンはページ内に留め、サーバ側には一切持ち出さない。
// ページ内コード本体は neo-ops.mjs（拡張版と共有）を参照。
import { CDPSession, findNeoTarget } from './cdp.mjs';
import { NEO_ORIGIN, opExpr } from './neo-ops.mjs';

export { NEO_ORIGIN };

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
        const auth = await this.session.evaluate(opExpr('auth'), { timeoutMs: 120000 });
        if (auth?.ok && auth.hasToken) return auth;
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
    const expr = opExpr(op, arg);
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

  async listProjects() {
    const r = await this.eval('list');
    if (!r.ok) throw new Error(r.error || 'list failed');
    this.lastListDiag = r.diag || null;
    return r.entries;
  }
  async downloadDocument(uuid) { return this.eval('download', { uuid }); }
  async fetchThumb(url) { return this.eval('thumb', { url }); }
  async createProject({ name, document, tags = ['lifestyle', 'tech'] }) {
    const r = await this.eval('create', { name, document, tags });
    return r.created;
  }
  async uploadThumb({ uuid, b64 }) { return this.eval('uploadThumb', { uuid, b64 }); }

  close() { this._reset(); }
}
