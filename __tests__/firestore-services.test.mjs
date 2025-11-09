import test from 'node:test';
import assert from 'node:assert/strict';

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

test('daily quota increments until limit', async () => {
  const params = { userId: 'user-1', resource: 'emails', limit: 2 };

  const first = await dailyQuota.checkAndConsumeDailyQuota(params);
  assert.equal(first.allowed, true);
  assert.equal(first.count, 1);

  const second = await dailyQuota.checkAndConsumeDailyQuota(params);
  assert.equal(second.allowed, true);
  assert.equal(second.count, 2);

  const third = await dailyQuota.checkAndConsumeDailyQuota(params);
  assert.equal(third.allowed, false);
  assert.equal(third.count, 2);

  const status = await dailyQuota.getDailyQuotaStatus(params);
  assert.equal(status.allowed, false);
  assert.equal(status.count, 2);
  assert.equal(status.limit, 2);
});

test('daily quota throws when exceeding limit', async () => {
  const params = { userId: 'user-2', resource: 'sync', limit: 1 };
  await dailyQuota.checkAndConsumeDailyQuota(params);

  await assert.rejects(() => dailyQuota.consumeDailyQuotaOrThrow(params), (err) => {
    assert.equal(err.code, 'DAILY_QUOTA_EXCEEDED');
    return true;
  });
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
