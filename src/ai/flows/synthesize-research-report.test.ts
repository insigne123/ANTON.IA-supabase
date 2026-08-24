import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDeterministicResearchReportDocumentV1,
  synthesizeResearchReportDocumentV1,
} from './synthesize-research-report';
import { validateResearchReportDocumentCitationsV1 } from '@/lib/research-report-contracts';
import { draftSnapshotFixture } from '@/lib/server/draft-v2-test-fixtures';

test('OpenAI failure returns the deterministic cited fallback without invented person facts', async () => {
  const snapshot = draftSnapshotFixture({ includeRole: false });
  const generatedAt = '2026-08-24T18:10:00.000Z';
  const expected = buildDeterministicResearchReportDocumentV1({ snapshot, generatedAt });
  const result = await synthesizeResearchReportDocumentV1({ snapshot, generatedAt }, {
    generate: async () => { throw new Error('provider unavailable'); },
  });

  assert.deepEqual(result.document, expected);
  assert.equal(result.document.synthesis.method, 'fallback');
  assert.equal(result.document.synthesis.status, 'partial');
  assert.equal(result.metadata.retryable, true);
  assert.equal(result.metadata.errorCode, 'report_synthesis_failed');
  assert.equal(result.document.person.importedContext.provenance, 'imported');
  assert.deepEqual(result.document.person.verifiedFacts, []);
  assert.doesNotThrow(() => validateResearchReportDocumentCitationsV1(result.document, snapshot));
});

test('model output with unknown citations is rejected and replaced by the cited fallback', async () => {
  const snapshot = draftSnapshotFixture();
  const generatedAt = '2026-08-24T18:20:00.000Z';
  const projection = buildDeterministicResearchReportDocumentV1({ snapshot, generatedAt });
  const modelBody = {
    executiveSummary: structuredClone(projection.executiveSummary),
    person: { verifiedFacts: structuredClone(projection.person.verifiedFacts) },
    company: structuredClone(projection.company),
    signals: structuredClone(projection.signals),
    commercialHypotheses: structuredClone(projection.commercialHypotheses),
    outreachBrief: structuredClone(projection.outreachBrief),
  };
  modelBody.executiveSummary.facts[0].citations.claimIds = ['unknown-model-claim'];
  let prompt = '';

  const result = await synthesizeResearchReportDocumentV1({ snapshot, generatedAt }, {
    generate: async (input) => {
      prompt = input.prompt;
      return { data: modelBody, telemetry: { modelName: 'test-model' } };
    },
  });
  assert.equal(result.metadata.generationMethod, 'fallback');
  assert.equal(result.metadata.retryable, true);
  assert.deepEqual(result.document, projection);
  assert.match(prompt, /Copy every fact and hypothesis statement verbatim/);
});
