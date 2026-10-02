import assert from 'node:assert/strict';
import test from 'node:test';
import { groupHiring, type JobAd } from './hiring';
import { hiringOpportunityRow, hiringSignalRow, jobAdFromSignal } from './records';

const NOW = '2026-10-02T12:00:00Z';
const ORG = '00000000-0000-4000-8000-000000000002';
const ad = (externalId: string, title: string, extra: Partial<JobAd> = {}): JobAd => ({
  source: 'linkedin', externalId, title, company: 'Minera Norte S.A.', companyDomain: 'mineranorte.cl', companyLinkedinUrl: 'https://www.linkedin.com/company/minera-norte',
  companySize: '201-500', companyIndustry: 'Minería', location: 'Calama, Antofagasta, Chile', region: 'Antofagasta', publisher: 'LinkedIn',
  url: `https://www.linkedin.com/jobs/view/${externalId}`, postedAt: '2026-09-29T12:00:00Z', ...extra });

const grouped = groupHiring([ad('1', 'Operario de planta'), ad('2', 'Conductor'), ad('3', 'Operaria de packing', { url: 'javascript:alert(1)' })],
  { roles: ['operario', 'conductor'], regions: ['Antofagasta'], minAds: 1, clients: [], contactsCompanies: [] }, { now: NOW });
const item = grouped.opportunities[0];

test('a company becomes one row without status or owner, so a new search keeps where the person left it', () => {
  const row = hiringOpportunityRow(item, { organizationId: ORG, profileId: null }, NOW);
  assert.equal(row.kind, 'hiring');
  assert.equal(row.dedupe_key, 'domain:mineranorte.cl');
  assert.equal(row.company_name, 'Minera Norte S.A.');
  assert.equal(row.url, 'https://mineranorte.cl');
  assert.equal(row.region, 'Antofagasta');
  assert.equal(row.signal_count, 3);
  assert.ok(row.score > 0 && row.score <= 100);
  for (const key of ['status', 'claimed_by', 'first_seen_at', 'created_at']) assert.equal(key in row, false, key);
  assert.equal(row.data.evidence.length, 3);
  assert.equal(row.data.evidence.find(entry => entry.title === 'Operaria de packing')?.url, null, 'only http(s) links are kept');
  assert.ok(JSON.stringify(row.data).length < 16_000);
});

test('an ad becomes evidence with the company fields only, and comes back as the same ad', () => {
  const signal = hiringSignalRow(item.signals[0], { organizationId: ORG, opportunityId: 'o1' }, NOW);
  assert.deepEqual(Object.keys(signal.data).sort(), ['company', 'companyDomain', 'companyIndustry', 'companyLinkedinUrl', 'companySize', 'region']);
  assert.equal(signal.seen_at, NOW);
  const back = jobAdFromSignal({ ...signal, data: signal.data });
  assert.equal(back?.company, 'Minera Norte S.A.');
  assert.equal(back?.companyDomain, 'mineranorte.cl');
  assert.equal(back?.postedAt, new Date(item.signals[0].postedAt!).toISOString());
  assert.equal(jobAdFromSignal({ ...signal, posted_at: null, data: signal.data })?.postedAt, NOW, 'an ad without a date counts from when it was seen');
  assert.equal(jobAdFromSignal({ ...signal, source: 'mercado_publico', data: signal.data }), null);
});

test('long texts are cut to the limits of the tables', () => {
  const long = groupHiring([1, 2].map(index => ad(String(index), `Operario ${'x'.repeat(600)}`, { company: 'Y'.repeat(400), companyDomain: null, location: 'L'.repeat(300) })),
    { roles: ['operario'], regions: [], minAds: 1, clients: [], contactsCompanies: [] }, { now: NOW }).opportunities[0];
  const row = hiringOpportunityRow(long, { organizationId: ORG, profileId: null }, NOW);
  assert.equal(row.title.length, 400);
  assert.equal(row.company_name?.length, 300);
  const signal = hiringSignalRow(long.signals[0], { organizationId: ORG, opportunityId: 'o1' }, NOW);
  assert.ok(signal.title.length <= 500);
  assert.equal(signal.location?.length, 200);
});
