import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { safePath } from '../src/static.ts';

describe('safePath', () => {
  // path.resolve, щоб тест працював і на Windows (E:\...), і на Linux (/...)
  const root = path.resolve('dist-for-test');

  it('звичайні шляхи - всередині root', () => {
    expect(safePath(root, '/index.html')).toBe(path.join(root, 'index.html'));
    expect(safePath(root, '/assets/a.js')).toBe(path.join(root, 'assets', 'a.js'));
  });

  it.each(['/../secret', '/..%2F..%2Fetc%2Fpasswd', '/..%5C..%5Cwindows', '/a%00.html', '/%E0%A4%A'])('%s відхиляється', (url) => {
    expect(safePath(root, url)).toBeNull();
  });
});
