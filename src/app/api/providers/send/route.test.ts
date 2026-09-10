import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { ReplyTargetError } from '@/lib/server/reply-target';

const source = readFileSync('src/app/api/providers/send/route.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(overrides: Record<string, any> = {}) {
  const exports: any = {};
  new Function('require', 'exports', compiled)((name: string) => {
    if (name in overrides) return overrides[name];
    if (name === 'next/server') return { NextResponse: { json: (body: any, init: any) => Response.json(body, init) } };
    if (name === '@supabase/auth-helpers-nextjs') return { createRouteHandlerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) } }) };
    if (name === '@/lib/email-provider') return { normalizeConnectedEmailProvider: () => 'google' };
    return {};
  }, exports);
  return exports.POST;
}
test('send route rejects browser-owned reply selectors before any provider invocation', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('External sends forbidden'); });
  for (const key of ['replyTarget', 'replyTo', 'inReplyTo', 'threadId', 'conversationId', 'parentMessageId']) {
    const response = await load()({ json: async () => ({ provider: 'google', [key]: 'spoofed' }) });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /canonical campaign history/);
  }
});
test('send route validates explicit delivery modes before any provider invocation', async () => {
  for (const deliveryMode of [null, '', 'reply_all', 'auto', {}, true]) {
    const response = await load()({ json: async () => ({ provider: 'google', deliveryMode }) });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /deliveryMode/);
  }
});

test('canonical route passes only server-derived target and never sends on unresolved history', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('External sends forbidden'); });
  const draft = { draftId: 'draft', versionId: 'version', recipient: { leadRef: null }, researchSnapshotId: null, content: {} };
  for (const provider of ['google', 'outlook']) {
  for (const deliveryMode of [undefined, 'new_message', 'reply_first', 'reply_previous']) {
  const target = { provider: 'gmail', messageId: 'parent', threadId: 'thread', parentDispatchId: 'previous' };
  for (const blocked of [false, true]) {
    const isReply = deliveryMode === 'reply_first' || deliveryMode === 'reply_previous';
    const rejected = isReply && (blocked || provider === 'outlook');
    let sends = 0;
    let resolutions = 0;
    const query: any = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { organization_id: 'org' }, error: null }) };
    const post = load({
      '@/lib/email-provider': { normalizeConnectedEmailProvider: () => provider },
      '@supabase/auth-helpers-nextjs': { createRouteHandlerClient: () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
        from: (table: string) => table === 'organization_members' ? query : { ...query, maybeSingle: async () => ({ data: null, error: null }) },
      }) },
      '@/lib/server/messaging-drafts': { getCurrentMessagingDraftVersionV1: async () => draft },
      '@/lib/messaging-contracts': {
        resolveApprovedEmailSendV1: () => ({ draft, to: 'ada@example.com', subject: 'Hello', text: null, html: '<p>Approved</p>' }),
        assertCanonicalEmailSendCompatibilityV1: () => {}, createMessagingSendMetadataV1: () => ({}),
      },
      '@/lib/server/privacy-subject-data': { isEmailSuppressedForScope: async () => false },
      '@/lib/unsubscribe-helpers': { generateUnsubscribeLink: () => 'https://example.test/unsubscribe?test' },
      '@/lib/email-outbound': { prepareOutboundEmail: () => ({ html: '<p>Approved</p>', text: 'Approved' }), validateOutboundEmail: () => ({ ok: true }) },
      '@/lib/services/token-service': { tokenService: { getToken: async () => ({ refresh_token: 'fake' }) } },
      '@/lib/server-auth-helpers': { refreshGoogleToken: async () => ({ access_token: 'fake' }), refreshMicrosoftToken: async () => ({ access_token: 'fake' }) },
      '@/lib/server/supabase-admin': { getSupabaseAdminClient: () => ({}) },
      '@/lib/server/reply-target': { ReplyTargetError, resolveCampaignReplyTarget: async (_client: any, _draft: any, dispatchProvider: any, mode: any) => {
        resolutions++;
        assert.equal(mode, deliveryMode);
        assert.equal(dispatchProvider, provider === 'google' ? 'gmail' : 'outlook');
        if (provider === 'outlook') throw new ReplyTargetError('OUTLOOK_NATIVE_REPLY_UNSUPPORTED');
        if (blocked) throw new ReplyTargetError('REPLY_PARENT_NOT_CONFIRMED');
        return target;
      } },
      '@/lib/server/daily-quota-store': { getEffectiveDailyQuotaLimits: async () => ({ contact: 10 }), reserveOutboundContactQuota: async () => ({ allowed: true }) },
      '@/lib/server-email-sender': { [provider === 'google' ? 'sendGmail' : 'sendOutlook']: async (_token: any, to: any, subject: any, html: any, options: any) => {
        sends++; assert.equal(options.replyTarget, isReply ? target : undefined); assert.equal(to, 'ada@example.com');
        assert.equal(subject, 'Hello'); assert.equal(html, '<p>Approved</p>');
        return { id: 'sent', threadId: 'thread' };
      } },
      '@/lib/server/outbound-dispatch': { dispatchOutboundMessage: async ({ provider }: any) => {
        const result = await provider.send({ dispatchId: 'dispatch' });
        assert.equal(result.outcome, rejected ? 'rejected' : 'accepted');
        if (rejected) assert.equal(result.response.providerInvoked, false);
        return { status: rejected ? 'failed' : 'sent', replayed: false, dispatch: { id: 'dispatch', idempotencyKey: 'key', providerMessageId: result.providerMessageId } };
      } },
    });
    const response = await post({ json: async () => ({ provider, deliveryMode, organizationId: 'org', draftId: 'draft', versionId: 'version', idempotencyKey: 'key' }), headers: new Headers() });
    assert.equal(response.status, rejected ? 502 : 200);
    assert.equal(sends, rejected ? 0 : 1);
    assert.equal(resolutions, isReply ? 1 : 0);
  }
  }
  }
});
test('send route continues to reject unapproved browser content', async () => {
  const response = await load()({ json: async () => ({ provider: 'google', to: 'ada@example.com', subject: 'Hello', htmlBody: '<p>Hello</p>' }), headers: new Headers() });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'APPROVED_DRAFT_REQUIRED');
});
test('reply resolution stays inside durable dispatch and before quota and provider send', () => {
  const claim = source.indexOf('await dispatchOutboundMessage');
  const resolve = source.indexOf('await resolveCampaignReplyTarget');
  const quota = source.indexOf('await reserveOutboundContactQuota');
  const provider = source.indexOf('await sendGmail');
  assert.ok(claim < resolve && resolve < quota && quota < provider);
  assert.match(source, /replyTarget \? \{ replyTarget \} : \{\}/);
  assert.match(source, /resolveApprovedEmailSendV1\(current\)/);
  assert.match(source, /OutboundPreProviderDeferredError\('Reply history/);
});
