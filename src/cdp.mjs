// 最小 CDP (Chrome DevTools Protocol) クライアント。依存ゼロ（Node >=22 のネイティブ WebSocket 使用）。
// Runtime.evaluate でログイン済みページ内の fetch を実行し、Adobe API 呼び出しを
// ネイティブアプリの認証コンテキストに委譲する（トークンはブラウザ外に出さない）。
const DEFAULT_CDP = 'http://127.0.0.1:9225';

export async function listTargets(cdpBase = DEFAULT_CDP) {
  const r = await fetch(cdpBase + '/json/list');
  if (!r.ok) throw new Error('CDP /json/list status ' + r.status);
  return r.json();
}

export async function newTarget(cdpBase, url) {
  const r = await fetch(cdpBase + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  if (!r.ok) throw new Error('CDP /json/new status ' + r.status);
  return r.json();
}

export async function closeTarget(cdpBase, id) {
  await fetch(cdpBase + '/json/close/' + id);
}

export class CDPSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.ws = null;
  }

  connect(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      const to = setTimeout(() => reject(new Error('CDP ws connect timeout')), timeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(to);
        this.ws = ws;
        resolve(this);
      });
      ws.addEventListener('error', (e) => {
        clearTimeout(to);
        reject(new Error('CDP ws error: ' + (e.message || 'connect failed')));
      });
      ws.addEventListener('message', (ev) => this._onMessage(ev));
      ws.addEventListener('close', () => {
        for (const [, p] of this.pending) p.reject(new Error('CDP ws closed'));
        this.pending.clear();
      });
    });
  }

  _onMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id == null) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  }

  send(method, params = {}, timeoutMs = 300000) {
    if (!this.ws || this.ws.readyState !== 1) return Promise.reject(new Error('CDP not connected'));
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(to); resolve(v); },
        reject: (e) => { clearTimeout(to); reject(e); },
      });
      this.ws.send(payload);
    });
  }

  // ページ内で式を評価。例外詳細は error に畳み込む。
  async evaluate(expression, { timeoutMs = 300000 } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    }, timeoutMs);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('page-eval: ' + (d.exception?.description || d.text || 'exception'));
    }
    return r.result?.value;
  }

  close() {
    try { this.ws && this.ws.close(); } catch {}
  }
}

// projectneo.adobe.com 上の page target を探す。無ければ新規作成。
export async function findNeoTarget(cdpBase, origin = 'https://projectneo.adobe.com', url = origin + '/my-projects') {
  const targets = await listTargets(cdpBase);
  const pages = targets.filter((t) => t.type === 'page' && String(t.url).startsWith(origin));
  if (pages.length) return pages[0];
  return newTarget(cdpBase, url);
}
