import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEFAULT_DAILY_QUOTA_LIMITS } from '@/lib/daily-quota-limits';

const operationMigrationPath = 'supabase/migrations/20260813120000_idempotent_enrichment_quota_operations.sql';
const sharedCreditsMigrationPath = 'supabase/migrations/20260904220304_shared_daily_account_credits.sql';
const sourcePath = 'src/lib/server/daily-quota-store.ts';
const functionsPath = 'functions/index.ts';
const leadResearchRoutePath = 'src/app/api/lead-research/route.ts';
const leadSearchRoutePath = 'src/app/api/leads/search/route.ts';
const backupCronRoutePath = 'src/app/api/cron/antonia/route.ts';
const enrichmentRoutePath = 'src/app/api/opportunities/enrich-apollo/route.ts';
const supliaRunnerPath = 'src/lib/server/suplia-tool-runner.ts';
const supliaResearchPath = 'src/lib/server/suplia-research-tools.ts';
const operationSql = readFileSync(operationMigrationPath, 'utf8');
const sharedCreditsSql = readFileSync(sharedCreditsMigrationPath, 'utf8');
const source = readFileSync(sourcePath, 'utf8');
const functionsSource = readFileSync(functionsPath, 'utf8');
const leadResearchRoute = readFileSync(leadResearchRoutePath, 'utf8');
const leadSearchRoute = readFileSync(leadSearchRoutePath, 'utf8');
const backupCronRoute = readFileSync(backupCronRoutePath, 'utf8');
const enrichmentRoute = readFileSync(enrichmentRoutePath, 'utf8');
const supliaRunner = readFileSync(supliaRunnerPath, 'utf8');
const supliaResearch = readFileSync(supliaResearchPath, 'utf8');

function operationFunctionBody(name: string) {
  const marker = `create or replace function public.${name}`;
  const sql = sharedCreditsSql.includes(marker) ? sharedCreditsSql : operationSql;
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = sql.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} must have a complete body`);
  return sql.slice(start, end);
}

function sharedCreditsFunctionBody(name: string) {
  const start = sharedCreditsSql.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `${name} must exist in the shared credit migration`);
  const end = sharedCreditsSql.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} must have a complete body`);
  return sharedCreditsSql.slice(start, end);
}

test('atomic quota RPC validates its internal caller, ownership, scope, resource, and counts', () => {
  const body = sharedCreditsFunctionBody('consume_antonia_daily_quota_v1');
  assert.match(body, /auth\.role\(\).*<> 'service_role'/);
  assert.match(body, /p_scope not in \('organization', 'user'\)/);
  assert.match(body, /p_resource not in \('leadSearch', 'search', 'enrich', 'investigate', 'research'\)/);
  assert.match(body, /p_requested_count <= 0/);
  assert.match(body, /p_limit < 0/);
  assert.match(body, /from public\.organization_members member/);
  assert.match(body, /member\.organization_id = p_organization_id/);
  assert.match(body, /member\.user_id = p_user_id/);
});

test('atomic quota RPC locks an upserted row and never increments a denied request', () => {
  const body = sharedCreditsFunctionBody('consume_antonia_user_daily_credits_v1');
  assert.match(body, /on conflict \(user_id, date\) do nothing/);
  assert.match(body, /for update;/);
  assert.match(body, /if v_usage\.usage_count > v_limit - p_requested_count then/);
  assert.match(body, /usage_count = credits\.usage_count \+ p_requested_count/);
  assert.match(body, /search_count = credits\.search_count \+ case when v_resource = 'search'/);
  assert.ok(body.indexOf("'allowed', false") < body.indexOf('update public.antonia_user_daily_credits'));
});

test('atomic quota RPC is private to service role', () => {
  assert.match(sharedCreditsSql, /security definer/);
  assert.match(sharedCreditsSql, /set search_path = pg_catalog/);
  assert.match(sharedCreditsSql, /revoke all on function public\.consume_antonia_daily_quota_v1\([^)]+\)[\s\S]*from public, anon, authenticated;/);
  assert.match(sharedCreditsSql, /grant execute on function public\.consume_antonia_daily_quota_v1\([^)]+\)[\s\S]*to service_role;/);
});

test('only service-controlled typed override columns can change effective quota', () => {
  const resolverStart = source.indexOf('async function resolveDailyCreditQuotaContext');
  const resolverEnd = source.indexOf('export async function getEffectiveDailyQuotaLimits', resolverStart);
  const resolver = source.slice(resolverStart, resolverEnd);
  assert.match(resolver, /\.from\('user_quota_overrides'\)/);
  assert.match(resolver, /\.select\('daily_credit_limit'\)/);
  assert.match(resolver, /Math\.min\(DEFAULT_DAILY_CREDIT_LIMIT/);
  assert.doesNotMatch(resolver, /profiles|signatures|quota_overrides\?\.|antonia\?\./);

  const workerResolverStart = functionsSource.indexOf('async function getEffectiveDailyContactQuota');
  const workerResolverEnd = functionsSource.indexOf('function sleep', workerResolverStart);
  const workerResolver = functionsSource.slice(workerResolverStart, workerResolverEnd);
  assert.match(workerResolver, /\.from\('user_quota_overrides'\)/);
  assert.match(workerResolver, /\.select\('daily_credit_limit'\)/);
  assert.match(workerResolver, /daily_contact_limit \?\? 0/);
  assert.match(workerResolver, /Math\.min\(DEFAULT_DAILY_CREDIT_LIMIT/);
  assert.doesNotMatch(workerResolver, /\.from\('profiles'\)|signatures|quota_overrides\?\.|antonia\?\./);

  assert.match(sharedCreditsSql, /add column if not exists daily_credit_limit integer/);
  assert.match(sharedCreditsSql, /daily_credit_limit between 1 and 50/);
  assert.match(sharedCreditsSql, /set daily_credit_limit = case[\s\S]*least\(50, quota_override\.daily_enrich_limit, quota_override\.daily_investigate_limit\)/);
  assert.match(sharedCreditsSql, /where quota_override\.daily_credit_limit is null/);
  assert.match(sharedCreditsSql, /revoke all on table public\.antonia_user_daily_credits from public, anon, authenticated;/);
  assert.match(sharedCreditsSql, /grant select on table public\.antonia_user_daily_credits to service_role;/);
});

test('quota store delegates non-contact consumption once to the atomic RPC', () => {
  const start = source.indexOf('export async function checkAndConsumeDailyQuota');
  const end = source.indexOf('export async function getDailyQuotaStatus', start);
  const consume = source.slice(start, end);
  assert.match(consume, /resource === 'contact'/);
  assert.match(consume, /resolveDailyCreditQuotaContext/);
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

test('account credits share one 50-operation policy instead of mission budgets', () => {
  assert.deepEqual(DEFAULT_DAILY_QUOTA_LIMITS, {
    leadSearch: 50,
    enrich: 50,
    research: 50,
    contact: 100,
  });
  assert.match(source, /DEFAULT_DAILY_QUOTA_LIMITS/);
  assert.doesNotMatch(source, /resolveMissionQuotaDefaults/);
  assert.match(source, /\.from\('antonia_user_daily_credits'\)/);
  assert.match(sharedCreditsSql, /primary key \(user_id, date\)/);
});

test('cutover backfill deduplicates legacy counters while adding distinct research work', () => {
  assert.match(sharedCreditsSql, /'legacy_investigate'[\s\S]*'operation_investigate'[\s\S]*'research_job'/);
  assert.match(sharedCreditsSql, /total\.source_kind = 'operation_investigate'[\s\S]*\+[\s\S]*total\.source_kind = 'research_job'/);
  assert.match(sharedCreditsSql, /greatest\([\s\S]*total\.source_kind = 'legacy_investigate'/);
  assert.match(sharedCreditsSql, /\+[\s\S]*total\.source_kind = 'suplia_investigate'/);
});

test('all metered resources use the same user-scoped atomic credit boundary', () => {
  const consume = sharedCreditsFunctionBody('consume_antonia_daily_quota_v1');
  assert.match(consume, /consume_antonia_user_daily_credits_v1\([\s\S]*p_user_id, p_resource, p_requested_count/);
  assert.doesNotMatch(consume, /update public\.antonia_daily_usage/);

  const research = sharedCreditsFunctionBody('consume_lead_research_request_quota_v1');
  const researchRelease = sharedCreditsFunctionBody('release_lead_research_request_claim_v1');
  assert.match(research, /consume_antonia_user_daily_credits_v1\(p_user_id, 'investigate', 1\)/);
  assert.match(research, /quota_scope = 'user'/);
  assert.match(researchRelease, /request_claim_state = 'pre_provider'[\s\S]*release_antonia_user_daily_credits_v1/);
  assert.match(researchRelease, /quota_consumed_at = case when v_job\.request_claim_state = 'pre_provider' then null/);

  const release = sharedCreditsFunctionBody('release_antonia_quota_operation_v1');
  const settlement = sharedCreditsFunctionBody('settle_apollo_enrichment_quota_if_ready_v1');
  const suppression = sharedCreditsFunctionBody('cancel_native_lead_research_request_claim_v1');
  assert.match(release, /release_antonia_user_daily_credits_v1/);
  assert.match(settlement, /release_antonia_user_daily_credits_v1/);
  assert.match(suppression, /release_antonia_user_daily_credits_v1/);

  const suplia = sharedCreditsFunctionBody('consume_suplia_research_tool_credit_v1');
  assert.match(suplia, /from public\.suplia_tool_runs run[\s\S]*for update;/);
  assert.match(suplia, /consume_antonia_user_daily_credits_v1\(p_user_id, 'investigate', 1\)/);
  assert.match(suplia, /insert into public\.antonia_suplia_research_credit_operations/);
  assert.match(sharedCreditsSql, /revoke all on table public\.antonia_suplia_research_credit_operations from public, anon, authenticated;/);
  assert.match(sharedCreditsSql, /revoke all on function public\.consume_suplia_research_tool_credit_v1\(uuid, uuid, uuid\)[\s\S]*from public, anon, authenticated;/);
  assert.match(sharedCreditsSql, /grant execute on function public\.consume_suplia_research_tool_credit_v1\(uuid, uuid, uuid\)[\s\S]*to service_role;/);
  assert.match(supliaRunner, /consumeSupliaResearchToolCredit\([\s\S]*toolRunId: toolRun\.id/);
  assert.match(supliaResearch, /if \(!context\.consumeResearchCredit\) throw new Error\('RESEARCH_CREDIT_RESERVATION_REQUIRED'\)/);
  assert.match(supliaResearch, /needEnv\('SERPER_API_KEY'\);[\s\S]*await consumePremiumResearchCredit\(context\);[\s\S]*await searchSerper\(search\)/);
  assert.match(supliaResearch, /needEnv\('BRANDDEV_API_KEY'\);[\s\S]*await consumePremiumResearchCredit\(context\);[\s\S]*fetchJsonWithTimeout/);
});

test('Firebase search cannot bypass the central account credit reservation', () => {
  const start = functionsSource.indexOf('async function executeSearch');
  const end = functionsSource.indexOf('async function executeEnrichment', start);
  const search = functionsSource.slice(start, end);
  assert.match(search, /fetch\(internalUrl/);
  assert.match(search, /DAILY_SEARCH_QUOTA_EXCEEDED/);
  assert.doesNotMatch(search, /getLeadSearchUrl|fallbackUrl|x-api-secret-key/);
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

test('enrichment replays before gateway configuration and claims before Apollo submission', () => {
  const start = enrichmentRoute.indexOf('export async function POST');
  const post = enrichmentRoute.slice(start);
  const organizationRequired = post.indexOf("error: 'ORGANIZATION_REQUIRED'");
  const providerDecision = post.indexOf('resolveLeadProvider({');
  const configValidation = post.indexOf('assertApolloEnrichmentConfigured();');
  const replayLookup = post.indexOf('getEnrichmentQuotaOperation({');
  const claim = post.indexOf('claimEnrichmentQuotaOperation({');
  const submitting = post.indexOf('await markEnrichmentQuotaOperationSubmitted(mutationIdentity)');
  const apolloProvider = post.indexOf('await submitApolloEnrichment({');

  assert.ok(start >= 0 && organizationRequired >= 0 && replayLookup >= 0 && providerDecision >= 0 && configValidation >= 0);
  assert.ok(claim >= 0 && submitting >= 0 && apolloProvider >= 0);
  assert.ok(organizationRequired < configValidation, 'organization membership must be required before provider validation');
  assert.ok(replayLookup < configValidation, 'an already charged retry must replay without requiring current provider configuration');
  assert.ok(providerDecision < configValidation, 'the selected provider must determine which configuration is required');
  assert.ok(configValidation < claim, 'provider configuration must be valid before charging quota');
  assert.ok(claim < submitting, 'the durable operation must be owned before the provider boundary');
  assert.ok(submitting < apolloProvider, 'the provider boundary must be persisted before Apollo');
  assert.match(enrichmentRoute, /return mode === 'deep' \? 'investigate' : 'enrich'/);
  assert.match(post, /resource,[\s\S]*operationId: operation\.operationId,[\s\S]*count: leads\.length/);
  assert.match(post, /body\.resource != null/);
  assert.match(post, /resolveMode\(body\.mode, trustedInternal, revealPhone\.value\)/);
  assert.match(enrichmentRoute, /'people_search_leads'/);
  assert.match(enrichmentRoute, /input\.tableName === 'people_search_leads'/);
  assert.match(enrichmentRoute, /organization_domain: cleanDomain\(lead\.companyDomain\)/);
  assert.match(post, /status: 403/);
  assert.match(post, /ENRICHMENT_SERVICE_SECRET_NOT_CONFIGURED' \? 503/);
  assert.match(enrichmentRoute, /ENRICHMENT_SERVICE_SECRET_NOT_CONFIGURED/);
  assert.match(enrichmentRoute, /APOLLO_WEBHOOK_URL_NOT_CONFIGURED/);
  assert.doesNotMatch(enrichmentRoute, /handlePdlEnrichment|enrichPersonWithPDL/);
  assert.doesNotMatch(enrichmentRoute, /getDailyQuotaStatus|useMemQuota|QUOTA_FALLBACK_SECRET|x-quota-ticket/);
});

test('quota operation claim serializes concurrent callers and only the creator increments quota', () => {
  const body = operationFunctionBody('claim_antonia_quota_operation_v1');
  const insert = body.indexOf('insert into public.antonia_quota_operations');
  const lock = body.indexOf('for update;');
  const replayBranch = body.indexOf('if not v_created then');
  const replayReturn = body.indexOf("'response_payload', v_operation.response_payload", replayBranch);
  const consume = body.indexOf('public.consume_antonia_user_daily_credits_v1(');

  assert.ok(insert >= 0 && lock > insert && replayBranch > lock && replayReturn > replayBranch && consume > replayReturn);
  assert.match(body, /on conflict \(organization_id, user_id, resource, operation_id\) do nothing/);
  assert.match(body, /v_operation\.request_fingerprint <> lower\(trim\(p_request_fingerprint\)\)/);
  assert.equal((body.match(/public\.consume_antonia_user_daily_credits_v1\(/g) || []).length, 1);
  assert.doesNotMatch(body, /public\.consume_antonia_daily_quota_v1\(/);
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
  assert.match(post, /if \(!claim\.claimed \|\| !claim\.allowed \|\| !claim\.claimToken\) \{[\s\S]*return await operationStateResponse\(claim/);
  assert.match(post, /error instanceof ApolloEnrichmentError[\s\S]*completeEnrichmentQuotaOperation\(/);
  assert.match(post, /releaseEnrichmentQuotaOperation\(/);
});

test('an unconsumed quota denial can retry with the same operation after reset or a limit change', () => {
  const claim = operationFunctionBody('claim_antonia_quota_operation_v1');
  assert.match(claim, /v_operation\.status = 'failed'[\s\S]*not v_operation\.quota_allowed[\s\S]*v_operation\.response_status = 429/);
  assert.match(claim, /set quota_scope = 'user', quota_day = v_day[\s\S]*status = 'claimed'/);
  assert.doesNotMatch(claim, /v_operation\.quota_scope <> p_scope|v_operation\.quota_limit <> p_limit/);
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
    const marker = `create or replace function public.${name}`;
    const sql = sharedCreditsSql.includes(marker) ? sharedCreditsSql : operationSql;
    assert.match(body, /auth\.role\(\).*<> 'service_role'/);
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([^)]+\\)\\s+from public, anon, authenticated;`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([^)]+\\)\\s+to service_role;`));
  }
});

test('enrichment requires a client operation identity and does not use content-only daily deduplication', () => {
  assert.match(enrichmentRoute, /request\.headers\.get\('idempotency-key'\)/);
  assert.match(enrichmentRoute, /body\.operationId/);
  assert.match(enrichmentRoute, /IDEMPOTENCY_KEY_REQUIRED/);
  assert.match(source, /IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST/);
  assert.match(enrichmentRoute, /function requestFingerprint[\s\S]*createHash\('sha256'\)\.update\(JSON\.stringify\(\{/);
  const fingerprintStart = enrichmentRoute.indexOf('function requestFingerprint');
  const fingerprintEnd = enrichmentRoute.indexOf('function usage', fingerprintStart);
  const fingerprint = enrichmentRoute.slice(fingerprintStart, fingerprintEnd);
  assert.doesNotMatch(fingerprint, /requestedProvider/);
  assert.match(enrichmentRoute, /providerRequested: providerDecision\.requestedProvider/);
  assert.doesNotMatch(operationSql, /unique \([^)]*request_fingerprint[^)]*\)/);
});

test('enrichment mode cannot be forged or made inconsistent with requested fields', () => {
  const start = enrichmentRoute.indexOf('function resolveMode');
  const end = enrichmentRoute.indexOf('function resolveTableName', start);
  const resolver = enrichmentRoute.slice(start, end);
  assert.match(resolver, /const expected: EnrichmentMode = revealPhone \? 'deep' : 'normal'/);
  assert.match(resolver, /ENRICHMENT_MODE_INTERNAL_ONLY/);
  assert.match(resolver, /ENRICHMENT_MODE_FIELD_MISMATCH/);
  assert.match(enrichmentRoute, /function quotaResource[\s\S]*mode === 'deep' \? 'investigate' : 'enrich'/);
});

test('profile enrichment has stable targets and recoverable idempotent replays', () => {
  assert.match(enrichmentRoute, /function profileTargetId[\s\S]*createHash\('sha256'\)/);
  assert.match(enrichmentRoute, /from\('people_search_leads'\)[\s\S]*\.eq\('user_id', input\.userId\)[\s\S]*\.eq\('organization_id', input\.organizationId\)/);
  assert.match(enrichmentRoute, /async function operationTargets/);
  assert.match(enrichmentRoute, /target_table', input\.tableName/);
  assert.match(enrichmentRoute, /enriched\.length > 0 \? \{[\s\S]*(?:enriched: pendingEnriched|queued: true, enriched)/);
  assert.match(enrichmentRoute, /createApolloEnrichmentCallback\(/);
  assert.match(enrichmentRoute, /bindApolloEnrichmentCallback\(/);
  assert.match(enrichmentRoute, /settleApolloEnrichmentCallback\(/);
  assert.match(enrichmentRoute, /async function markTargetsFailed/);
  assert.match(enrichmentRoute, /stableTargetIds/);
  assert.match(enrichmentRoute, /claimToken: claim\.claimToken/);
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
