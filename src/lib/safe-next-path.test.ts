import test from 'node:test';
import assert from 'node:assert/strict';
import { safeNextPath } from './safe-next-path';

test('paths of the app pass through, with their query and hash', () => {
  assert.equal(safeNextPath('/contacted'), '/contacted');
  assert.equal(safeNextPath('/contacted?view=reply#c-1'), '/contacted?view=reply#c-1');
  assert.equal(safeNextPath('/invite/abc%20123'), '/invite/abc%20123');
  assert.equal(safeNextPath('%2Fsearch'), '/');
});

test('anything that could leave the app falls back', () => {
  for (const value of ['//evil.com', '//evil.com/path', '/\\evil.com', '\\\\evil.com', 'https://evil.com', 'http:/evil.com',
    'javascript:alert(1)', '%2F%2Fevil.com', '/%2F%2Fevil.com', '/%5Cevil.com', ' //evil.com', '/\tevil', 'evil.com', '', null, undefined]) {
    assert.equal(safeNextPath(value as string | null | undefined), '/', String(value));
  }
  assert.equal(safeNextPath('//evil.com', '/dashboard'), '/dashboard');
});
