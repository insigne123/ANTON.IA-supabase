import assert from 'node:assert/strict';
import test from 'node:test';

import { readCachedNavAccess, writeCachedNavAccess } from './use-nav-access';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

test('the menu remembers the last answer per person and organization, so it opens with its entries in place', () => {
  const storage = memoryStorage();
  writeCachedNavAccess('user-1:org-a', { cowork: true, opportunities: false }, storage);
  assert.deepEqual(readCachedNavAccess('user-1:org-a', storage), { cowork: true, opportunities: false });
  assert.deepEqual(readCachedNavAccess('user-1:org-b', storage), { cowork: false, opportunities: false }, 'another organization starts closed');
  assert.deepEqual(readCachedNavAccess('', storage), { cowork: false, opportunities: false }, 'no user, nothing to show');
});

test('a damaged, foreign or missing value shows nothing extra, and a blocked storage never breaks the menu', () => {
  const storage = memoryStorage({
    'anton.nav-access.v1:broken': '{not json',
    'anton.nav-access.v1:strings': '{"cowork":"true","opportunities":1}',
  });
  assert.deepEqual(readCachedNavAccess('broken', storage), { cowork: false, opportunities: false });
  assert.deepEqual(readCachedNavAccess('strings', storage), { cowork: false, opportunities: false }, 'only a real true opens an entry');
  assert.deepEqual(readCachedNavAccess('user-1:org-a', null), { cowork: false, opportunities: false });

  const blocked = memoryStorage();
  blocked.setItem = () => { throw new Error('QuotaExceededError'); };
  blocked.getItem = () => { throw new Error('SecurityError'); };
  assert.doesNotThrow(() => writeCachedNavAccess('user-1:org-a', { cowork: true, opportunities: true }, blocked));
  assert.deepEqual(readCachedNavAccess('user-1:org-a', blocked), { cowork: false, opportunities: false });
});
