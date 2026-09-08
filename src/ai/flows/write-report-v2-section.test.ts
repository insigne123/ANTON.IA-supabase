import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWriteReportV2SectionPrompt,
  repairSectionParagraphsV2,
  stripInternalIdsForReportPrompt,
  writeReportV2Section,
} from './write-report-v2-section';

test('repairs citations per paragraph instead of rejecting the whole section', () => {
  const repaired = repairSectionParagraphsV2({
    value: {
      paragraphs: [
        { text: 'First supported point.', claimIds: ['c01'] },
        { text: 'Unsupported point.', claimIds: ['c99'] },
        { text: 'Second supported point.', claimIds: ['c02', 'c47'] },
      ],
    },
    validClaimIds: ['c01', 'c02'],
    characterLimit: 100,
  });
  assert.deepEqual(repaired.paragraphs.map((paragraph: { claimIds: string[] }) => paragraph.claimIds), [['c01'], ['c02']]);
  assert.deepEqual(repaired.invalidClaimIds.sort(), ['c47', 'c99']);
});

test('retries an empty section exactly once with specific invalid-ID feedback', async () => {
  const prompts: string[] = [];
  const outputs = [
    { paragraphs: [{ text: 'Invalid.', claimIds: ['c99'], context: 'target' }] },
    { paragraphs: [{ text: 'Supported.', claimIds: ['c01'], context: 'target' }] },
  ];
  const result = await writeReportV2Section({
    section: 'company',
    title: 'Company',
    sectionInstruction: 'Explain the business model.',
    language: 'es',
    analysisSection: {},
    claimsIndex: [{ id: 'c01' }],
    validClaimIds: ['c01'],
  }, {
    generate: async (options: any) => {
      prompts.push(options.prompt);
      return { data: outputs[prompts.length - 1], telemetry: { modelName: 'test-model', durationMs: 1 } };
    },
  });
  assert.equal(result.attempts, 2);
  assert.equal(result.section?.paragraphs.length, 1);
  assert.equal(result.telemetry.length, 2);
  assert.match(prompts[1], /Los siguientes IDs no existen: \["c99"\]/);
  assert.equal(prompts.length, 2);
});

test('omits a section after the bounded repair cascade and never creates template prose', async () => {
  let calls = 0;
  const result = await writeReportV2Section({
    section: 'risks',
    title: 'Risks',
    sectionInstruction: 'Explain cited risks.',
    language: 'es',
    analysisSection: {},
    claimsIndex: [{ id: 'c01' }],
    validClaimIds: ['c01'],
  }, {
    generate: async () => {
      calls += 1;
      return { data: { paragraphs: [] }, telemetry: { modelName: 'test-model', durationMs: 1 } };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.section, null);
});

test('never exposes UUID claim identifiers in a report prompt', () => {
  const uuid = '123e4567-e89b-42d3-a456-426614174000';
  assert.deepEqual(stripInternalIdsForReportPrompt({ id: 'c01', internalId: uuid, nested: uuid }), {
    id: 'c01',
    nested: '[internal-id-removed]',
  });
  const prompt = buildWriteReportV2SectionPrompt({
    section: 'fit',
    sectionInstruction: 'Evaluate fit.',
    language: 'es',
    analysisSection: { internalId: uuid },
    claimsIndex: [{ id: 'c01', internalId: uuid }],
    sectionLimit: 3,
    characterLimit: 500,
  });
  assert.ok(!prompt.includes(uuid));
});
