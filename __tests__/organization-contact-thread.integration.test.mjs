import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

import { assertSafeTestTarget } from '../scripts/assert-test-target.mjs';
import { QA_IDENTITIES, QA_ORGANIZATIONS } from '../scripts/bootstrap-test-identities.mjs';
import { hashMessagingDraftContent } from '../src/lib/messaging-contracts.ts';
import { dispatchOutboundMessage } from '../src/lib/server/outbound-dispatch.ts';

function requiredEnvironment(name) {
  const value = String(process.env[name] || '').trim();
  assert.ok(value, `${name} is required for integration tests`);
  return value;
}

function assertNoError(result, action) {
  assert.equal(result.error, null, `${action}: ${result.error?.message || 'unknown error'}`);
  return result.data;
}

async function createAuthenticatedClient(target, email) {
  const client = createClient(target.supabaseUrl, requiredEnvironment('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: requiredEnvironment('QA_TEST_PASSWORD'),
  });
  assert.equal(error, null, `${email} should be able to sign in`);
  return client;
}

test('concurrent recipient claims allow exactly one dispatch to reach provider-ready sending', { timeout: 30_000 }, async () => {
  const target = assertSafeTestTarget();
  assert.ok(
    target.kind === 'local'
      || (target.kind === 'nonprod' && process.env.RUN_COLLABORATION_PILOT === 'true'),
    'recipient concurrency runs only locally or during the explicit nonprod pilot',
  );
  const admin = createClient(target.supabaseUrl, requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const organization = assertNoError(await admin
    .from('organizations')
    .select('id,collaboration_v1_enabled')
    .eq('name', QA_ORGANIZATIONS.primary)
    .single(), 'read QA organization');
  const profiles = assertNoError(await admin
    .from('profiles')
    .select('id,email')
    .in('email', [QA_IDENTITIES.owner.email, QA_IDENTITIES.member.email]), 'read QA users');
  const owner = profiles.find((profile) => profile.email === QA_IDENTITIES.owner.email);
  const member = profiles.find((profile) => profile.email === QA_IDENTITIES.member.email);
  assert.ok(owner?.id && member?.id, 'owner and member QA profiles must exist');

  const ids = {
    ownerDraft: randomUUID(),
    memberDraft: randomUUID(),
    ownerVersion: randomUUID(),
    memberVersion: randomUUID(),
    ownerDispatch: randomUUID(),
    memberDispatch: randomUUID(),
  };
  const recipientEmail = `parallel-${randomUUID()}@example.test`;
  const createdAt = '2026-08-26T12:00:00.000Z';
  const recipient = { leadRef: null, displayName: 'Parallel Recipient', email: recipientEmail, linkedinUrl: null };
  const content = { subject: 'Concurrency test', text: 'No provider is invoked.', html: null };
  const preflight = { status: 'passed', checkedAt: createdAt, errors: [], warnings: [] };
  function payloadFor(draft) {
    const approval = { status: 'approved', decidedBy: draft.userId, decidedAt: createdAt, reason: null };
    return {
      schemaVersion: 1,
      draftId: draft.draftId,
      versionId: draft.versionId,
      organizationId: organization.id,
      userId: draft.userId,
      researchSnapshotId: null,
      revision: 1,
      parentVersionId: null,
      lifecycle: 'ready',
      channel: 'email',
      recipient,
      content,
      approval,
      preflight,
      createdAt,
    };
  }
  const drafts = [
    { draftId: ids.ownerDraft, versionId: ids.ownerVersion, dispatchId: ids.ownerDispatch, userId: owner.id, key: `parallel:${ids.ownerDispatch}` },
    { draftId: ids.memberDraft, versionId: ids.memberVersion, dispatchId: ids.memberDispatch, userId: member.id, key: `parallel:${ids.memberDispatch}` },
  ].map((draft) => ({ ...draft, hash: hashMessagingDraftContent(payloadFor(draft)) }));

  try {
    assertNoError(await admin.from('organizations').update({ collaboration_v1_enabled: true }).eq('id', organization.id), 'enable collaboration');
    assertNoError(await admin.from('messaging_drafts').insert(drafts.map((draft) => ({
      id: draft.draftId,
      organization_id: organization.id,
      user_id: draft.userId,
      channel: 'email',
    }))), 'insert personal drafts');

    assertNoError(await admin.from('messaging_draft_versions').insert(drafts.map((draft) => {
      const approval = { status: 'approved', decidedBy: draft.userId, decidedAt: createdAt, reason: null };
      return {
        id: draft.versionId,
        draft_id: draft.draftId,
        organization_id: organization.id,
        user_id: draft.userId,
        revision: 1,
        lifecycle: 'ready',
        channel: 'email',
        recipient,
        content,
        approval,
        preflight,
        payload: payloadFor(draft),
        content_hash: draft.hash,
        created_at: createdAt,
      };
    })), 'insert ready draft versions');

    for (const draft of drafts) {
      assertNoError(await admin
        .from('messaging_drafts')
        .update({ lifecycle: 'ready', current_version_id: draft.versionId })
        .eq('id', draft.draftId), 'activate draft version');
    }

    assertNoError(await admin.from('outbound_dispatches').insert(drafts.map((draft) => ({
      id: draft.dispatchId,
      organization_id: organization.id,
      user_id: draft.userId,
      draft_id: draft.draftId,
      version_id: draft.versionId,
      idempotency_key: draft.key,
      content_hash: draft.hash,
      channel: 'email',
      provider: 'integration-noop',
      metadata: {
        schemaVersion: 1,
        organizationId: organization.id,
        userId: draft.userId,
        draftId: draft.draftId,
        versionId: draft.versionId,
        revision: 1,
        channel: 'email',
        recipient,
        contentHash: draft.hash,
        idempotencyKey: draft.key,
        provider: 'integration-noop',
        requestedAt: createdAt,
      },
      requested_at: createdAt,
    }))), 'insert pending dispatches');

    let providerCalls = 0;
    const provider = {
      async send({ dispatchId }) {
        providerCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          outcome: 'accepted',
          providerMessageId: `fake-provider:${dispatchId}`,
          response: { externalSideEffect: false },
        };
      },
    };
    const outcomes = await Promise.all(drafts.map((draft) => {
      return dispatchOutboundMessage({
        draft: payloadFor(draft),
        metadata: {
          schemaVersion: 1,
          organizationId: organization.id,
          userId: draft.userId,
          draftId: draft.draftId,
          versionId: draft.versionId,
          revision: 1,
          channel: 'email',
          recipient,
          contentHash: draft.hash,
          idempotencyKey: draft.key,
          provider: 'integration-noop',
          requestedAt: createdAt,
        },
        provider,
      });
    }));
    assert.equal(providerCalls, 1);
    assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ['failed', 'sent']);

    const dispatchRows = assertNoError(await admin
      .from('outbound_dispatches')
      .select('id,status,error_code')
      .in('id', [ids.ownerDispatch, ids.memberDispatch]), 'read concurrent dispatch outcomes');
    assert.deepEqual(dispatchRows.map((row) => row.status).sort(), ['failed', 'sent']);
    assert.equal(dispatchRows.find((row) => row.status === 'failed')?.error_code, 'pre_provider_rejected');

    const threadRows = assertNoError(await admin
      .from('organization_contact_threads')
      .select('status,reserved_dispatch_id')
      .eq('organization_id', organization.id)
      .eq('recipient_key', recipientEmail), 'read recipient thread');
    assert.equal(threadRows.length, 1);
    assert.equal(threadRows[0].status, 'active');
    assert.equal(threadRows[0].reserved_dispatch_id, null);

    const ownerClient = await createAuthenticatedClient(target, QA_IDENTITIES.owner.email);
    const memberClient = await createAuthenticatedClient(target, QA_IDENTITIES.member.email);
    const outsiderClient = await createAuthenticatedClient(target, QA_IDENTITIES.outsider.email);
    for (const [label, client, expectedRows] of [
      ['owner', ownerClient, 1],
      ['member', memberClient, 1],
      ['outsider', outsiderClient, 0],
    ]) {
      const visibleThreads = await client
        .from('organization_contact_threads')
        .select('id')
        .eq('organization_id', organization.id)
        .eq('recipient_key', recipientEmail);
      assert.equal(visibleThreads.error, null, `${label} collaboration thread read should succeed`);
      assert.equal(visibleThreads.data?.length, expectedRows, `${label} collaboration thread visibility`);
    }
  } finally {
    if (target.kind === 'local') {
      await admin.from('outbound_dispatches').delete().in('id', [ids.ownerDispatch, ids.memberDispatch]);
      await admin.from('organization_contact_threads').delete().eq('organization_id', organization.id).eq('recipient_key', recipientEmail);
      await admin.from('contacted_leads').delete().eq('organization_id', organization.id).eq('email', recipientEmail);
      await admin.from('messaging_drafts').delete().in('id', [ids.ownerDraft, ids.memberDraft]);
    }
    await admin.from('organizations').update({ collaboration_v1_enabled: organization.collaboration_v1_enabled }).eq('id', organization.id);
  }
});
