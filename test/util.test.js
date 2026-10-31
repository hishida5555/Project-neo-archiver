import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeName, uniqueName } from '../src/util.mjs';
import { Library } from '../src/library.mjs';

test('safeName sanitizes', () => {
  assert.equal(safeName('birdie (copy)'), 'birdie-copy');
  assert.equal(safeName('a/b\\c:d'), 'a-b-c-d');
  assert.equal(safeName('  '), 'project');
  assert.equal(safeName('x'.repeat(200)).length <= 80, true);
});

test('uniqueName dedups', () => {
  const t = new Set(['a', 'a (2)']);
  assert.equal(uniqueName('a', t), 'a (3)');
  assert.equal(uniqueName('b', t), 'b');
  assert.equal(uniqueName('a', t), 'a (4)'); // taken 更新を反映
});

test('library save/list/meta', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
  const lib = new Library(dir);
  const r = lib.saveDocument({ uuid: 'u-1', name: 'my (proj)', text: '{"a":1}' });
  assert.equal(r.file, 'my-proj-u-1.neo.json');
  const list = lib.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'my (proj)');
  assert.equal(list[0].uuid, 'u-1');
  assert.ok(list[0].sha256);
  lib.recordUpload(r.file, { uuid: 'n-1', name: 'my (proj)', thumbOk: true });
  assert.equal(lib.list()[0].uploads.length, 1);
  lib.saveThumb({ file: r.file, b64: Buffer.from('x').toString('base64'), type: 'image/jpeg' });
  assert.equal(lib.list()[0].thumb, 'u-1.jpg');
  assert.equal(lib.list()[0].thumbCustom, true);
});

test('library path traversal rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
  const lib = new Library(dir);
  assert.equal(lib.filePath('../evil.json'), null);
  assert.equal(lib.filePath('a/b.json'), null);
  assert.equal(lib.filePath('..'), null);
  assert.equal(lib.thumbPath('../x.jpg'), null);
});
