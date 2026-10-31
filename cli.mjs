// Project Neo Archiver CLI。GUI サーバを介さず CDP → ページ内実行で直接操作する。
// 使い方:
//   node cli.mjs status
//   node cli.mjs list
//   node cli.mjs download --all | --uuid <uuid> [--name <name>]
//   node cli.mjs upload <file...> [--no-thumb] [--no-dedup]
// オプション: --cdp <url>（既定 http://127.0.0.1:9225） --lib <dir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NeoPage, NEO_ORIGIN } from './src/neo-page.mjs';
import { Library } from './src/library.mjs';
import { uniqueName } from './src/util.mjs';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes('--' + n);
const cmd = args.find((a) => !a.startsWith('--') && !['list', 'status', 'download', 'upload'].includes(a) ? false : true) || args[0];
const CDP = arg('cdp', 'http://127.0.0.1:9225');
const LIB_DIR = path.resolve(arg('lib', path.join(path.dirname(fileURLToPath(import.meta.url)), 'library')));

const neo = new NeoPage(CDP);
const lib = new Library(LIB_DIR);
const die = (m, code = 1) => { console.error(m); process.exit(code); };

async function main() {
  const command = args[0];
  if (command === 'status') {
    const a = await neo.ensure();
    console.log(JSON.stringify({ ok: true, auth: a }));
    return;
  }
  if (command === 'list') {
    const entries = await neo.listProjects();
    for (const e of entries) console.log(`${e.uuid}\t${e.name}\t${e.updatedAt}`);
    console.error(`(${entries.length} projects)`);
    return;
  }
  if (command === 'download') {
    let items = [];
    if (has('all')) {
      const entries = await neo.listProjects();
      items = entries.map((e) => ({ uuid: e.uuid, name: e.name, imageUrl: e.imageUrl }));
    } else if (arg('uuid')) {
      items = [{ uuid: arg('uuid'), name: arg('name', null), imageUrl: null }];
    } else die('usage: download --all | --uuid <uuid>');
    for (const it of items) {
      const v = await neo.downloadDocument(it.uuid);
      if (!v.ok) { console.error(`FAIL ${it.uuid} status ${v.status}`); continue; }
      let b64 = null, type = null;
      if (it.imageUrl) {
        const url = it.imageUrl.startsWith('/') ? NEO_ORIGIN + it.imageUrl : it.imageUrl;
        const t = await neo.fetchThumb(url).catch(() => null);
        if (t && t.ok) { b64 = t.b64; type = t.type; }
      }
      const name = it.name || it.uuid;
      const s = lib.saveDocument({ uuid: it.uuid, name, text: v.text, imageB64: b64, imageType: type });
      console.log(`OK ${it.uuid} -> ${s.file}${s.thumb ? ' (+thumb)' : ''}`);
    }
    return;
  }
  if (command === 'upload') {
    const files = args.slice(1).filter((a) => !a.startsWith('--') && a !== arg('cdp') && a !== arg('lib'));
    if (!files.length) die('usage: upload <file...>');
    const remote = await neo.listProjects();
    const taken = new Set(remote.map((e) => e.name));
    const meta = lib.meta();
    for (const f of files) {
      const p = path.resolve(f);
      const base = path.basename(f);
      const doc = fs.readFileSync(p, 'utf8');
      JSON.parse(doc);
      const requested = (meta.entries[base] && meta.entries[base].name) || base.replace(/\.neo\.json$|\.json$/i, '');
      const name = has('no-dedup') ? requested : uniqueName(requested, taken);
      try {
        const created = await neo.createProject({ name, document: doc });
        let thumbOk = null;
        const m = meta.entries[base];
        if (!has('no-thumb') && m && m.thumb) {
          const tp = lib.thumbPath(m.thumb);
          if (tp && fs.existsSync(tp)) thumbOk = !!(await neo.uploadThumb({ uuid: created.uuid, b64: fs.readFileSync(tp).toString('base64') })).ok;
        }
        if (meta.entries[base]) lib.recordUpload(base, { uuid: created.uuid, name, thumbOk });
        console.log(`OK ${base} -> ${name} ${created.uuid}${thumbOk ? ' (+thumb)' : ''}`);
      } catch (e) {
        console.error(`FAIL ${base}: ${e.message}`);
      }
    }
    return;
  }
  die('usage: cli.mjs status|list|download --all|--uuid X|upload <file...>');
}

main().catch((e) => die(String(e.stack || e))).finally(() => neo.close());
