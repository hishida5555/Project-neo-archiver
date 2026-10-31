import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeName, uniqueName } from '../src/util.mjs';

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
