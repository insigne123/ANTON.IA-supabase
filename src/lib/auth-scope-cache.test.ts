import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { authScopeKey, readCachedAuthScope, writeCachedAuthScope } from './auth-scope-cache';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    data,
  } as unknown as Storage & { data: Map<string, string> };
}

test('the cached scope round-trips ids only, and anything odd reads as no cache', () => {
  const storage = memoryStorage();
  assert.equal(readCachedAuthScope(storage), null);
  writeCachedAuthScope({ userId: 'user-1', organizationId: 'org-1' }, storage);
  assert.deepEqual(readCachedAuthScope(storage), { userId: 'user-1', organizationId: 'org-1' });
  assert.deepEqual(JSON.parse(storage.data.get('anton.auth-scope.v1')!), { userId: 'user-1', organizationId: 'org-1' }, 'no token or email is stored');
  writeCachedAuthScope({ userId: 'user-1', organizationId: null }, storage);
  assert.deepEqual(readCachedAuthScope(storage), { userId: 'user-1', organizationId: null });
  writeCachedAuthScope(null, storage);
  assert.equal(storage.data.has('anton.auth-scope.v1'), false, 'signing out clears it');

  assert.equal(readCachedAuthScope(memoryStorage({ 'anton.auth-scope.v1': '{not json' })), null);
  assert.equal(readCachedAuthScope(memoryStorage({ 'anton.auth-scope.v1': JSON.stringify({ userId: '  ' }) })), null);
  assert.equal(readCachedAuthScope(null), null);
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } } as unknown as Storage;
  assert.equal(readCachedAuthScope(throwing), null);
  assert.doesNotThrow(() => writeCachedAuthScope({ userId: 'u', organizationId: null }, throwing));
});

test('the remount key names the person and the organization', () => {
  assert.equal(authScopeKey(null), 'anonymous:personal');
  assert.equal(authScopeKey({ userId: 'user-1', organizationId: null }), 'user-1:personal');
  assert.equal(authScopeKey({ userId: 'user-1', organizationId: 'org-1' }), 'user-1:org-1');
});

test('AuthProvider mounts the app once when the session matches the cached scope', () => {
  const source = readFileSync('src/context/AuthContext.tsx', 'utf8');
  // The stores are primed from the cache during the first render, before any screen reads them.
  assert.match(source, /useState\(\(\) => \{\s*const cached = readCachedAuthScope\(\);\s*if \(cached\) primeStorageScopes\(cached\.userId, cached\.organizationId\);/);
  // Until the first resolution the key is the cached one; afterwards it follows the real person and organization.
  assert.match(source, /<Fragment key=\{scopeResolved \? authScopeKey\(\{ userId: user\?\.id, organizationId \}\) : authScopeKey\(initialScope\)\}>/);
  // The same person's research store is not emptied while the organization loads.
  assert.match(source, /const previousUserId = sessionRef\.current\?\.user\?\.id \|\| primedUserIdRef\.current \|\| null;/);
  assert.match(source, /setScopeResolved\(true\);\s*writeCachedAuthScope\(userId \? \{ userId, organizationId: nextOrganizationId \} : null\);/);
  assert.match(source, /await supabase\.auth\.signOut\(\);[\s\S]{0,200}writeCachedAuthScope\(null\);/);
});
