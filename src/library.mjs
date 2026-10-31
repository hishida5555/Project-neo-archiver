// library/ ディレクトリ管理。neo.json ファイル + meta.json + thumbs/。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { safeName } from './util.mjs';

export class Library {
  constructor(dir) {
    this.dir = dir;
    this.thumbs = path.join(dir, 'thumbs');
    this.metaPath = path.join(dir, 'meta.json');
    fs.mkdirSync(this.thumbs, { recursive: true });
  }

  meta() {
    try { return JSON.parse(fs.readFileSync(this.metaPath, 'utf8')); } catch { return { entries: {} }; }
  }
  writeMeta(m) { fs.writeFileSync(this.metaPath, JSON.stringify(m, null, 1)); }

  filePath(name) {
    if (!/^[\w.-]+$/.test(name || '')) return null;
    const p = path.join(this.dir, name);
    return p.startsWith(this.dir + path.sep) ? p : null;
  }

  thumbPath(name) {
    if (!/^[\w.-]+$/.test(name || '')) return null;
    const p = path.join(this.thumbs, name);
    return p.startsWith(this.thumbs + path.sep) ? p : null;
  }

  saveDocument({ uuid, name, text, imageB64, imageType }) {
    const fname = `${safeName(name)}-${uuid}.neo.json`;
    const p = this.filePath(fname);
    if (!p) throw new Error('unsafe file name');
    fs.writeFileSync(p, text);
    let thumb = null;
    if (imageB64) {
      const ext = /png/.test(imageType || '') ? '.png' : '.jpg';
      thumb = uuid + ext;
      fs.writeFileSync(path.join(this.thumbs, thumb), Buffer.from(imageB64, 'base64'));
    }
    const m = this.meta();
    const prev = m.entries[fname] || {};
    m.entries[fname] = {
      ...prev,
      uuid, name: name || fname,
      savedAt: new Date().toISOString(),
      bytes: Buffer.byteLength(text),
      sha256: crypto.createHash('sha256').update(text).digest('hex'),
      thumb: thumb || prev.thumb || null,
    };
    this.writeMeta(m);
    return { file: fname, thumb };
  }

  saveThumb({ file, uuid, b64, type }) {
    const m = this.meta();
    if (!uuid && file && m.entries[file]) uuid = m.entries[file].uuid;
    const name = (uuid || 'custom-' + safeName(file || 'thumb')) + (/png/.test(type || '') ? '.png' : '.jpg');
    fs.writeFileSync(path.join(this.thumbs, name), Buffer.from(b64, 'base64'));
    if (file && m.entries[file]) {
      m.entries[file].thumb = name;
      m.entries[file].thumbCustom = true;
      this.writeMeta(m);
    }
    return name;
  }

  recordUpload(file, { uuid, name, thumbOk, account }) {
    const m = this.meta();
    if (!m.entries[file]) return;
    (m.entries[file].uploads ||= []).push({ at: new Date().toISOString(), uuid, name, thumb: thumbOk ?? null, account: account || null });
    this.writeMeta(m);
  }

  list() {
    const m = this.meta();
    return fs.readdirSync(this.dir)
      .filter((f) => f.endsWith('.json') && f !== 'meta.json')
      .map((f) => {
        const e = m.entries[f] || {};
        const st = fs.statSync(path.join(this.dir, f));
        return {
          file: f, name: e.name || f, uuid: e.uuid || null, bytes: st.size,
          savedAt: e.savedAt || st.mtime.toISOString(), sha256: e.sha256 || null,
          thumb: e.thumb || null, thumbCustom: !!e.thumbCustom, uploads: e.uploads || [],
        };
      })
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
}
