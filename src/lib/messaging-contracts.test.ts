import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MessagingDraftV1Schema,
  MessagingSendMetadataV1Schema,
  assertCanonicalEmailSendCompatibilityV1,
  canonicalJson,
  canonicalSha256,
  createChildMessagingDraftV1,
  createLegacyReadyEmailDraftV1,
  createMessagingSendMetadataV1,
  deterministicMessagingUuid,
  hashMessagingDraftContent,
  resolveApprovedEmailSendV1,
  type MessagingDraftV1,
} from './messaging-contracts';
import {
  appendMessagingDraftRevisionV1,
  getCurrentMessagingDraftVersionV1,
  persistMessagingDraftV1,
  type MessagingDraftRepository,
} from './server/messaging-drafts';

const ids = {
  draft: '10000000-0000-4000-8000-000000000001',
  version: '20000000-0000-4000-8000-000000000001',
  child: '20000000-0000-4000-8000-000000000002',
  organization: '30000000-0000-4000-8000-000000000001',
  user: '40000000-0000-4000-8000-000000000001',
  snapshot: '50000000-0000-4000-8000-000000000001',
};

function emailDraft(overrides: Partial<MessagingDraftV1> = {}): MessagingDraftV1 {
  return {
    schemaVersion: 1,
    draftId: ids.draft,
    versionId: ids.version,
    organizationId: ids.organization,
    userId: ids.user,
    researchSnapshotId: null,
    revision: 1,
    parentVersionId: null,
    lifecycle: 'draft',
    channel: 'email',
    recipient: {
      leadRef: 'lead-1',
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      linkedinUrl: null,
    },
    content: {
      subject: 'A precise subject',
      text: 'A useful message body.',
      html: null,
    },
    approval: { status: 'pending', decidedBy: null, decidedAt: null, reason: null },
    preflight: { status: 'pending', checkedAt: null, errors: [], warnings: [] },
    createdAt: '2026-08-13T09:30:00.000Z',
    ...overrides,
  };
}

test('MessagingDraftV1 is strict and enforces channel content and recipient invariants', () => {
  assert.equal(MessagingDraftV1Schema.safeParse({ ...emailDraft(), extra: true }).success, false);
  assert.equal(MessagingDraftV1Schema.safeParse(emailDraft({
    recipient: { leadRef: 'lead-1', displayName: null, email: null, linkedinUrl: null },
  })).success, false);
  assert.equal(MessagingDraftV1Schema.safeParse(emailDraft({
    channel: 'linkedin',
    recipient: { leadRef: 'lead-1', displayName: null, email: null, linkedinUrl: 'https://linkedin.com/in/ada' },
  })).success, false);
});

test('MessagingDraftV1 enforces revision, approval, preflight, and lifecycle invariants', () => {
  assert.equal(MessagingDraftV1Schema.safeParse(emailDraft({ revision: 2, parentVersionId: null })).success, false);
  assert.equal(MessagingDraftV1Schema.safeParse(emailDraft({ lifecycle: 'ready' })).success, false);
  assert.equal(MessagingDraftV1Schema.safeParse(emailDraft({
    preflight: {
      status: 'passed',
      checkedAt: '2026-08-13T09:31:00.000Z',
      errors: ['not actually passed'],
      warnings: [],
    } as never,
  })).success, false);
  assert.equal(MessagingDraftV1Schema.safeParse(emailDraft({
    approval: {
      status: 'approved',
      decidedBy: ids.user,
      decidedAt: null,
      reason: null,
    } as never,
  })).success, false);
});

test('child revisions reset lifecycle, approval, and preflight state', () => {
  const approved = emailDraft({
    lifecycle: 'ready',
    approval: {
      status: 'approved',
      decidedBy: ids.user,
      decidedAt: '2026-08-13T09:31:00.000Z',
      reason: null,
    },
    preflight: {
      status: 'passed',
      checkedAt: '2026-08-13T09:32:00.000Z',
      errors: [],
      warnings: ['Reviewed'],
    },
  });

  const child = createChildMessagingDraftV1(approved, {
    versionId: ids.child,
    createdAt: '2026-08-13T10:00:00.000Z',
    content: { ...approved.content, subject: 'Revised subject' },
  });

  assert.equal(child.revision, 2);
  assert.equal(child.parentVersionId, approved.versionId);
  assert.equal(child.lifecycle, 'draft');
  assert.deepEqual(child.approval, { status: 'pending', decidedBy: null, decidedAt: null, reason: null });
  assert.deepEqual(child.preflight, { status: 'pending', checkedAt: null, errors: [], warnings: [] });
});

test('child revisions cannot change recipient identity', () => {
  assert.throws(() => createChildMessagingDraftV1(emailDraft(), {
    versionId: '20000000-0000-4000-8000-000000000002',
    createdAt: '2026-08-13T10:00:00.000Z',
    recipient: {
      leadRef: 'lead-2',
      displayName: 'Grace Hopper',
      email: 'grace@example.com',
      linkedinUrl: null,
    },
  }), /recipient is immutable/);
});

test('canonical SHA-256 is stable across object key insertion order', () => {
  const left = { z: 1, nested: { b: true, a: ['x', 2] } };
  const right = { nested: { a: ['x', 2], b: true }, z: 1 };

  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(canonicalSha256(left), canonicalSha256(right));
  assert.match(canonicalSha256(left), /^[a-f0-9]{64}$/);
});

test('delivery options are strict and participate in the durable content identity', () => {
  const withoutReceipts = emailDraft();
  const withReceipts = emailDraft({
    content: {
      ...emailDraft().content,
      deliveryOptions: { requestReceipts: true },
    },
  });

  assert.notEqual(hashMessagingDraftContent(withoutReceipts), hashMessagingDraftContent(withReceipts));
  assert.equal(MessagingDraftV1Schema.safeParse(emailDraft({
    content: {
      ...emailDraft().content,
      deliveryOptions: { requestReceipts: true, unsupported: true } as never,
    },
  })).success, false);
});

test('legacy ready drafts preserve canonical delivery options and deterministic replay IDs', () => {
  const input = {
    organizationId: ids.organization,
    userId: ids.user,
    idempotencyKey: 'send:outlook:receipts',
    requestedAt: '2026-08-13T09:33:00.000Z',
    researchSnapshotId: ids.snapshot,
    to: 'ada@example.com',
    subject: 'Receipt-aware message',
    html: '<p>Hello Ada</p>',
    deliveryOptions: { requestReceipts: true },
  };
  const first = createLegacyReadyEmailDraftV1(input);
  const replay = createLegacyReadyEmailDraftV1(input);

  assert.deepEqual(first.content.deliveryOptions, { requestReceipts: true });
  assert.equal(first.researchSnapshotId, ids.snapshot);
  assert.equal(hashMessagingDraftContent(first), hashMessagingDraftContent(replay));
  assert.equal(
    deterministicMessagingUuid('suplia:contacted:dispatch-1'),
    deterministicMessagingUuid('suplia:contacted:dispatch-1'),
  );
  assert.notEqual(
    deterministicMessagingUuid('suplia:contacted:dispatch-1'),
    deterministicMessagingUuid('suplia:email-event:sent:dispatch-1'),
  );
});

test('MessagingSendMetadataV1 is strict and is derived from a sendable draft', () => {
  const ready = emailDraft({
    lifecycle: 'ready',
    approval: {
      status: 'approved',
      decidedBy: ids.user,
      decidedAt: '2026-08-13T09:31:00.000Z',
      reason: null,
    },
    preflight: {
      status: 'passed',
      checkedAt: '2026-08-13T09:32:00.000Z',
      errors: [],
      warnings: [],
    },
  });
  const metadata = createMessagingSendMetadataV1(ready, {
    idempotencyKey: 'send:lead-1:revision-1',
    provider: 'fake',
    requestedAt: '2026-08-13T09:33:00.000Z',
  });

  assert.equal(MessagingSendMetadataV1Schema.parse(metadata).contentHash.length, 64);
  assert.equal(MessagingSendMetadataV1Schema.safeParse({ ...metadata, extra: true }).success, false);
  assert.throws(() => createMessagingSendMetadataV1(emailDraft(), {
    idempotencyKey: 'not-ready',
    provider: 'fake',
    requestedAt: '2026-08-13T09:33:00.000Z',
  }), /not ready/i);
});

test('approved email delivery is reconstructed from the persisted draft and browser content is assertion-only', () => {
  const approved = emailDraft({
    lifecycle: 'ready',
    content: {
      subject: 'Approved subject',
      text: 'Approved text body.',
      html: '<p>Approved text body.</p>',
    },
    approval: {
      status: 'approved',
      decidedBy: ids.user,
      decidedAt: '2026-08-13T09:31:00.000Z',
      reason: null,
    },
    preflight: {
      status: 'passed',
      checkedAt: '2026-08-13T09:32:00.000Z',
      errors: [],
      warnings: [],
    },
  });

  const canonical = resolveApprovedEmailSendV1(approved);

  assert.deepEqual({
    to: canonical.to,
    subject: canonical.subject,
    text: canonical.text,
    html: canonical.html,
  }, {
    to: 'ada@example.com',
    subject: 'Approved subject',
    text: 'Approved text body.',
    html: '<p>Approved text body.</p>',
  });
  assert.doesNotThrow(() => assertCanonicalEmailSendCompatibilityV1(canonical, {
    to: 'ADA@example.com',
    subject: 'Approved subject',
    text: 'Approved text body.',
    html: '<p>Approved text body.</p>',
  }));
  assert.throws(() => assertCanonicalEmailSendCompatibilityV1(canonical, {
    html: '<p>Browser replacement body.</p>',
  }), /Browser HTML body does not match/);
  assert.equal(canonical.html, '<p>Approved text body.</p>');
});

test('append-only persistence writes immutable revisions through an injected repository', async () => {
  const versions: MessagingDraftV1[] = [];
  const repository: MessagingDraftRepository = {
    async createInitial({ draft }) {
      assert.equal(versions.length, 0);
      versions.push(structuredClone(draft));
      return structuredClone(draft);
    },
    async appendRevision({ expectedParentVersionId, draft }) {
      assert.equal(expectedParentVersionId, versions.at(-1)?.versionId);
      assert.equal(draft.revision, versions.length + 1);
      versions.push(structuredClone(draft));
      return structuredClone(draft);
    },
    async findVersion({ versionId }) {
      return structuredClone(versions.find((version) => version.versionId === versionId) ?? null);
    },
    async findCurrentVersion({ draftId }) {
      return structuredClone(versions.find((version) => version.draftId === draftId && version.versionId === versions.at(-1)?.versionId) ?? null);
    },
  };
  const initial = emailDraft();

  await persistMessagingDraftV1(initial, { repository });
  const child = await appendMessagingDraftRevisionV1(initial, {
    content: { ...initial.content, subject: 'An immutable second revision' },
  }, {
    repository,
    createId: () => ids.child,
    now: () => '2026-08-13T10:00:00.000Z',
  });

  assert.equal(versions.length, 2);
  assert.equal(versions[0].content.subject, 'A precise subject');
  assert.equal(child.content.subject, 'An immutable second revision');
  assert.equal(child.approval.status, 'pending');
  assert.equal(child.preflight.status, 'pending');
});

test('current messaging draft lookups include the authenticated user scope', async () => {
  const current = emailDraft({ versionId: ids.child });
  const calls: Array<{ organizationId: string; userId: string; draftId: string }> = [];
  const repository: MessagingDraftRepository = {
    async createInitial() { throw new Error('not used'); },
    async appendRevision() { throw new Error('not used'); },
    async findVersion() { throw new Error('not used'); },
    async findCurrentVersion(input) {
      calls.push(input);
      return structuredClone(current);
    },
  };

  const found = await getCurrentMessagingDraftVersionV1({
    organizationId: ids.organization,
    userId: ids.user,
    draftId: ids.draft,
  }, { repository });

  assert.equal(found?.versionId, ids.child);
  assert.deepEqual(calls, [{
    organizationId: ids.organization,
    userId: ids.user,
    draftId: ids.draft,
  }]);
});
