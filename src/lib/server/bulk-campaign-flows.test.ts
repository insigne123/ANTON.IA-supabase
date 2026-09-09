import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { defaultAudience } from '../bulk-campaigns';

class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

function loadModule(file: string, modules: Record<string, any>) {
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: any = {};
  new Function('require', 'exports', compiled)((name: string) => {
    if (!(name in modules)) throw new Error(`Unmocked dependency ${name}`);
    return modules[name];
  }, exports);
  return exports;
}

function chain(result: any) {
  const self: any = {
    select() { return self; }, eq() { return self; }, ilike() { return self; },
    order() { return self; }, limit() { return self; }, insert() { return self; },
    delete() { return self; }, single: async () => result,
    then(resolve: any, reject: any) { return Promise.resolve(result).then(resolve, reject); },
  };
  return self;
}

const ORG = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const campaign = {
  id: 'campaign', organization_id: ORG, user_id: OWNER, revision: 1, status: 'approved',
  review_hash: 'a'.repeat(64), approved_at: '2026-09-01T00:00:00Z',
  definition: { name: 'Campaña', description: '', objective: 'Conversar', provider: 'google', criteria: defaultAudience, emails: ['ana@example.com'], messages: [{ subject: 'Hola', body: 'Texto', delayDays: 0 }], overrides: [] },
  recipients: [{ email: 'ana@example.com', name: 'Ana', leadRef: 'lead',
    messages: [{ subject: 'Hola', body: 'Texto', delayDays: 0, draftId: 'draft-0', versionId: 'version-0' }] }],
};

test('search attaches deterministic reasons and drops rows outside the criteria', async () => {
  const { searchAudiencePage } = loadModule('src/lib/server/bulk-campaign-audience.ts', {
    zod: await import('zod'),
    '@/lib/server/auth-utils': {},
    '@/lib/server/supabase-admin': { getSupabaseAdminClient: () => ({ rpc: async () => ({ data: {
      total: 3,
      people: [
        { email: 'ana@example.com', name: 'Ana', contacted: false, replied: false, blockedReason: null, lastSentAt: null, leadRef: 'l1' },
        { email: 'old@example.com', name: 'Old', contacted: true, replied: false, blockedReason: null, lastSentAt: '2020-01-01T00:00:00Z', leadRef: 'l2' },
        { email: 'bad-email', name: 'Bad', contacted: false, replied: false, blockedReason: null, lastSentAt: null, leadRef: 'l3' },
      ] }, error: null }) }) },
    '@/lib/bulk-campaigns': await import('../bulk-campaigns'),
  });
  const result = await searchAudiencePage({ organizationId: ORG, user: { id: OWNER } }, { criteria: defaultAudience, search: '', page: 0, pageSize: 25 });
  assert.equal(result.total, 3);
  assert.deepEqual(result.people.map((person: any) => person.email), ['ana@example.com']);
  assert.deepEqual(result.people[0].reasons, ['Sin envíos registrados']);
});

test('recipient history is scoped to the campaign member and merges sources', async () => {
  const { getBulkRecipientHistory } = loadModule('src/lib/server/bulk-campaign-history.ts', {
    zod: await import('zod'),
    '@/lib/server/auth-utils': { AuthError },
    '@/lib/bulk-campaigns': await import('../bulk-campaigns'),
    '@/lib/server/bulk-campaigns': {
      getBulkCampaign: async () => campaign,
      campaignDeliveries: async () => [{ draft_id: 'draft-0', status: 'sent', completed_at: '2026-09-05T00:00:00Z', error_message: null }],
    },
    '@/lib/server/bulk-campaign-attempts': { getCampaignAttempts: async () => [] },
  });
  const auth: any = { supabase: { from: () => chain({ data: [{ status: 'sent', sent_at: '2026-01-01T00:00:00Z', replied_at: null, subject: 'Previo' }], error: null }) } };
  const result = await getBulkRecipientHistory(auth, 'campaign', 'ANA@example.com');
  assert.equal(result.recipient.email, 'ana@example.com');
  assert.equal(result.events[0].kind, 'campaign_sent');
  assert.equal(result.events[result.events.length - 1].kind, 'contacted');
  await assert.rejects(getBulkRecipientHistory(auth, 'campaign', 'outside@example.com'), /no pertenece/);
});

test('pending revision rejects locked changes and rebuilds only editable drafts', async () => {
  let rpcArgs: any = null;
  const server: any = {
    getBulkCampaign: async () => campaign,
    campaignDeliveries: async () => [],
    assertCampaignRecipientAllowed: async () => {},
  };
  const { reviseBulkCampaignPending } = loadModule('src/lib/server/bulk-campaign-revise.ts', {
    zod: await import('zod'),
    '@/lib/server/auth-utils': { AuthError },
    '@/lib/bulk-campaigns': await import('../bulk-campaigns'),
    '@/lib/messaging-contracts': await import('../messaging-contracts'),
    '@/lib/email-outbound': await import('../email-outbound'),
    '@/lib/server/supabase-admin': { getSupabaseAdminClient: () => ({ rpc: async (_name: string, args: any) => { rpcArgs = args; return { data: { ...campaign, revision: 2 }, error: null }; } }) },
    '@/lib/server/bulk-campaigns': server,
    '@/lib/server/bulk-campaign-audience': { loadAudience: async (_auth: unknown, criteria: unknown) => {
      assert.equal(criteria, undefined, 'revision must not exclude enrolled people after their first send');
      return [{ email: 'ana@example.com', name: 'Ana', company: '', title: '', industry: '', country: '', size: '', seniority: '', leadRef: 'lead', lastSentAt: '2026-09-05T00:00:00Z', contacted: true, replied: false, blockedReason: null, reasons: [] }];
    } },
  });
  const auth: any = { organizationId: ORG, user: { id: OWNER } };
  const base = { revision: 1, reviewHash: 'a'.repeat(64), definition: campaign.definition };
  const revised = await reviseBulkCampaignPending(auth, 'campaign', {
    ...base,
    definition: { ...campaign.definition, messages: [{ subject: 'Hola v2', body: 'Texto v2', delayDays: 0 }] },
  });
  assert.equal(revised.revision, 2);
  assert.equal(rpcArgs.p_drafts.length, 1);
  assert.match(rpcArgs.p_drafts[0].payload.content.subject, /Hola v2/);

  server.campaignDeliveries = async () => [{ draft_id: 'draft-0', status: 'sent', completed_at: '2026-09-05T00:00:00Z', error_message: null }];
  await assert.rejects(reviseBulkCampaignPending(auth, 'campaign', {
    ...base,
    definition: { ...campaign.definition, messages: [{ subject: 'Cambiado', body: 'Texto', delayDays: 0 }] },
  }), /no se puede modificar/);
  await assert.rejects(reviseBulkCampaignPending(auth, 'campaign', {
    ...base, definition: { ...campaign.definition, emails: ['other@example.com'] },
  }), /audiencia aprobada/);
});

test('audience profiles validate criteria, cap at twenty and scope deletes', async () => {
  const { createAudienceProfile, deleteAudienceProfile, listAudienceProfiles } = loadModule('src/lib/server/bulk-audience-profiles.ts', {
    zod: await import('zod'),
    '@/lib/server/auth-utils': { AuthError },
    '@/lib/bulk-campaigns': await import('../bulk-campaigns'),
  });
  const rows = Array.from({ length: 20 }, (_, index) => ({ id: `id-${index}`, name: `P${index}`, criteria: defaultAudience, created_at: 'now' }));
  const auth: any = { organizationId: ORG, user: { id: OWNER }, supabase: { from: () => chain({ data: rows, error: null }) } };
  assert.equal((await listAudienceProfiles(auth)).length, 20);
  await assert.rejects(createAudienceProfile(auth, { name: 'Otro', criteria: defaultAudience }), /máximo/);
  await assert.rejects(createAudienceProfile(auth, { name: 'Malo', criteria: { nope: true } }), /./);
  const empty: any = { organizationId: ORG, user: { id: OWNER }, supabase: { from: () => chain({ data: [], error: null }) } };
  await assert.rejects(deleteAudienceProfile(empty, '12345678-1234-1234-1234-123456789012'), /No encontramos/);
  await assert.rejects(deleteAudienceProfile(empty, 'not-a-uuid'), /./);
});

test('reapproval accepts prior initial send but still blocks new first contact and replies', async () => {
  const contract = await import('../messaging-contracts');
  const initial = { subject: 'Hola', body: 'Un mensaje aprobado.', delayDays: 0,
    draftId: '33333333-3333-4333-8333-333333333333', versionId: '44444444-4444-4444-8444-444444444444' };
  const stored = { ...campaign, status: 'draft', recipients: [{ ...campaign.recipients[0], messages: [initial] }] };
  let sent = true;
  let replied = false;
  let writes = 0;
  const { reviewBulkCampaign } = loadModule('src/lib/server/bulk-campaigns.ts', {
    'node:crypto': await import('node:crypto'), zod: await import('zod'),
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/bulk-campaigns': await import('../bulk-campaigns'),
    '@/lib/bulk-campaign-attempts': await import('../bulk-campaign-attempts'),
    '@/lib/server/bulk-campaign-attempts': { getCampaignAttempts: async () => [] },
    '@/lib/messaging-contracts': contract,
    '@/lib/email-outbound': await import('../email-outbound'),
    '@/lib/server/auth-utils': { AuthError },
    '@/lib/server/privacy-subject-data': { isEmailSuppressedForScope: async () => false },
    '@/lib/server/supabase-admin': { getSupabaseAdminClient: () => ({
      from: () => chain({ data: [], error: null }),
      rpc: async () => { writes++; return { data: stored, error: null }; },
    }) },
    '@/lib/server/bulk-campaign-audience': { loadAudience: async () => [{ email: 'ana@example.com', contacted: true, replied, blockedReason: null }] },
  });
  const auth = { organizationId: ORG, user: { id: OWNER }, supabase: { from: (table: string) => {
    const query = chain({ data: sent ? [{ draft_id: initial.draftId, status: 'sent' }] : [], error: null });
    query.in = () => query;
    query.maybeSingle = async () => ({ data: stored, error: null });
    return query;
  } } };
  const action = { action: 'approve', revision: 1, reviewHash: stored.review_hash };
  await reviewBulkCampaign(auth, '55555555-5555-4555-8555-555555555555', action);
  assert.equal(writes, 1);
  sent = false;
  await assert.rejects(reviewBulkCampaign(auth, '55555555-5555-4555-8555-555555555555', action), /criterios/);
  sent = true; replied = true;
  await assert.rejects(reviewBulkCampaign(auth, '55555555-5555-4555-8555-555555555555', action), /criterios/);
  assert.equal(writes, 1);
});
