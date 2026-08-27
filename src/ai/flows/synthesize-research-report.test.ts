import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDeterministicResearchReportDocumentV1,
  synthesizeResearchReportDocumentV1,
} from './synthesize-research-report';
import { validateResearchReportDocumentCitationsV1 } from '@/lib/research-report-contracts';
import { draftSnapshotFixture } from '@/lib/server/draft-v2-test-fixtures';

test('defaults native research report synthesis to Terra', async () => {
  const names = [
    'NATIVE_RESEARCH_REPORT_MODEL',
    'SUPLIA_OPENAI_REASONING_MODEL',
    'OPENAI_REASONING_MODEL',
  ] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  names.forEach((name) => delete process.env[name]);
  let selectedModel = '';

  try {
    await synthesizeResearchReportDocumentV1({ snapshot: draftSnapshotFixture() }, {
      generate: async (input) => {
        selectedModel = input.openAiModel;
        throw new Error('stop after model selection');
      },
    });
    assert.equal(selectedModel, 'gpt-5.6-terra');
  } finally {
    previous.forEach((value, name) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  }
});

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
    executiveSummary: { facts: [structuredClone(projection.executiveSummary.facts[0])] },
    person: { verifiedFacts: [] },
    company: { overview: [], offerings: [], market: [], scale: [] },
    signals: [],
    commercialHypotheses: [],
    outreachBrief: { factualAnchors: [], hypotheses: [], doNotClaim: [] },
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
  assert.match(prompt, /Every signal must keep classification exactly "fact"/);
  assert.match(prompt, /"classification":"fact","subjectScope":"company\|person"/);
});

test('model synthesis drops an invalid extra block while preserving canonically covered sections', async () => {
  const snapshot = draftSnapshotFixture();
  const generatedAt = '2026-08-24T18:30:00.000Z';
  const projection = buildDeterministicResearchReportDocumentV1({ snapshot, generatedAt });
  const modelBody = {
    executiveSummary: structuredClone(projection.executiveSummary),
    person: { verifiedFacts: structuredClone(projection.person.verifiedFacts) },
    company: structuredClone(projection.company),
    signals: structuredClone(projection.signals),
    commercialHypotheses: structuredClone(projection.commercialHypotheses),
    narrative: {
      executiveSummary: [{ text: 'Acme ayuda a equipos de operaciones a reducir trabajo manual.', claimIds: ['claim-acme-overview'] }],
      companyProfile: [{ text: 'Su propuesta se centra en reducir trabajo manual en operaciones.', claimIds: ['claim-acme-overview'] }],
      leadContext: [],
      commercialReading: [],
    },
    outreachBrief: structuredClone(projection.outreachBrief),
  };
  modelBody.executiveSummary.facts.push({
    ...structuredClone(modelBody.executiveSummary.facts[0]),
    id: 'model-invalid-extra',
    citations: { claimIds: ['unknown-model-claim'], evidenceIds: ['evidence-acme'] },
  });
  modelBody.company.overview = [];
  modelBody.outreachBrief.factualAnchors = [];

  const result = await synthesizeResearchReportDocumentV1({ snapshot, generatedAt }, {
    generate: async () => ({ data: modelBody, telemetry: { modelName: 'test-model' } }),
  });

  assert.equal(result.metadata.generationMethod, 'model');
  assert.equal(result.metadata.retryable, false);
  assert.equal(result.document.executiveSummary.facts.some((block) => block.id === 'model-invalid-extra'), false);
  assert.equal(result.document.narrative?.executiveSummary[0].text, 'Acme ayuda a equipos de operaciones a reducir trabajo manual.');
  assert.deepEqual(result.document.narrative?.executiveSummary[0].evidenceIds, ['evidence-acme']);
  assert.ok(result.document.company.overview.length > 0);
  assert.ok(result.document.outreachBrief.factualAnchors.length > 0);
  assert.doesNotThrow(() => validateResearchReportDocumentCitationsV1(result.document, snapshot));
});
