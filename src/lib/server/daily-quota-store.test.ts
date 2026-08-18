import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { DEFAULT_DAILY_QUOTA_LIMITS } from '@/lib/daily-quota-limits';

const migrationPath = 'supabase/migrations/20260813100000_atomic_daily_quota.sql';
const operationMigrationPath = 'supabase/migrations/20260813120000_idempotent_enrichment_quota_operations.sql';
const sourcePath = 'src/lib/server/daily-quota-store.ts';
const functionsPath = 'functions/index.ts';
const leadResearchRoutePath = 'src/app/api/lead-research/route.ts';
const leadSearchRoutePath = 'src/app/api/leads/search/route.ts';
const backupCronRoutePath = 'src/app/api/cron/antonia/route.ts';
const enrichmentRoutePath = 'src/app/api/opportunities/enrich-apollo/route.ts';
const sql = readFileSync(migrationPath, 'utf8');
const operationSql = readFileSync(operationMigrationPath, 'utf8');
const source = readFileSync(sourcePath, 'utf8');
const functionsSource = readFileSync(functionsPath, 'utf8');
const leadResearchRoute = readFileSync(leadResearchRoutePath, 'utf8');
const leadSearchRoute = readFileSync(leadSearchRoutePath, 'utf8');
const backupCronRoute = readFileSync(backupCronRoutePath, 'utf8');
const enrichmentRoute = readFileSync(enrichmentRoutePath, 'utf8');
const modeHelpersStart = enrichmentRoute.indexOf('type EnrichmentMode');
const modeHelpersEnd = enrichmentRoute.indexOf('// Lazy initialization', modeHelpersStart);
const modeHelpersModule = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(
  `${enrichmentRoute.slice(modeHelpersStart, modeHelpersEnd)}\nexport { resolveEnrichmentMode, resolveQuotaResource };`,
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText).toString('base64')}`);

function functionBody(name: string) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = sql.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} must have a complete body`);
  return sql.slice(start, end);
}

function operationFunctionBody(name: string) {
  const start = operationSql.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = operationSql.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} must have a complete body`);
  return operationSql.slice(start, end);
}

test('atomic quota RPC validates its internal caller, ownership, scope, resource, and counts', () => {
  const body = functionBody('consume_antonia_daily_quota_v1');
  assert.match(body, /auth\.role\(\).*<> 'service_role'/);
  assert.match(body, /p_scope not in \('organization', 'user'\)/);
  assert.match(body, /p_resource not in \('leadSearch', 'search', 'enrich', 'investigate', 'research'\)/);
  assert.match(body, /p_requested_count <= 0/);
  assert.match(body, /p_limit < 0/);
  assert.match(body, /from public\.organization_members om/);
  assert.match(body, /om\.organization_id = p_organization_id/);
  assert.match(body, /om\.user_id = p_user_id/);
});

test('atomic quota RPC locks an upserted row and never increments a denied request', () => {
  const body = functionBody('consume_antonia_daily_quota_v1');
  assert.match(body, /on conflict \(organization_id, user_id, date, resource\) do nothing/);
  assert.match(body, /on conflict \(organization_id, date\) do nothing/);
  assert.match(body, /case when p_resource = 'research' then 'investigate'/);
  assert.equal((body.match(/for update;/g) || []).length, 2);
  assert.equal((body.match(/if v_current > p_limit - p_requested_count then/g) || []).length, 2);
  assert.equal((body.match(/return jsonb_build_object\('allowed', false, 'count', v_current, 'limit', p_limit\);/g) || []).length, 2);
  assert.ok(body.lastIndexOf("return jsonb_build_object('allowed', false") < body.indexOf('v_current := v_current + p_requested_count'));
});

test('atomic quota RPC is private to service role', () => {
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = pg_catalog/);
  assert.match(sql, /revoke all on function public\.consume_antonia_daily_quota_v1\([^)]+\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.consume_antonia_daily_quota_v1\([^)]+\) to service_role;/);
});

test('only service-controlled typed override columns can change effective quota', () => {
  const resolverStart = source.indexOf('function readQuotaLimitOverride');
  const resolverEnd = source.indexOf('async function resolveContactQuotaContext', resolverStart);
  const resolver = source.slice(resolverStart, resolverEnd);
  assert.match(resolver, /\.from\('user_quota_overrides'\)/);
  assert.match(resolver, /\.select\(overrideColumn\)/);
  assert.match(resolver, /value\?\.\[overrideKey\] \?\? 0/);
  assert.doesNotMatch(resolver, /profiles|signatures|quota_overrides\?\.|antonia\?\./);

  const workerResolverStart = functionsSource.indexOf('async function getEffectiveDailyContactQuota');
  const workerResolverEnd = functionsSource.indexOf('function sleep', workerResolverStart);
  const workerResolver = functionsSource.slice(workerResolverStart, workerResolverEnd);
  assert.match(workerResolver, /\.from\('user_quota_overrides'\)/);
  assert.match(workerResolver, /\.select\('daily_enrich_limit, daily_investigate_limit'\)/);
  assert.match(workerResolver, /daily_contact_limit \?\? 0/);
  assert.match(workerResolver, /value\?\.\[overrideKey\] \?\? 0/);
  assert.doesNotMatch(workerResolver, /\.from\('profiles'\)|signatures|quota_overrides\?\.|antonia\?\./);

  assert.match(sql, /add column if not exists daily_enrich_limit integer/);
  assert.match(sql, /add column if not exists daily_investigate_limit integer/);
  assert.match(sql, /revoke insert, update, delete, truncate on table public\.user_quota_overrides from public, anon, authenticated;/);
  assert.match(sql, /grant select, insert, update, delete on table public\.user_quota_overrides to service_role;/);
});

test('quota store delegates non-contact consumption once to the atomic RPC', () => {
  const start = source.indexOf('export async function checkAndConsumeDailyQuota');
  const end = source.indexOf('export async function getDailyQuotaStatus', start);
  const consume = source.slice(start, end);
  assert.match(consume, /resource === 'contact'/);
  assert.match(consume, /resolveUserScopedQuotaContext/);
  assert.match(consume, /p_scope: quota\.scope/);
  assert.equal((consume.match(/'consume_antonia_daily_quota_v1'/g) || []).length, 1);
  assert.equal((consume.match(/\.rpc\('consume_antonia_daily_quota_v1'/g) || []).length, 1);
  const contactBranch = consume.slice(
    consume.indexOf("if (resource === 'contact')"),
    consume.indexOf('if (!ATOMIC_DAILY_QUOTA_RESOURCES'),
  );
  assert.match(contactBranch, /getContactQuotaUsage/);
  assert.doesNotMatch(contactBranch, /consume_antonia_daily_quota_v1/);
  assert.doesNotMatch(consume, /increment_daily_usage/);
  assert.doesNotMatch(consume, /\.from\('antonia_daily_usage'\)/);
  assert.doesNotMatch(consume, /catch\s*\(/, 'quota infrastructure errors must reach the caller');

});

test('account quotas use the shared 100-operation policy instead of mission budgets', () => {
  assert.deepEqual(DEFAULT_DAILY_QUOTA_LIMITS, {
    leadSearch: 100,
    enrich: 100,
    research: 100,
    contact: 100,
  });
  assert.match(source, /DEFAULT_DAILY_QUOTA_LIMITS/);
  assert.doesNotMatch(source, /resolveMissionQuotaDefaults/);
});

test('quota resolution follows the same oldest organization membership as the client', () => {
  const resolverStart = source.indexOf('async function resolveOrganizationIdForQuota');
  const resolverEnd = source.indexOf('async function resolveUserScopedQuotaContext', resolverStart);
  const resolver = source.slice(resolverStart, resolverEnd);
  assert.match(resolver, /\.order\('created_at', \{ ascending: true \}\)/);
});

test('lead searches reserve the account quota before reaching an external provider', () => {
  const reserve = leadSearchRoute.indexOf('async function reserveLeadSearchQuota');
  const externalCall = leadSearchRoute.indexOf('await callLeadSearchService(');
  assert.ok(reserve >= 0 && externalCall > reserve);
  assert.match(leadSearchRoute, /resource: 'search'/);
  assert.match(leadSearchRoute, /DAILY_SEARCH_QUOTA_EXCEEDED/);
});

test('Firebase investigate reserves exact-scope quota before research and defers unstarted leads', () => {
  const start = functionsSource.indexOf('async function executeInvestigate');
  const end = functionsSource.indexOf('async function executeInitialContact', start);
  const investigate = functionsSource.slice(start, end);
  const reservation = investigate.indexOf('await consumeLeadProcessingQuota');
  const leadResearch = investigate.indexOf('fetch(getLeadResearchUrl()');
  const n8nResearch = investigate.indexOf('fetch(N8N_WEBHOOK_URL');

  if (reservation >= 0) {
    assert.ok(reservation < leadResearch);
    assert.ok(reservation < n8nResearch);
    assert.match(investigate, /organizationId: task\.organization_id/);
    assert.match(investigate, /scope: quota\.scope/);
    assert.match(investigate, /resource: 'investigate'/);
    assert.match(investigate, /deferredLeadsForQuota = leads\.slice\(investigateIndex - 1\)/);
    assert.match(investigate, /reason: 'daily_limit_reached'/);
    assert.match(investigate, /retryAt: getNextUtcDayStartIso\(\)/);
    assert.match(investigate, /task\.payload = \{ \.\.\.task\.payload, userId, leads: deferredLeadsForQuota \}/);
    assert.doesNotMatch(investigate, /incrementUsage\([^\n]*'investigate'/);
  }

  const processStart = functionsSource.indexOf('async function processTask(');
  const processEnd = functionsSource.indexOf('async function runAntoniaTick', processStart);
  const processTask = functionsSource.slice(processStart, processEnd);
  assert.match(processTask, /scheduled_for: retryAt,[\s\S]*payload: task\.payload,[\s\S]*result: result/);

  if (reservation >= 0) {
    const helperStart = functionsSource.indexOf('async function consumeLeadProcessingQuota');
    const helperEnd = functionsSource.indexOf('function sleep', helperStart);
    const helper = functionsSource.slice(helperStart, helperEnd);
    assert.equal((helper.match(/rpc\('consume_antonia_daily_quota_v1'/g) || []).length, 1);
    assert.match(helper, /p_organization_id: params\.organizationId/);
    assert.match(helper, /p_user_id: params\.userId/);
    assert.match(helper, /p_scope: params\.scope/);
    assert.match(helper, /p_limit: params\.limit/);
  }
});

test('lead research claims request identity before atomically consuming quota and calling the provider', () => {
  const start = leadResearchRoute.indexOf('export async function POST');
  const post = leadResearchRoute.slice(start);
  const claim = post.indexOf('await claimLeadResearchRequest({');
  const consume = post.indexOf('await consumeLeadResearchRequestQuota({');
  const submitting = post.indexOf('await markLeadResearchRequestProviderSubmitting(ownedClaim)');
  const provider = post.indexOf('await fetch(endpoint');

  assert.ok(start >= 0 && claim >= 0 && consume >= 0 && submitting >= 0 && provider >= 0);
  assert.ok(claim < consume, 'request ownership must happen before quota consumption');
  assert.ok(consume < provider, 'quota consumption must happen before the provider call');
  assert.ok(submitting < provider, 'the durable provider boundary must happen before the provider call');
  assert.match(post, /organizationId: ctx\.access\.organizationId \|\| undefined/);
  assert.match(post, /if \(!claim\.claimed\)/);
  assert.match(post, /status: 429/);
  assert.match(post, /retryAt: nextDayStartISOUTC\(\)/);
});

test('enrichment claims an operation after provider configuration and before any provider submission', () => {
  const start = enrichmentRoute.indexOf('export async function POST');
  const end = enrichmentRoute.indexOf('async function handlePdlEnrichment', start);
  const post = enrichmentRoute.slice(start, end);
  const organizationRequired = post.indexOf("error: 'ORGANIZATION_REQUIRED'");
  const providerDecision = post.indexOf('resolveLeadProvider({');
  const configValidation = post.indexOf('resolveApolloProviderConfiguration()');
  const replayLookup = post.indexOf('getEnrichmentQuotaOperation({');
  const claim = post.indexOf('claimEnrichmentQuotaOperation({');
  const submitting = post.indexOf('markEnrichmentQuotaOperationSubmitted(operationMutationIdentity)');
  const pdlProvider = post.indexOf('await handlePdlEnrichment({');
  const apolloProvider = post.indexOf('await fetch(externalUrl');

  assert.ok(start >= 0 && organizationRequired >= 0 && replayLookup >= 0 && providerDecision >= 0 && configValidation >= 0);
  assert.ok(claim >= 0 && submitting >= 0 && pdlProvider >= 0 && apolloProvider >= 0);
  assert.ok(organizationRequired < configValidation, 'organization membership must be required before provider validation');
  assert.ok(replayLookup < configValidation, 'an already charged retry must replay without requiring current provider configuration');
  assert.ok(providerDecision < configValidation, 'the selected provider must determine which configuration is required');
  assert.ok(configValidation < claim, 'provider configuration must be valid before charging quota');
  assert.ok(claim < submitting, 'the durable operation must be owned before the provider boundary');
  assert.ok(submitting < pdlProvider, 'the provider boundary callback must be prepared before PDL');
  assert.ok(submitting < apolloProvider, 'the provider boundary must be persisted before Apollo');
  assert.match(enrichmentRoute, /return mode === 'deep' \? 'investigate' : 'enrich'/);
  assert.match(post, /resource: quotaResource,[\s\S]*operationId: operationIdentity\.operationId,[\s\S]*count: leads\.length/);
  assert.match(post, /body\.resource != null/);
  assert.match(post, /resolveEnrichmentMode\(body\.mode, trustedInternalCaller, shouldRevealPhone\)/);
  assert.match(post, /status: 403/);
  assert.match(post, /status: 503/);
  assert.match(enrichmentRoute, /APOLLO_API_KEY missing/);
  assert.match(enrichmentRoute, /ENRICHMENT_SERVICE_SECRET missing/);
  assert.doesNotMatch(enrichmentRoute, /getDailyQuotaStatus|useMemQuota|QUOTA_FALLBACK_SECRET|x-quota-ticket/);
});

test('quota operation claim serializes concurrent callers and only the creator increments quota', () => {
  const body = operationFunctionBody('claim_antonia_quota_operation_v1');
  const insert = body.indexOf('insert into public.antonia_quota_operations');
  const lock = body.indexOf('for update;');
  const replayBranch = body.indexOf('if not v_created then');
  const replayReturn = body.indexOf("'response_payload', v_operation.response_payload", replayBranch);
  const consume = body.indexOf('public.consume_antonia_daily_quota_v1(');

  assert.ok(insert >= 0 && lock > insert && replayBranch > lock && replayReturn > replayBranch && consume > replayReturn);
  assert.match(body, /on conflict \(organization_id, user_id, resource, operation_id\) do nothing/);
  assert.match(body, /v_operation\.request_fingerprint <> lower\(trim\(p_request_fingerprint\)\)/);
  assert.equal((body.match(/public\.consume_antonia_daily_quota_v1\(/g) || []).length, 1);
  assert.match(operationSql, /unique \(organization_id, user_id, resource, operation_id\)/);
});

test('quota operation retries replay prior consumption and never reacquire submitted work', () => {
  const claim = operationFunctionBody('claim_antonia_quota_operation_v1');
  const existingBranch = claim.slice(claim.indexOf('if not v_created then'), claim.indexOf('v_quota :=', claim.indexOf('if not v_created then')));
  assert.match(existingBranch, /v_operation\.status = 'claimed'/);
  assert.doesNotMatch(existingBranch, /v_operation\.status = 'submitted'[\s\S]*v_claimed := true/);
  assert.match(existingBranch, /when v_operation\.status = 'submitted'[\s\S]*then 'unknown'/);
  assert.match(existingBranch, /'consumed', v_operation\.consumed_count/);
  assert.match(existingBranch, /'response_status', v_operation\.response_status/);
  assert.match(existingBranch, /'response_payload', v_operation\.response_payload/);

  const post = enrichmentRoute.slice(enrichmentRoute.indexOf('export async function POST'));
  assert.match(post, /if \(!claimedOperation\.claimed \|\| !claimedOperation\.allowed \|\| !claimedOperation\.claimToken\) \{\s*return operationStateResponse\(claimedOperation\);/);
  assert.match(post, /ProviderOutcomeUnknownError[\s\S]*completeEnrichmentQuotaOperation\(/);
  assert.match(post, /releaseEnrichmentQuotaOperation\(/);
});

test('an unconsumed quota denial can retry with the same operation after reset or a limit change', () => {
  const claim = operationFunctionBody('claim_antonia_quota_operation_v1');
  assert.match(claim, /v_operation\.status = 'failed'[\s\S]*not v_operation\.quota_allowed[\s\S]*v_operation\.response_status = 429/);
  assert.match(claim, /v_operation\.quota_day < v_day/);
  assert.match(claim, /v_operation\.quota_scope <> p_scope/);
  assert.match(claim, /v_operation\.quota_limit <> p_limit/);
  assert.match(claim, /set quota_scope = p_scope, quota_day = v_day[\s\S]*status = 'claimed'/);
});

test('quota operation ledger and RPCs are service-role only', () => {
  assert.match(operationSql, /alter table public\.antonia_quota_operations enable row level security;/);
  assert.match(operationSql, /revoke all on table public\.antonia_quota_operations from public, anon, authenticated;/);
  for (const name of [
    'claim_antonia_quota_operation_v1',
    'mark_antonia_quota_operation_submitted_v1',
    'complete_antonia_quota_operation_v1',
    'release_antonia_quota_operation_v1',
  ]) {
    const body = operationFunctionBody(name);
    assert.match(body, /auth\.role\(\).*<> 'service_role'/);
    assert.match(operationSql, new RegExp(`revoke all on function public\\.${name}\\([^)]+\\) from public, anon, authenticated;`));
    assert.match(operationSql, new RegExp(`grant execute on function public\\.${name}\\([^)]+\\) to service_role;`));
  }
});

test('enrichment requires a client operation identity and does not use content-only daily deduplication', () => {
  assert.match(enrichmentRoute, /req\.headers\.get\('idempotency-key'\)/);
  assert.match(enrichmentRoute, /body\.operationId/);
  assert.match(enrichmentRoute, /IDEMPOTENCY_KEY_REQUIRED/);
  assert.match(enrichmentRoute, /IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST/);
  assert.match(enrichmentRoute, /createHash\('sha256'\)[\s\S]*JSON\.stringify\(normalized\)/);
  assert.match(enrichmentRoute, /requestedProvider: params\.requestedProvider \|\| null/);
  assert.doesNotMatch(operationSql, /unique \([^)]*request_fingerprint[^)]*\)/);
});

test('enrichment mode cannot be forged or made inconsistent with requested fields', () => {
  assert.deepEqual(modeHelpersModule.resolveEnrichmentMode(undefined, false, false), { ok: true, mode: 'normal' });
  assert.deepEqual(modeHelpersModule.resolveEnrichmentMode(undefined, false, true), { ok: true, mode: 'deep' });
  assert.equal(modeHelpersModule.resolveEnrichmentMode('deep', false, true).ok, false);
  assert.equal(modeHelpersModule.resolveEnrichmentMode('normal', true, true).ok, false);
  assert.deepEqual(modeHelpersModule.resolveEnrichmentMode('deep', true, true), { ok: true, mode: 'deep' });
  assert.equal(modeHelpersModule.resolveQuotaResource('normal'), 'enrich');
  assert.equal(modeHelpersModule.resolveQuotaResource('deep'), 'investigate');
});

test('backup enrichment delegates atomic quota authority and preserves unrelated usage increments', () => {
  const start = backupCronRoute.indexOf('async function executeEnrichment');
  const end = backupCronRoute.indexOf('async function executeContact', start);
  const enrichment = backupCronRoute.slice(start, end);

  assert.match(enrichment, /\/api\/opportunities\/enrich-apollo/);
  assert.match(enrichment, /mode: isDeep \? 'deep' : 'normal'/);
  assert.match(enrichment, /'x-organization-id': task\.organization_id/);
  assert.match(enrichment, /'Idempotency-Key': `antonia-task:\$\{task\.id\}:enrich`/);
  assert.match(enrichment, /response\.status === 429/);
  assert.doesNotMatch(enrichment, /incrementUsage\(/);
  assert.doesNotMatch(enrichment, /getDailyUsage|getDailyQuotaStatus|getUserScopedAntoniaQuotaStatus/);
  assert.match(backupCronRoute, /incrementUsage\(supabase, task\.organization_id, 'search'/);
  assert.match(backupCronRoute, /incrementUsage\(supabase, task\.organization_id, 'search_run'/);
  assert.match(backupCronRoute, /incrementUsage\(supabase, task\.organization_id, 'contact'/);
});
