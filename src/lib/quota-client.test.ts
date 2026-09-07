import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getClientQuota,
  getClientQuotaLimits,
  setClientQuotaSnapshot,
  setQuotaStorageScope,
} from '@/lib/quota-client';

test('quota snapshots are isolated by user and active organization', () => {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = { localStorage, dispatchEvent: () => true };

  try {
    setQuotaStorageScope('user-1', 'organization-a');
    setClientQuotaSnapshot('leadSearch', { count: 7, limit: 20 });

    setQuotaStorageScope('user-1', 'organization-b');
    assert.equal(getClientQuota().leadSearch, 0);
    assert.notEqual(getClientQuotaLimits().leadSearch, 20);

    setQuotaStorageScope('user-2', 'organization-a');
    assert.equal(getClientQuota().leadSearch, 0);

    setQuotaStorageScope('user-1', 'organization-a');
    assert.equal(getClientQuota().leadSearch, 7);
    assert.equal(getClientQuotaLimits().leadSearch, 20);
  } finally {
    setQuotaStorageScope(null, null);
    if (originalWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = originalWindow;
  }
});
