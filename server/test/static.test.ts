import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { safePath } from '../src/static.ts';

test('шляхи з .. відхиляються', () => {
  // path.resolve, щоб тест працював і на Windows (E:\...), і на Linux (/...)
  const root = path.resolve('dist-for-test');
  assert.equal(safePath(root, '/index.html'), path.join(root, 'index.html'));
  assert.equal(safePath(root, '/assets/a.js'), path.join(root, 'assets', 'a.js'));
  assert.equal(safePath(root, '/../secret'), null);
  assert.equal(safePath(root, '/..%2F..%2Fetc%2Fpasswd'), null);
  assert.equal(safePath(root, '/..%5C..%5Cwindows'), null);
  assert.equal(safePath(root, '/a%00.html'), null);
  assert.equal(safePath(root, '/%E0%A4%A'), null);
});
