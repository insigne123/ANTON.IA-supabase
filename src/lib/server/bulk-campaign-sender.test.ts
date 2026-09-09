import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync('src/lib/server/bulk-campaign-sender.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
class Deferred extends Error { constructor(message: string, public options: any) { super(message); } }
function harness(options: { replay?: boolean; paused?: boolean; suppressed?: boolean; suppressionError?: boolean; tokenMissing?: boolean; quota?: boolean; changed?: boolean; provider?: string } = {}) {
  const calls: string[] = [];
  const message = { draftId: 'draft', versionId: 'version', subject: 'Aprobado', body: 'Contenido aprobado', delayDays: 0 };
  const campaign = { id: 'campaign', organization_id: 'org', user_id: 'owner', review_hash: 'hash', definition: { provider: options.provider || 'google' } };
  const query: any = { select() { return this; }, eq() { return this; }, single: async () => ({ data: { status: options.paused ? 'paused' : 'approved', review_hash: 'hash' } }) };
  const modules: Record<string, any> = {
    '@/lib/server/supabase-admin': { getSupabaseAdminClient: () => ({ from: () => query }) },
    '@/lib/server/messaging-drafts': { getCurrentMessagingDraftVersionV1: async () => ({ versionId: options.changed ? 'changed' : 'version' }) },
    '@/lib/messaging-contracts': {
      resolveApprovedEmailSendV1: () => ({ to: 'ana@example.com', subject: message.subject, text: message.body, html: null }),
      createMessagingSendMetadataV1: (_draft: unknown, metadata: any) => { assert.equal(metadata.idempotencyKey, 'bulk:campaign:draft'); return metadata; },
    },
    '@/lib/email-outbound': { prepareOutboundEmail: () => ({ text: message.body, html: '<p>Contenido aprobado</p>' }), validateOutboundEmail: () => ({ ok: true }) },
    '@/lib/unsubscribe-helpers': { generateUnsubscribeLink: () => 'https://example.test/unsubscribe' },
    '@/lib/server/privacy-subject-data': { isEmailSuppressedForScope: async () => { calls.push('privacy'); if (options.suppressionError) throw new Error('db unavailable'); return options.suppressed; } },
    '@/lib/services/token-service': { tokenService: { getToken: async () => { calls.push('token'); return options.tokenMissing ? null : { refresh_token: 'fixture' }; } } },
    '@/lib/server-auth-helpers': { refreshGoogleToken: async () => { calls.push('refresh'); return { access_token: 'fixture' }; }, refreshMicrosoftToken: async () => { calls.push('refresh'); return { access_token: 'fixture' }; } },
    '@/lib/server/token-crypto': {},
    '@/lib/server/daily-quota-store': { getEffectiveDailyQuotaLimits: async () => ({ contact: 10 }), reserveOutboundContactQuota: async () => { calls.push('quota'); return { allowed: options.quota !== false }; } },
    '@/lib/server-email-sender': Object.fromEntries(['sendGmail', 'sendOutlook'].map(name => [name, async (_token: string, to: string, subject: string) => {
      assert.equal(to, 'ana@example.com'); assert.equal(subject, message.subject); calls.push(name); return { id: 'receipt' };
    }])),
    '@/lib/server/outbound-dispatch': { OutboundPreProviderDeferredError: Deferred, dispatchOutboundMessage: async ({ provider }: any) => {
      calls.push('claim'); if (options.replay) return { status: 'sent', replayed: true };
      return provider.send({ dispatchId: 'dispatch' });
    } },
  };
  const exports: any = {};
  new Function('require', 'exports', 'process', compiled)((name: string) => {
    if (!(name in modules)) throw new Error(`Unmocked dependency ${name}`);
    return modules[name];
  }, exports, { env: { BULK_CAMPAIGNS_ENABLED: 'true' } });
  return { calls, send: () => exports.sendBulkCampaignMessage(campaign, message) };
}

test('background sender uses approved content and reserves quota after durable claim for both providers', async t => {
  for (const provider of ['google', 'outlook']) {
    const { calls, send } = harness({ provider });
    assert.equal((await send()).outcome, 'accepted');
    assert.deepEqual(calls, ['claim', 'privacy', 'token', 'refresh', 'quota', provider === 'google' ? 'sendGmail' : 'sendOutlook']);
  }
});
test('replay, pause, changed version, suppression and quota never invoke an email provider', async t => {
  for (const options of [{ replay: true }, { paused: true }, { suppressed: true }, { quota: false }]) {
    const { calls, send } = harness(options); await send();
    assert.equal(calls.some(value => value.startsWith('send')), false);
  }
  const changed = harness({ changed: true }); await assert.rejects(changed.send(), /REVIEW_CHANGED/); assert.deepEqual(changed.calls, []);
});
test('pre-provider privacy and connection failures defer instead of reporting ambiguous delivery', async t => {
  for (const options of [{ suppressionError: true }, { tokenMissing: true }]) {
    const { calls, send } = harness(options);
    await assert.rejects(send(), error => error instanceof Deferred);
    assert.equal(calls.includes('quota'), false); assert.equal(calls.some(value => value.startsWith('send')), false);
  }
});
