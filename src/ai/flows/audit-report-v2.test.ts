import assert from 'node:assert/strict';
import test from 'node:test';

import type { ClaimV2, SectionV2, SourceV2 } from '@/lib/report-v2-contracts';
import { auditReportV2, deterministicAuditReportV2, rewriteBlockingReportV2SectionsOnce } from './audit-report-v2';

const facts: ClaimV2[] = [{
  id: 'c01', internalId: null, type: 'fact', dimension: 'company_size', statement: 'Acme has 300 workers.',
  evidenceIds: ['f_aaaaaaaaaa'], observedAt: '2026-01-01T00:00:00.000Z', freshnessDays: 1, jurisdiction: 'PE', confidence: 0.9,
}, {
  id: 'c02', internalId: null, type: 'hypothesis', dimension: 'risk', statement: 'Manual work may be high.', evidenceIds: [],
  observedAt: null, freshnessDays: null, jurisdiction: 'PE', confidence: 0.5, validationQuestion: 'How much work is manual?',
}, {
  id: 'c03', internalId: null, type: 'fact', dimension: 'regulatory', statement: 'Chile applies a local regulation.',
  evidenceIds: ['f_bbbbbbbbbb'], observedAt: '2026-01-01T00:00:00.000Z', freshnessDays: 1, jurisdiction: 'CL', confidence: 0.9,
}];
const sources: SourceV2[] = [{
  id: 'src_aaaaaaaaaa', url: 'https://news.example/acme', canonicalUrl: 'https://news.example/acme',
  title: 'Acme announces a major operational expansion', sourceType: 'press', jurisdiction: 'PE',
  publishedAt: '2026-01-01T00:00:00.000Z', modifiedAt: null, retrievedAt: '2026-01-02T00:00:00.000Z', ownDomain: false,
  contentHash: 'a'.repeat(64),
}];

test('deterministic auditor detects every known v1 defect class that can block publication', () => {
  const sections: SectionV2[] = [{
    key: 'fit', title: 'Fit', blocks: [], paragraphs: [
      { text: 'Seller can help this account Seller can help this account with <section class="elementor-section"> wp-content/uploads/file.js', claimIds: [], context: 'target' },
      { text: 'Acme announces a major operational expansion.', claimIds: ['c01'], context: 'target' },
      { text: 'The account has a confirmed manual-work problem.', claimIds: ['c02'], context: 'target' },
      { text: 'Chile rules apply to this Peru operation.', claimIds: ['c03'], context: 'target' },
      { text: 'This sentence ends in a word centralizad', claimIds: ['c01'], context: 'target' },
    ],
  }];
  const issueTypes = new Set(deterministicAuditReportV2({ sections, claims: facts, sources, contactCountry: 'PE' }).map((issue) => issue.type));
  ['duplication', 'truncated', 'technical_noise', 'literal_copy', 'invalid_citation', 'jurisdiction', 'hard_hypothesis']
    .forEach((type) => assert.ok(issueTypes.has(type as any), `Missing ${type}`));
});

test('P7 excludes the accepted writer model and combines deterministic and model findings', async () => {
  let options: any = null;
  const result = await auditReportV2({
    sections: [{ key: 'company', title: 'Company', paragraphs: [{ text: 'Acme has 300 workers.', claimIds: ['c01'], context: 'target' }], blocks: [] }],
    claims: facts,
    sources,
    contactCountry: 'PE',
    writerModels: ['gpt-5.6-luna'],
  }, {
    generate: (async (input: any) => {
      options = input;
      return { data: { issues: [] }, telemetry: { modelName: 'gpt-5.6-sol', durationMs: 1 } };
    }) as any,
  });
  assert.ok(!options.openAiModels.includes('gpt-5.6-luna'));
  assert.equal(result.model, 'gpt-5.6-sol');
  assert.deepEqual(result.blockingSections, []);
});

test('does not block a discovery question that intentionally echoes its context', () => {
  const issues = deterministicAuditReportV2({
    sections: [{
      key: 'discovery', title: 'Discovery', blocks: [], paragraphs: [{
        text: 'La empresa enfrenta procesos de reclutamiento y seleccion. ¿Cuales son sus procesos de reclutamiento y seleccion actuales?',
        claimIds: ['c01'], context: 'target',
      }],
    }],
    claims: facts,
    sources,
    contactCountry: 'PE',
  });
  assert.equal(issues.some((issue) => issue.type === 'duplication'), false);
});

test('does not block a short phrase reused across separate sentences', () => {
  const issues = deterministicAuditReportV2({
    sections: [{
      key: 'signals', title: 'Signals', blocks: [], paragraphs: [{
        text: 'La cuenta muestra interes en la gestion del talento. Conviene revisar como aborda la gestion del talento en sus operaciones.',
        claimIds: ['c01'], context: 'target',
      }],
    }],
    claims: facts,
    sources,
    contactCountry: 'PE',
  });
  assert.equal(issues.some((issue) => issue.type === 'duplication'), false);
});

test('ignores an ungrounded model duplication finding', async () => {
  const result = await auditReportV2({
    sections: [{ key: 'company', title: 'Company', paragraphs: [{ text: 'Acme has 300 workers.', claimIds: ['c01'], context: 'target' }], blocks: [] }],
    claims: facts,
    sources,
    contactCountry: 'PE',
    writerModels: ['gpt-5.6-luna'],
  }, {
    generate: (async () => ({
      data: { issues: [{ section: 'company', paragraphIndex: 0, type: 'duplication', fragment: 'Acme has 300 workers', severity: 'block' }] },
      telemetry: { modelName: 'gpt-5.6-sol', durationMs: 1 },
    })) as any,
  });
  assert.equal(result.issues.some((issue) => issue.type === 'duplication'), false);
  assert.deepEqual(result.blockingSections, []);
});

test('rewrites each blocking section once and leaves accepted sections untouched', async () => {
  const sections: SectionV2[] = [
    { key: 'company', title: 'Company', paragraphs: [], blocks: [] },
    { key: 'fit', title: 'Fit', paragraphs: [], blocks: [] },
  ];
  let calls = 0;
  const result = await rewriteBlockingReportV2SectionsOnce({
    sections,
    blockingSections: ['fit', 'fit'],
    rewrite: async (section) => { calls += 1; return { ...section, title: 'Rewritten' }; },
  });
  assert.equal(calls, 1);
  assert.equal(result.sections[0].title, 'Company');
  assert.equal(result.sections[1].title, 'Rewritten');
});
