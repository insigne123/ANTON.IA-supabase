import assert from 'node:assert/strict';
import test from 'node:test';
import type { SignatureConfig } from '@/lib/email-signature-storage';
import { AUTO_IMPORT_RETRY_MS, autoImportSignature, hasOwnSignature, type AutoImportDependencies } from './signature-auto-import';

// Fictional people: a mailbox signature with a photo, and the shapes /api/email-studio/mailbox-signature answers with.
const OUTLOOK = '<p>Ana Castro · Jefa Comercial</p><img src="data:image/png;base64,AAAA">';
const READY = '<p>Ana Castro · Jefa Comercial</p><img src="https://storage.example/firma.png">';

function deps(overrides: Partial<AutoImportDependencies> & { stored?: Array<Record<string, unknown> | null> } = {}) {
  const saved: SignatureConfig[][] = [];
  const reads = [...(overrides.stored || [{}, {}])];
  const calls = { mailbox: 0, prepare: 0 };
  const base: AutoImportDependencies = {
    readSignatures: async () => (reads.length > 1 ? reads.shift() ?? null : reads[0] ?? null),
    readMailbox: async () => { calls.mailbox += 1; return { provider: 'outlook', html: OUTLOOK }; },
    prepare: async () => { calls.prepare += 1; return READY; },
    sender: async () => ({ name: 'Ana Castro', title: 'Jefa Comercial', company: 'Logisur' }),
    save: async configs => { saved.push(configs); },
    now: () => new Date('2026-11-09T15:00:00Z'),
  };
  return { deps: { ...base, ...overrides }, saved, calls };
}

test('someone without a signature gets the one of their mailbox, on, for every account', async () => {
  const run = deps();
  assert.deepEqual(await autoImportSignature(run.deps), { kind: 'imported', provider: 'outlook' });
  assert.equal(run.saved.length, 1);
  const [gmail, outlook] = run.saved[0];
  assert.deepEqual([gmail.channel, outlook.channel], ['gmail', 'outlook'], 'the mailbox that sends always finds it');
  assert.equal(outlook.enabled, true, 'it goes out from the next email: that is the point');
  assert.equal(outlook.html, READY, 'the cleaned copy with its uploaded photo, never the raw one');
  assert.equal(outlook.builder?.design, 'propia');
  assert.equal(outlook.builder?.fields.customHtml, READY);
  assert.equal(outlook.builder?.fields.name, 'Ana Castro', 'another design starts filled if the person ever switches');
  assert.equal(outlook.updatedAt, '2026-11-09T15:00:00.000Z');
});

test('a signature the person has, even off or empty, is never replaced and the mailbox is not read', async () => {
  for (const stored of [{ outlook: { enabled: false, html: '' } }, { gmail: { enabled: true, html: '<p>Mía</p>' } }]) {
    const run = deps({ stored: [stored] });
    assert.deepEqual(await autoImportSignature(run.deps), { kind: 'has_signature' });
    assert.equal(run.calls.mailbox, 0);
    assert.equal(run.saved.length, 0);
  }
  assert.equal(hasOwnSignature({ other: {} }), false);
  assert.equal(hasOwnSignature(null), false);
});

test('one saved in another tab while the mailbox was read wins', async () => {
  const run = deps({ stored: [{}, { outlook: { enabled: true, html: '<p>Recién guardada</p>' } }] });
  assert.deepEqual(await autoImportSignature(run.deps), { kind: 'has_signature' });
  assert.equal(run.saved.length, 0);
});

test('without a mailbox, without a signature in it, or with a failure, nothing is saved and it is tried again later', async () => {
  const cases: Array<[Partial<AutoImportDependencies>, string]> = [
    [{ readMailbox: async () => ({ provider: 'outlook', html: null, reason: 'not_connected' }) }, 'not_connected'],
    [{ readMailbox: async () => ({ provider: 'gmail', html: null, reason: 'not_found' }) }, 'not_found'],
    [{ readMailbox: async () => ({ provider: 'outlook', html: null, reason: 'unavailable' }) }, 'unavailable'],
    [{ readMailbox: async () => null }, 'unavailable'],
    [{ readMailbox: async () => { throw new Error('offline'); } }, 'unavailable'],
    [{ readSignatures: async () => { throw new Error('offline'); } }, 'unavailable'],
    [{ prepare: async () => null }, 'failed'],
    [{ prepare: async () => { throw new Error('upload'); } }, 'failed'],
  ];
  for (const [overrides, kind] of cases) {
    const run = deps(overrides);
    assert.equal((await autoImportSignature(run.deps)).kind, kind);
    assert.equal(run.saved.length, 0, kind);
  }
  assert.ok(AUTO_IMPORT_RETRY_MS.not_connected < AUTO_IMPORT_RETRY_MS.unavailable, 'a mailbox is usually connected soon after');
  assert.ok(AUTO_IMPORT_RETRY_MS.not_found >= 7 * 24 * 60 * 60 * 1000, 'someone without a signature is not asked about it every day');
});

test('Gmail is named as Gmail', async () => {
  const run = deps({ readMailbox: async () => ({ provider: 'gmail', html: '<p>Hola</p>' }) });
  assert.deepEqual(await autoImportSignature(run.deps), { kind: 'imported', provider: 'gmail' });
});
