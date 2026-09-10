import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseWebEvidenceV2, resolveEntityFromExistingContextV2 } from '@/lib/report-v2-extraction';
import { qualifyEntityV2 } from '@/qualification/icp-gate';
import { buildReportV2Committee } from './build-report-v2-committee';
import { consolidateReportV2Claims, extractClaimsFromSourcesV2, REPORT_V2_TARGET_FIELDS } from './extract-report-v2-claims';

const fixtureRoot = 'test/fixtures/grupoexpro';
const golden = JSON.parse(readFileSync('test/fixtures/grupoexpro.golden.json', 'utf8'));
const provider = JSON.parse(readFileSync(`${fixtureRoot}/provider-context.json`, 'utf8'));
const serper = JSON.parse(readFileSync(`${fixtureRoot}/serper-results.json`, 'utf8'));

async function fixtureContext() {
  const sources = serper.results.map((result: any) => parseWebEvidenceV2({
    html: readFileSync(`${fixtureRoot}/${result.fixture}`, 'utf8'),
    url: result.link,
    targetDomain: golden.domain,
    retrievedAt: golden.capturedAt,
  }));
  const entity = resolveEntityFromExistingContextV2({ contact: provider.contact, domain: golden.domain, sources });
  const qualification = qualifyEntityV2({ entity, rules: golden.sellerProfile.icpRules, headcount: 12_000 });
  const extracted = await extractClaimsFromSourcesV2({
    companyName: entity.companyName,
    companyDomain: entity.companyDomain,
    sources,
    providerContext: provider.contact,
    capturedAt: golden.capturedAt,
  }, { generate: (async (options: any) => {
    const encoded = JSON.parse(options.prompt.match(/Evidencia: (.*)/)[1]);
    const evidence = Array.isArray(encoded) ? encoded : encoded.rows.map((row: unknown[]) => Object.fromEntries(encoded.columns.map((key: string, index: number) => [key, row[index]])));
    const fact = evidence.find((item: any) => item.text.includes('Gonzalo Meneses Zorrilla'));
    return { claims: fact ? [{
      targetField: 'executives', dimension: 'buying_committee', scope: 'person',
      statement: 'Gonzalo Meneses Zorrilla es Director Corporativo de Negocios de GrupoExpro.',
      evidenceIds: [fact.id], observedAt: null, jurisdiction: 'CL', confidence: 0.85,
    }] : [], notFoundFields: [...REPORT_V2_TARGET_FIELDS] };
  }) as any });
  const { claims } = consolidateReportV2Claims({ drafts: extracted.claimDrafts, facts: extracted.facts });
  return { entity, qualification, claims };
}

test('builds a committee from public names and target roles without calling Apollo', async () => {
  const context = await fixtureContext();
  const committee = buildReportV2Committee({ ...context, persistedApolloPeople: provider.persistedPeople });
  assert.ok(committee.some((member) => member.name === 'Gonzalo Meneses Zorrilla'));
  assert.ok(committee.filter((member) => member.name !== golden.contact.fullName).length >= golden.expected.minimumCommitteeMembersOutsideImportedContact);
  assert.ok(committee.some((member) => member.rank === 'rejected' && member.name === golden.contact.fullName));
  assert.ok(committee.every((member) => member.emailStatus === 'verified' || member.emailStatus === 'not_searched'));
});

test('uses only already-persisted Apollo contacts with verified email status', async () => {
  const context = await fixtureContext();
  const committee = buildReportV2Committee({
    ...context,
    persistedApolloPeople: [
      { fullName: 'Verified Person', title: 'Director Corporativo de Negocios', emailStatus: 'verified' },
      { fullName: 'Unverified Person', title: 'Gerente de Operaciones', emailStatus: 'unverified' },
    ],
  });
  assert.ok(committee.some((member) => member.name === 'Verified Person' && member.emailStatus === 'verified'));
  assert.ok(!committee.some((member) => member.name === 'Unverified Person'));
});
