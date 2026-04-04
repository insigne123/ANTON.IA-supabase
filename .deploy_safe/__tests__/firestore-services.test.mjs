import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

import { setAdminDbForTests } from '../src/lib/server/firebase-admin.ts';

class FakeDocSnapshot {
  constructor(payload) {
    this.payload = payload;
  }
  get exists() {
    return this.payload !== undefined;
  }
  data() {
    return this.payload;
  }
}

class FakeDocRef {
  constructor(store, path) {
    this.store = store;
    this.path = path;
  }

  collection(name) {
    return new FakeCollectionRef(this.store, `${this.path}/${name}`);
  }

  async set(data, options = {}) {
    const next = options && options.merge
      ? { ...(this.store.get(this.path) ?? {}), ...data }
      : { ...data };
    this.store.set(this.path, next);
  }

  async update(data) {
    if (!this.store.has(this.path)) throw new Error('not-found');
    const current = this.store.get(this.path) ?? {};
    this.store.set(this.path, { ...current, ...data });
  }

  async get() {
    return new FakeDocSnapshot(this.store.get(this.path));
  }
}

class FakeCollectionRef {
  constructor(store, basePath) {
    this.store = store;
    this.basePath = basePath;
  }

  doc(id) {
    return new FakeDocRef(this.store, `${this.basePath}/${id}`);
  }
}

class FakeTransaction {
  constructor() {
    this.writes = [];
  }

  async get(ref) {
    return ref.get();
  }

  set(ref, data, options) {
    this.writes.push(() => ref.set(data, options));
  }

  update(ref, data) {
    this.writes.push(() => ref.update(data));
  }

  async commit() {
    for (const write of this.writes) {
      await write();
    }
    this.writes.length = 0;
  }
}

class FakeWriteBatch {
  constructor() {
    this.writes = [];
  }

  set(ref, data, options) {
    this.writes.push(() => ref.set(data, options));
  }

  async commit() {
    for (const write of this.writes) {
      await write();
    }
    this.writes.length = 0;
  }
}

class FakeFirestore {
  constructor() {
    this.store = new Map();
  }

  collection(name) {
    return new FakeCollectionRef(this.store, name);
  }

  async runTransaction(fn) {
    const tx = new FakeTransaction();
    const result = await fn(tx);
    await tx.commit();
    return result;
  }

  batch() {
    return new FakeWriteBatch();
  }

  clear() {
    this.store.clear();
  }
}

const fakeDb = new FakeFirestore();

const dailyQuota = await import('../src/lib/server/daily-quota-store.ts');
const researchLocks = await import('../src/lib/server/research-lock-store.ts');

test.beforeEach(() => {
  fakeDb.clear();
  setAdminDbForTests(fakeDb);
});

test.afterEach(() => {
  setAdminDbForTests(null);
});

async function getLiveMembership() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data } = await supabase
    .from('organization_members')
    .select('user_id, organization_id')
    .limit(1)
    .maybeSingle();

  return data || null;
}

test('daily quota contact check returns allowed with high limit', async (t) => {
  const membership = await getLiveMembership();
  if (!membership) {
    t.skip('No Supabase credentials or membership rows available for integration test');
    return;
  }

  const params = {
    userId: membership.user_id,
    organizationId: membership.organization_id,
    resource: 'contact',
    limit: 100000,
    count: 1,
  };

  const res = await dailyQuota.checkAndConsumeDailyQuota(params);
  assert.equal(res.allowed, true);
  assert.ok(res.count >= 1);
  assert.equal(res.limit, 100000);

  const status = await dailyQuota.getDailyQuotaStatus({
    userId: membership.user_id,
    organizationId: membership.organization_id,
    resource: 'contact',
    limit: 100000,
  });
  assert.equal(typeof status.count, 'number');
  assert.equal(status.limit, 100000);
});

test('daily quota contact check denies when limit is zero', async (t) => {
  const membership = await getLiveMembership();
  if (!membership) {
    t.skip('No Supabase credentials or membership rows available for integration test');
    return;
  }

  const params = {
    userId: membership.user_id,
    organizationId: membership.organization_id,
    resource: 'contact',
    limit: 0,
    count: 1,
  };

  const res = await dailyQuota.checkAndConsumeDailyQuota(params);
  assert.equal(res.allowed, false);
  assert.ok(res.count >= 0);
  assert.equal(res.limit, 0);
});

test('research lock store maintains state across operations', async () => {
  const leads = ['lead:1', 'lead:2'];
  const firstPass = await researchLocks.filterAndLock(leads);
  assert.deepEqual(firstPass.allowed, leads);
  assert.deepEqual(firstPass.skipped, []);

  const secondPass = await researchLocks.filterAndLock(['lead:2', 'lead:3']);
  assert.deepEqual(secondPass.allowed, ['lead:3']);
  assert.deepEqual(secondPass.skipped, ['lead:2']);

  await researchLocks.markDone(['lead:1']);
  await researchLocks.markError(['lead:2']);

  const doc1 = await fakeDb.collection('researchLocks').doc(encodeURIComponent('lead:1')).get();
  assert.ok(doc1.exists);
  const data1 = doc1.data();
  assert.ok(data1);
  assert.equal(data1.status, 'done');

  const doc2 = await fakeDb.collection('researchLocks').doc(encodeURIComponent('lead:2')).get();
  assert.ok(doc2.exists);
  const data2 = doc2.data();
  assert.ok(data2);
  assert.equal(data2.status, 'error');
});
