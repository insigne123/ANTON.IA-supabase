import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { isNativeDraftVersionConflict } from './native-drafts';
import { deriveNativeResearchLeadRef, nativeResearchInternals } from './native-research';

const nativeResearchSource = readFileSync('src/lib/server/native-research.ts', 'utf8');
const nativeDraftSource = readFileSync('src/lib/server/native-drafts.ts', 'utf8');
const securityMigration = readFileSync('supabase/migrations/20260822111000_native_research_security_fixes.sql', 'utf8');
const queueIntegrityMigration = readFileSync('supabase/migrations/20260824170000_native_research_queue_integrity.sql', 'utf8');
const suppressedSettlementMigration = readFileSync('supabase/migrations/20260824173000_settle_suppressed_native_research_jobs.sql', 'utf8');
const suppressedQuotaMigration = readFileSync('supabase/migrations/20260901095000_release_suppressed_native_research_quota.sql', 'utf8');
const legacyCompatibilityMigration = readFileSync('supabase/migrations/20260823120000_reconcile_legacy_schema_drift.sql', 'utf8');
const privacySubjectData = readFileSync('src/lib/server/privacy-subject-data.ts', 'utf8');
const nativeLeadStatusSource = nativeResearchSource.slice(
  nativeResearchSource.indexOf('export async function listNativeResearchLeadStatuses'),
  nativeResearchSource.indexOf('\nasync function persistNativeSnapshot'),
);

test('official-site checks reject mapped, translated, and reserved network addresses', () => {
  for (const address of [
    '127.0.0.1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '64:ff9b::7f00:1',
    'fc00::1',
    'fe80::1',
  ]) {
    assert.equal(nativeResearchInternals.isPrivateIpAddress(address), true, address);
  }

  assert.equal(nativeResearchInternals.isPrivateIpAddress('8.8.8.8'), false);
  assert.equal(nativeResearchInternals.isPrivateIpAddress('2606:4700:4700::1111'), false);
});

test('long public profile URLs use a bounded durable lead reference', () => {
  const leadRef = deriveNativeResearchLeadRef({
    id: null,
    email: null,
    fullName: null,
    companyDomain: null,
    companyName: null,
    linkedinUrl: `https://www.linkedin.com/in/${'profile-'.repeat(400)}`,
  });

  assert.match(leadRef, /^native:/);
  assert.ok(leadRef.length <= 500);
});

test('official-site requests use an approved DNS answer instead of resolving during fetch', () => {
  assert.match(nativeResearchSource, /lookup: pinnedOfficialSiteLookup\(address\)/);
  assert.doesNotMatch(nativeResearchSource, /await fetch\(/);
  assert.equal(nativeResearchInternals.isSafeOfficialSiteUrl(new URL('https://example.com')), true);
  assert.equal(nativeResearchInternals.isSafeOfficialSiteUrl(new URL('http://example.com:8080')), false);
  assert.equal(nativeResearchInternals.isSafeOfficialSiteUrl(new URL('https://user@example.com')), false);

  const lookup = nativeResearchInternals.pinnedOfficialSiteLookup({ address: '8.8.8.8', family: 4 });
  let single: unknown[] = [];
  lookup('example.com', {}, (...args) => { single = args; });
  assert.deepEqual(single, [null, '8.8.8.8', 4]);

  let all: unknown[] = [];
  lookup('example.com', { all: true }, (...args) => { all = args; });
  assert.deepEqual(all, [null, [{ address: '8.8.8.8', family: 4 }]]);
});

test('deep official-site collection stays on the company domain and search signals need company context', () => {
  const candidates = nativeResearchInternals.candidateOfficialPageUrls(
    [
      '<a href="/company">Quiénes somos</a>',
      '<a href="/services">Servicios</a>',
      '<a href="https://unrelated.example/jobs">Vacantes</a>',
    ].join(''),
    new URL('https://acme.com/'),
    'acme.com',
    'Chile',
    5,
  );
  assert.deepEqual(candidates, ['https://acme.com/chile/', 'https://acme.com/company', 'https://acme.com/services']);
  assert.equal(nativeResearchInternals.isRelevantSearchResult({
    title: 'Acme anuncia una nueva alianza',
    snippet: 'La empresa Acme compartió la noticia esta semana.',
    link: 'https://news.example/acme-alliance',
    companyName: 'Acme',
    companyDomain: 'acme.com',
  }), true);
  assert.equal(nativeResearchInternals.isRelevantSearchResult({
    title: 'Actualización semanal del sector',
    snippet: 'Las empresas revisan sus planes para este año.',
    link: 'https://news.example/weekly',
    companyName: 'Acme',
    companyDomain: 'acme.com',
  }), false);
});

test('deep official-site candidates cover high-value company sections up to twelve pages', () => {
  const paths = [
    'products', 'services', 'cases', 'customers', 'integrations', 'team',
    'locations', 'security', 'news', 'careers', 'about',
  ];
  const candidates = nativeResearchInternals.candidateOfficialPageUrls(
    paths.map((path) => `<a href="/${path}">${path}</a>`).join(''),
    new URL('https://acme.com/'),
    'acme.com',
    null,
    12,
  );

  assert.equal(candidates.length, 11);
  for (const path of paths) assert.ok(candidates.includes(`https://acme.com/${path}`), path);
});

test('official-site collection keeps bounded HTML and falls back to useful page text', () => {
  const first = nativeResearchInternals.boundedOfficialSiteChunk(Buffer.from('abcdefghij'), 180_000 - 4);
  assert.equal(first?.toString('utf8'), 'abcd');
  assert.equal(nativeResearchInternals.boundedOfficialSiteChunk(Buffer.from('more'), 180_000), null);

  const page = nativeResearchInternals.officialPageFromHtml(
    new URL('https://acme.com/about'),
    [
      '<html><head><title>Acme</title><meta name="description" content="Acme"></head><body>',
      'Acme ayuda a empresas de todo el país con soluciones verificables de logística, operaciones y soporte especializado.',
      '</body></html>',
    ].join(''),
  );
  const pageContent = nativeResearchInternals.usefulOfficialPageContent(page);
  assert.equal(pageContent?.locator, 'page_text');
  assert.match(pageContent?.statement || '', /Acme ayuda a empresas/);

  const officialDescription = nativeResearchInternals.officialPageFromHtml(
    new URL('https://acme.com'),
    '<meta name="description" content="Acme ofrece servicios empresariales especializados con cobertura nacional y atención para distintas industrias.">',
  );
  assert.equal(nativeResearchInternals.usefulOfficialPageContent(officialDescription)?.locator, 'meta_description');

  const truncatedRegionalLanding = nativeResearchInternals.officialPageFromHtml(
    new URL('https://acme.com'),
    [
      '<title>Acme | Selecciona tu país</title>',
      '<meta name="description" content="Bienvenido a Acme. Selecciona tu país para acceder a la información disponible en tu región.">',
      '<script>const translations = { messages: "'.concat('boilerplate '.repeat(1_000)),
    ].join(''),
  );
  assert.doesNotMatch(truncatedRegionalLanding.text, /boilerplate/);
  assert.equal(nativeResearchInternals.usefulOfficialPageContent(truncatedRegionalLanding), null);
});

test('official-site pages produce atomic deduplicated sections and support legacy flattened artifacts', () => {
  const page = nativeResearchInternals.officialPageFromHtml(
    new URL('https://acme.com/services'),
    [
      '<main><h1>Servicios logísticos</h1>',
      '<p>Acme coordina entregas empresariales con seguimiento operativo para equipos distribuidos en toda la región.</p>',
      '<p>Acme coordina entregas empresariales con seguimiento operativo para equipos distribuidos en toda la región.</p>',
      '<h2>Integraciones</h2>',
      '<p>La plataforma se integra con sistemas de inventario y planificación para mantener actualizados los flujos de trabajo.</p>',
      '</main>',
    ].join(''),
  );
  const contents = nativeResearchInternals.usefulOfficialPageContents(page);
  assert.equal(contents.length, 2);
  assert.match(contents[0].locator, /^Servicios logísticos#/);
  assert.match(contents[1].locator, /^Integraciones#/);

  const legacyContents = nativeResearchInternals.usefulOfficialPageContents({
    url: 'https://acme.com/about',
    title: 'Acme',
    description: 'Acme desarrolla software operativo para empresas que coordinan inventario, transporte y atención regional.',
    text: [
      'Acme desarrolla software operativo para empresas que coordinan inventario, transporte y atención regional.',
      'Sus equipos trabajan con clientes de distintos sectores para adaptar cada implementación a procesos verificables.',
    ].join(' '),
  });
  assert.equal(legacyContents.length, 2);
  assert.equal(legacyContents[0].locator, 'meta_description');
});

test('native generation and deletion use durable privacy-aware claims', () => {
  assert.match(securityMigration, /create table if not exists public\.native_draft_generation_claims/);
  assert.match(securityMigration, /create or replace function public\.claim_native_lead_research_request_v1/);
  assert.match(securityMigration, /create or replace function public\.claim_native_draft_generation_v1/);
  assert.match(securityMigration, /create or replace function public\.delete_native_research_messaging_subject_v1/);
  assert.match(securityMigration, /'outcome', 'pending'/);
  assert.match(legacyCompatibilityMigration, /alter column version_id drop not null/);
  assert.match(legacyCompatibilityMigration, /alter column identity_hash drop not null/);
  assert.match(nativeResearchSource, /cancel_native_lead_research_request_claim_v1/);
  assert.match(nativeDraftSource, /claim_native_draft_generation_v1/);
  assert.match(privacySubjectData, /delete_native_research_messaging_subject_v1/);
});

test('native queue preserves terminal limited research and settles run progress atomically', () => {
  assert.match(queueIntegrityMigration, /v_provider_status not in \('completed', 'partial', 'insufficient_data'\)/);
  assert.match(queueIntegrityMigration, /create or replace function public\.settle_native_research_run_items_v1/);
  assert.match(queueIntegrityMigration, /for update/);
  assert.match(queueIntegrityMigration, /create unique index if not exists research_runs_active_request_uidx/);
  assert.match(queueIntegrityMigration, /abort_native_lead_research_request_claim_v1/);
  assert.match(nativeResearchSource, /\.lte\('scheduled_for', dueAt\)/);
  assert.match(nativeResearchSource, /\.eq\('request_claim_state', 'provider_submitting'\)/);
  assert.match(nativeResearchSource, /stalePreProviderQuery/);
  assert.match(nativeResearchSource, /\.lt\('request_claimed_at', staleAt\)/);
  assert.match(nativeResearchSource, /settle_native_research_run_items_v1/);
});

test('suppressed claims without a token settle the durable job and its run item', () => {
  assert.match(suppressedSettlementMigration, /create or replace function public\.settle_suppressed_native_lead_research_job_v1/);
  assert.match(suppressedSettlementMigration, /pg_advisory_xact_lock/);
  assert.match(suppressedSettlementMigration, /request_claim_state in \('pre_provider', 'retryable', 'provider_submitting', 'terminal_pending'\)/);
  assert.match(suppressedSettlementMigration, /grant execute on function public\.settle_suppressed_native_lead_research_job_v1/);
  assert.match(nativeResearchSource, /settle_suppressed_native_lead_research_job_v1/);
  assert.match(nativeResearchSource, /if \(!claim\) \{[\s\S]+settleSuppressedNativeResearchJob\(\{ job, access \}\)/);
});

test('suppression after quota consumption reverses only pre-provider usage atomically', () => {
  assert.match(suppressedQuotaMigration, /create or replace function public\.cancel_native_lead_research_request_claim_v1/);
  assert.match(suppressedQuotaMigration, /for update/);
  assert.match(suppressedQuotaMigration, /pg_advisory_xact_lock/);
  assert.match(suppressedQuotaMigration, /v_job\.request_claim_state = 'pre_provider' and v_job\.quota_consumed_at is not null/);
  assert.match(suppressedQuotaMigration, /usage_count = usage_count - 1[\s\S]+usage_count > 0/);
  assert.match(suppressedQuotaMigration, /leads_investigated = leads_investigated - 1[\s\S]+leads_investigated > 0/);
  assert.match(suppressedQuotaMigration, /quota bucket is missing for suppressed research release/);
  assert.match(suppressedQuotaMigration, /quota_consumed_at = case when v_job\.request_claim_state = 'pre_provider' then null/);
});

test('native lead status lookup stays tenant-scoped and matches only exact lead IDs', () => {
  assert.match(nativeLeadStatusSource, /applyReadableOrganizationScope\(query, input\.access\)/);
  assert.match(nativeResearchSource, /function applyReadableOrganizationScope[\s\S]+query\.eq\('organization_id', organizationIds\[0\]\)[\s\S]+query\.in\('organization_id', organizationIds\)/);
  assert.match(nativeLeadStatusSource, /\.eq\('user_id', input\.access\.userId\)/);
  assert.match(nativeLeadStatusSource, /\.in\('lead_id', leadIds\)/);
  assert.doesNotMatch(nativeLeadStatusSource, /company_(?:name|domain)|\.eq\('email'/);
});

test('draft version conflicts are distinguished from server failures', () => {
  assert.equal(isNativeDraftVersionConflict({ code: '40001' }), true);
  assert.equal(isNativeDraftVersionConflict({ code: '40400' }), true);
  assert.equal(isNativeDraftVersionConflict({ message: 'stale messaging draft parent revision' }), true);
  assert.equal(isNativeDraftVersionConflict({ code: '23505' }), false);
});
