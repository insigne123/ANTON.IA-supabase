import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseWebEvidenceV2 } from '@/lib/report-v2-extraction';
import {
  REPORT_V2_TARGET_FIELDS,
  consolidateReportV2Claims,
  extractClaimsFromSourcesV2,
} from './extract-report-v2-claims';

const fixtureRoot = 'test/fixtures/grupoexpro';
const golden = JSON.parse(readFileSync('test/fixtures/grupoexpro.golden.json', 'utf8'));
const provider = JSON.parse(readFileSync(`${fixtureRoot}/provider-context.json`, 'utf8'));
const serper = JSON.parse(readFileSync(`${fixtureRoot}/serper-results.json`, 'utf8'));

function sources() {
  return serper.results.map((result: any) => parseWebEvidenceV2({
    html: readFileSync(`${fixtureRoot}/${result.fixture}`, 'utf8'),
    url: result.link,
    targetDomain: golden.domain,
    retrievedAt: golden.capturedAt,
  }));
}

const emptyModelOutput = async () => ({ claims: [], notFoundFields: [...REPORT_V2_TARGET_FIELDS] });

test('P3 extracts explicit scale, geography, legal form, executive and dated signals from frozen sources', async () => {
  const extracted = await extractClaimsFromSourcesV2({
    companyName: golden.contact.company,
    companyDomain: golden.domain,
    sources: sources(),
    providerContext: provider.contact,
    capturedAt: golden.capturedAt,
  }, { generate: emptyModelOutput as any });
  const consolidated = consolidateReportV2Claims({ drafts: extracted.claimDrafts, facts: extracted.facts });
  const statements = consolidated.claims.map((claim) => claim.statement).join(' ');
  const signalClaims = consolidated.claims.filter((claim) => claim.dimension === 'signal');

  for (const number of golden.expected.requiredNumbers) {
    assert.match(statements, new RegExp(`\\b${number}\\b`), `Missing ${number} in claims`);
  }
  assert.match(statements, /Chile, Peru y Colombia/);
  assert.match(statements, /Almirante Pastene 244/);
  assert.match(statements, /Gonzalo Meneses Zorrilla es Director Corporativo de Negocios/);
  assert.match(statements, /Ley 20[.]123/);
  assert.ok(signalClaims.length >= golden.expected.minimumSignals);
  assert.ok(signalClaims.every((claim) => claim.observedAt));
  assert.ok(consolidated.claims.every((claim) => !/[<>]|elementor|wp-content|hummingbird/i.test(claim.statement)));
  assert.ok(extracted.results.every((result) => result.notFoundFields.length > 0));
  assert.ok(extracted.sources.filter((source) => source.ownDomain).length / extracted.sources.length < golden.expected.maximumOwnDomainSourceRatio);
});

test('one failed source does not cancel successful source extraction', async () => {
  let calls = 0;
  const extracted = await extractClaimsFromSourcesV2({
    companyName: golden.contact.company,
    companyDomain: golden.domain,
    sources: sources().slice(0, 2),
    providerContext: provider.contact,
    capturedAt: golden.capturedAt,
  }, {
    generate: (async () => {
      calls += 1;
      if (calls === 1) throw new Error('source failure');
      return { claims: [], notFoundFields: [...REPORT_V2_TARGET_FIELDS] };
    }) as any,
  });
  assert.equal(extracted.results.length, 2);
  assert.equal(extracted.failedSourceIds.length, 1);
  assert.ok(extracted.claimDrafts.some((claim) => claim.targetField === 'headcount_managed'));
});

test('P4 merges duplicate support and reports conflicting numeric values', () => {
  const factA = {
    id: 'f_aaaaaaaaaa', sourceId: 'src_aaaaaaaaaa', text: 'Acme has 100 workers.',
    observedAt: '2026-01-01T00:00:00.000Z', jurisdiction: 'PE' as const, locator: null,
  };
  const factB = {
    id: 'f_bbbbbbbbbb', sourceId: 'src_bbbbbbbbbb', text: 'Acme has 200 workers.',
    observedAt: '2026-02-01T00:00:00.000Z', jurisdiction: 'PE' as const, locator: null,
  };
  const common = {
    type: 'fact' as const,
    dimension: 'company_size' as const,
    targetField: 'headcount_managed' as const,
    freshnessDays: 1,
    jurisdiction: 'PE' as const,
    confidence: 0.8,
  };
  const result = consolidateReportV2Claims({
    facts: [factA, factB],
    drafts: [
      { ...common, internalId: 'internal-a', statement: 'Acme has 100 workers.', evidenceIds: [factA.id], observedAt: factA.observedAt },
      { ...common, internalId: 'internal-b', statement: 'Acme has 200 workers.', evidenceIds: [factB.id], observedAt: factB.observedAt },
    ],
  });
  assert.equal(result.claims.length, 2);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.claims.map((claim) => claim.id), ['c01', 'c02']);
});
