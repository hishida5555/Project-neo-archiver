// 共通ユーティリティ。
export const safeName = (s) => String(s || 'project').replace(/[^\w.-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'project';

// 既存名との重複を回避。"name" → "name (2)" → "name (3)"…
export function uniqueName(desired, taken) {
  const base = String(desired || 'Project').trim() || 'Project';
  if (!taken.has(base)) { taken.add(base); return base; }
  for (let i = 2; ; i++) {
    const cand = `${base} (${i})`;
    if (!taken.has(cand)) { taken.add(cand); return cand; }
  }
}

export const json = (res, code, obj, headers = {}) => {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b), ...headers }).end(b);
};

export const readBody = (req, limit = 4 * 1024 * 1024) => new Promise((resolve, reject) => {
  let d = '';
  let n = 0;
  req.on('data', (c) => {
    n += c.length;
    if (n > limit) { reject(new Error('body too large')); req.destroy(); return; }
    d += c;
  });
  req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});
