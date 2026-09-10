import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCampaignReplyTarget } from './reply-target';

const draft: any = { organizationId: 'org', userId: 'owner', draftId: 'draft', versionId: 'version', recipient: { email: 'ada@example.com' } };
function fixture() {
  return {
    campaign_recipient_steps: [
      { id: 'step', native_draft_id: 'draft', native_version_id: 'version', enrollment_id: 'enrollment', campaign_id: 'campaign', step_index: 1 },
      { id: 'previous', native_draft_id: 'initial', native_version_id: 'initial-version', enrollment_id: 'enrollment', campaign_id: 'campaign', step_index: 0, state: 'sent', outbound_dispatch_id: 'receipt' },
    ],
    campaign_enrollments: [{ id: 'enrollment', campaign_id: 'campaign', recipient_email: 'ada@example.com' }],
    outbound_dispatches: [{ id: 'receipt', campaign_recipient_step_id: 'previous', status: 'sent', provider: 'gmail', channel: 'email', draft_id: 'initial', version_id: 'initial-version', provider_message_id: 'message', provider_response: { id: 'message', threadId: 'thread' } }],
    messaging_draft_versions: [{ id: 'initial-version', draft_id: 'initial', recipient: { email: 'ada@example.com' } }],
  };
}
function client(tables: any, fail = false) {
  return { from(table: string) {
    const filters: any[] = [];
    return { select() { return this; }, eq(key: string, value: any) { filters.push([key, value]); return this; }, async maybeSingle() {
      assert.ok(filters.some(([key, value]) => key === 'organization_id' && value === 'org'));
      assert.ok(filters.some(([key, value]) => key === 'user_id' && value === 'owner'));
      const rows = tables[table].map((row: any) => ({ organization_id: 'org', user_id: 'owner', ...row }))
        .filter((row: any) => filters.every(([key, value]) => row[key] === value));
      return { data: rows[0] || null, error: fail || rows.length > 1 ? new Error('lookup failed') : null };
    } };
  } };
}

test('canonical enrollment and prior confirmed receipt derive the Gmail target', async () => {
  assert.deepEqual(await resolveCampaignReplyTarget(client(fixture()), draft, 'gmail', 'reply_previous'), {
    provider: 'gmail', parentDispatchId: 'receipt', messageId: 'message', threadId: 'thread',
  });
});
test('new-message default does not infer replies for any campaign step or provider', async () => {
  const noLookup = { from() { assert.fail('New messages must not depend on reply history'); } };
  for (const provider of ['gmail', 'outlook'] as const) {
    assert.equal(await resolveCampaignReplyTarget(noLookup, draft, provider), null);
    assert.equal(await resolveCampaignReplyTarget(noLookup, draft, provider, 'new_message'), null);
  }
});
test('explicit first and previous modes select distinct confirmed ancestors', async () => {
  for (const mode of ['reply_first', 'reply_previous'] as const) {
    const tables = fixture();
    tables.campaign_recipient_steps[0].step_index = 2;
    tables.campaign_recipient_steps[1].step_index = 1;
    tables.campaign_recipient_steps.push({ ...tables.campaign_recipient_steps[1], id: 'root-step', step_index: 0, state: 'sent', outbound_dispatch_id: 'root-receipt', native_draft_id: 'root-draft', native_version_id: 'root-version' });
    tables.outbound_dispatches.push({ ...tables.outbound_dispatches[0], id: 'root-receipt', campaign_recipient_step_id: 'root-step', draft_id: 'root-draft', version_id: 'root-version', provider_message_id: 'root-message', provider_response: { id: 'root-message', threadId: 'thread' } });
    tables.messaging_draft_versions.push({ id: 'root-version', draft_id: 'root-draft', recipient: { email: 'ada@example.com' } });
    const target = await resolveCampaignReplyTarget(client(tables), draft, 'gmail', mode);
    assert.equal(target?.parentDispatchId, mode === 'reply_first' ? 'root-receipt' : 'receipt');
    assert.equal(target?.messageId, mode === 'reply_first' ? 'root-message' : 'message');
  }
});
test('scope, recipient, provider, version, unknown receipt and missing thread conflicts fail closed', async () => {
  for (const mutate of [
    (v: any) => { v.campaign_recipient_steps[0].native_version_id = 'old'; },
    (v: any) => { v.campaign_enrollments[0].recipient_email = 'other@example.com'; },
    (v: any) => { v.outbound_dispatches[0].organization_id = 'foreign'; },
    (v: any) => { v.outbound_dispatches[0].user_id = 'foreign'; },
    (v: any) => { v.outbound_dispatches[0].provider = 'outlook'; },
    (v: any) => { v.outbound_dispatches[0].status = 'unknown'; },
    (v: any) => { v.outbound_dispatches[0].version_id = 'other'; },
    (v: any) => { v.outbound_dispatches[0].provider_response = {}; },
    (v: any) => { v.messaging_draft_versions[0].recipient.email = 'other@example.com'; },
  ]) {
    const tables = fixture(); mutate(tables);
    await assert.rejects(resolveCampaignReplyTarget(client(tables), draft, 'gmail', 'reply_previous'), /REPLY_/);
  }
  await assert.rejects(resolveCampaignReplyTarget(client(fixture(), true), draft, 'gmail', 'reply_previous'), /lookup failed/);
});
test('explicit replies cannot silently become new messages when no parent exists', async () => {
  const tables = fixture(); tables.campaign_recipient_steps = [];
  await assert.rejects(resolveCampaignReplyTarget(client(tables), draft, 'gmail', 'reply_previous'), /LINK_REQUIRED/);
  const initial = fixture(); initial.campaign_recipient_steps[0].step_index = 0;
  await assert.rejects(resolveCampaignReplyTarget(client(initial), draft, 'gmail', 'reply_first'), /FIRST_CONTACT/);
});
test('only explicitly requested Outlook replies are unsupported, before history or provider calls', async () => {
  const noLookup = { from() { assert.fail('Unsupported replies must not query history'); } };
  for (const mode of ['reply_first', 'reply_previous'] as const) {
    await assert.rejects(resolveCampaignReplyTarget(noLookup, draft, 'outlook', mode), /OUTLOOK_NATIVE_REPLY_UNSUPPORTED/);
  }
});
