import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RESEARCH_REPORT_PROMPT_VERSION,
  ReportSynthesisFailed,
  buildDeterministicResearchReportDocumentV1,
  researchReportSynthesisInternals,
  sellerProfileHash,
  synthesizeResearchReportDocumentV1,
} from './synthesize-research-report';
import { validateResearchReportDocumentCitationsV1 } from '@/lib/research-report-contracts';
import { draftSnapshotFixture } from '@/lib/server/draft-v2-test-fixtures';

type AnalystSection = 'executiveSummary' | 'leadContext' | 'companyProfile' | 'commercialReading' | 'serviceFit';

function sectionFromPrompt(prompt: string): AnalystSection {
  const match = prompt.match(/specialized analyst for the research report section "([^"]+)"/);
  assert.ok(match, 'prompt must identify its specialized section');
  return match[1] as AnalystSection;
}

function canonicalInputFromPrompt(prompt: string) {
  const marker = 'Canonical section input:\n';
  const index = prompt.indexOf(marker);
  assert.notEqual(index, -1, 'prompt must include bounded canonical input');
  return JSON.parse(prompt.slice(index + marker.length).trim()) as {
    section: AnalystSection;
    claims: Array<{ id: string; subjectScope: 'company' | 'person'; classification: 'fact' | 'hypothesis' }>;
    evidence: Array<{ id: string }>;
    sellerContext?: { companyName: string };
  };
}

function validOutputFor(section: AnalystSection, includeSellerFit = false) {
  if (section === 'executiveSummary') {
    return {
      paragraphs: [{
        text: 'Antes de contactar a Ada Lovelace, ten en cuenta que su rol operativo está respaldado públicamente y que Acme comunica un foco en reducir trabajo manual. Usa ese contexto para abrir la conversación sin adelantar conclusiones.',
        claimIds: ['claim-acme-overview', 'claim-ada-role'],
      }],
    };
  }
  if (section === 'leadContext') {
    return {
      paragraphs: [{
        text: 'La evidencia pública vincula a Ada Lovelace con la dirección de Operaciones.',
        claimIds: ['claim-ada-role'],
      }],
    };
  }
  if (section === 'companyProfile') {
    return {
      paragraphs: [{
        text: 'La propuesta de Acme pone el foco en reducir trabajo manual dentro de las operaciones.',
        claimIds: ['claim-acme-overview'],
      }],
    };
  }
  if (section === 'commercialReading') {
    return {
      paragraphs: [{
        text: 'Dado ese enfoque operativo, podría ser útil explorar si Acme mantiene una prioridad activa para acelerar sus operaciones.',
        claimIds: ['claim-acme-opportunity'],
      }],
    };
  }
  return includeSellerFit ? {
    paragraphs: [{
      text: 'La automatización responsable declarada por Northstar podría ser pertinente para el contexto operativo que Acme comunica; conviene validar el encaje.',
      claimIds: ['claim-acme-overview'],
    }],
  } : { paragraphs: [] };
}

test('defaults every specialized research analyst to Luna', async () => {
  const names = [
    'NATIVE_RESEARCH_REPORT_MODEL',
    'SUPLIA_OPENAI_REASONING_MODEL',
    'OPENAI_REASONING_MODEL',
  ] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  names.forEach((name) => delete process.env[name]);
  const selectedModels: string[] = [];

  try {
    await assert.rejects(() => synthesizeResearchReportDocumentV1({
        snapshot: draftSnapshotFixture(),
        sellerProfile: { companyName: 'Northstar', services: ['Automatización de operaciones'] },
      }, {
        generate: async (input) => {
          selectedModels.push(input.openAiModel);
          throw new Error('stop after model selection');
        },
      }), ReportSynthesisFailed);
    assert.equal(selectedModels.length, 5);
    assert.deepEqual(new Set(selectedModels), new Set(['gpt-5.6-luna']));
  } finally {
    previous.forEach((value, name) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  }
});

test('runs five bounded specialized analysts in parallel and preserves valid interpreted prose', async () => {
  const snapshot = draftSnapshotFixture();
  const generatedAt = '2026-08-24T18:10:00.000Z';
  const sellerProfile = { companyName: 'Northstar', services: ['Automatización de operaciones'] };
  const prompts: string[] = [];
  let active = 0;
  let maxActive = 0;

  const result = await synthesizeResearchReportDocumentV1({ snapshot, sellerProfile, generatedAt }, {
    generate: async (input) => {
      prompts.push(input.prompt);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return {
        data: validOutputFor(sectionFromPrompt(input.prompt), true),
        telemetry: { modelName: 'test-model' },
      };
    },
  });

  assert.equal(prompts.length, 5);
  assert.equal(maxActive, 5);
  assert.deepEqual(
    new Set(prompts.map(sectionFromPrompt)),
    new Set<AnalystSection>(['executiveSummary', 'leadContext', 'companyProfile', 'commercialReading', 'serviceFit']),
  );
  assert.equal(new Set(prompts).size, 5);
  assert.equal(result.metadata.generationMethod, 'model');
  assert.equal(result.metadata.model, 'test-model');
  assert.equal(result.metadata.promptVersion, 'native-research-report-synthesis/v8');
  assert.equal(RESEARCH_REPORT_PROMPT_VERSION, 'native-research-report-synthesis/v8');
  assert.match(result.document.narrative?.executiveSummary[0]?.text || '', /^Antes de contactar/);
  assert.equal(
    result.document.narrative?.companyProfile[0].text,
    'La propuesta de Acme pone el foco en reducir trabajo manual dentro de las operaciones.',
  );
  assert.notEqual(
    result.document.narrative?.companyProfile[0].text,
    snapshot.claims.find((claim) => claim.id === 'claim-acme-overview')?.statement,
  );
  assert.deepEqual(result.document.narrative?.companyProfile[0].evidenceIds, ['evidence-acme']);
  assert.match(result.document.narrative?.serviceFit?.[0].text || '', /Northstar/);

  const inputs = prompts.map(canonicalInputFromPrompt);
  assert.equal(inputs.every((input) => input.claims.length <= 32 && input.evidence.length <= 64), true);
  assert.equal(inputs.filter((input) => input.sellerContext).length, 1);
  assert.equal(inputs.find((input) => input.sellerContext)?.section, 'serviceFit');
  assert.equal(inputs.find((input) => input.section === 'leadContext')?.claims.every((claim) => claim.subjectScope === 'person'), true);
  assert.equal(inputs.find((input) => input.section === 'companyProfile')?.claims.every((claim) => claim.subjectScope === 'company'), true);
  assert.doesNotThrow(() => validateResearchReportDocumentCitationsV1(result.document, snapshot));
});

test('deterministic fallback reads as a pre-contact brief instead of pasted source copy', () => {
  const snapshot = draftSnapshotFixture();
  const companyClaim = snapshot.claims.find((claim) => claim.id === 'claim-acme-overview')!;
  const result = buildDeterministicResearchReportDocumentV1({
    snapshot,
    sellerProfile: { companyName: 'Northstar', services: ['Automatización de operaciones'] },
    generatedAt: '2026-08-24T18:12:00.000Z',
  });

  const executive = result.narrative?.executiveSummary[0]?.text || '';
  const commercial = result.narrative?.commercialReading[0]?.text || '';
  const serviceFit = result.narrative?.serviceFit?.[0]?.text || '';
  assert.match(executive, /^Antes de contactar a Ada Lovelace/);
  assert.equal(executive.includes(companyClaim.statement), false);
  assert.match(executive, /confirma sus prioridades actuales/i);
  assert.match(commercial, /posibles prioridades o fricciones/i);
  assert.match(commercial, /no confirma un dolor concreto/i);
  assert.match(serviceFit, /^Según tu perfil/);
  assert.equal(serviceFit.includes(companyClaim.statement), false);
  assert.doesNotThrow(() => validateResearchReportDocumentCitationsV1(result, snapshot));
});

test('omits verbatim page copy in the executive analyst output', async () => {
  const snapshot = draftSnapshotFixture();
  const generatedAt = '2026-08-24T18:14:00.000Z';
  const copiedClaim = snapshot.claims.find((claim) => claim.id === 'claim-acme-overview')!;

  const result = await synthesizeResearchReportDocumentV1({ snapshot, generatedAt }, {
    generate: async (input) => {
      const section = sectionFromPrompt(input.prompt);
      if (section === 'executiveSummary') {
        return {
          data: { paragraphs: [{ text: copiedClaim.statement, claimIds: [copiedClaim.id] }] },
          telemetry: { modelName: 'test-model' },
        };
      }
      return { data: validOutputFor(section), telemetry: { modelName: 'test-model' } };
    },
  });

  assert.equal(result.metadata.status, 'partial');
  assert.deepEqual(result.document.narrative?.executiveSummary, []);
});

test('seller profile remains private context and supports cautious model service fit', async () => {
  const snapshot = draftSnapshotFixture();
  const generatedAt = '2026-08-24T18:15:00.000Z';
  const sellerProfile = {
    companyName: 'Northstar',
    services: ['Automatización de operaciones'],
    valueProposition: 'Reducimos trabajo manual con automatización responsable.',
  };
  const prompts: string[] = [];
  const result = await synthesizeResearchReportDocumentV1({ snapshot, sellerProfile, generatedAt }, {
    generate: async (input) => {
      prompts.push(input.prompt);
      return {
        data: validOutputFor(sectionFromPrompt(input.prompt), true),
        telemetry: { modelName: 'test-model' },
      };
    },
  });

  assert.equal(result.document.sellerContext?.companyName, 'Northstar');
  assert.equal(result.document.synthesis.sellerProfileHash, sellerProfileHash(sellerProfile));
  assert.match(result.document.narrative?.serviceFit?.[0].text || '', /podría ser pertinente/);
  assert.deepEqual(result.document.narrative?.serviceFit?.[0].claimIds, ['claim-acme-overview']);
  assert.deepEqual(result.document.narrative?.serviceFit?.[0].evidenceIds, ['evidence-acme']);
  assert.equal(prompts.filter((prompt) => prompt.includes('Northstar')).length, 1);
  assert.equal(sectionFromPrompt(prompts.find((prompt) => prompt.includes('Northstar')) || ''), 'serviceFit');
  assert.doesNotThrow(() => validateResearchReportDocumentCitationsV1(result.document, snapshot));
});

test('rejects invalid citations and unsupported numeric assertions only in their sections', async () => {
  const snapshot = draftSnapshotFixture();
  const generatedAt = '2026-08-24T18:20:00.000Z';

  const result = await synthesizeResearchReportDocumentV1({ snapshot, generatedAt }, {
    generate: async (input) => {
      const section = sectionFromPrompt(input.prompt);
      if (section === 'executiveSummary') {
        return {
          data: { paragraphs: [{ text: 'Acme presenta un contexto operativo claro.', claimIds: ['unknown-model-claim'] }] },
          telemetry: { modelName: 'test-model' },
        };
      }
      if (section === 'companyProfile') {
        return {
          data: { paragraphs: [{ text: 'Acme cuenta con 500 empleados y reduce trabajo manual.', claimIds: ['claim-acme-overview'] }] },
          telemetry: { modelName: 'test-model' },
        };
      }
      return { data: validOutputFor(section), telemetry: { modelName: 'test-model' } };
    },
  });

  assert.equal(result.metadata.generationMethod, 'model');
  assert.equal(result.metadata.status, 'partial');
  assert.equal(result.metadata.retryable, true);
  assert.equal(result.metadata.errorCode, 'report_synthesis_partial');
  assert.deepEqual(result.document.narrative?.executiveSummary, []);
  assert.deepEqual(result.document.narrative?.companyProfile, []);
  assert.equal(
    result.document.narrative?.leadContext[0].text,
    'La evidencia pública vincula a Ada Lovelace con la dirección de Operaciones.',
  );
  assert.doesNotThrow(() => validateResearchReportDocumentCitationsV1(result.document, snapshot));
});

test('rejects unsupported entities, customer claims, needs, and causal conclusions', async () => {
  const snapshot = draftSnapshotFixture();
  const generatedAt = '2026-08-24T18:22:00.000Z';

  const result = await synthesizeResearchReportDocumentV1({ snapshot, generatedAt }, {
    generate: async (input) => {
      const section = sectionFromPrompt(input.prompt);
      if (section === 'companyProfile') {
        return {
          data: { paragraphs: [{ text: 'Contoso es cliente de Acme debido a su necesidad operativa.', claimIds: ['claim-acme-overview'] }] },
          telemetry: { modelName: 'test-model' },
        };
      }
      if (section === 'commercialReading') {
        return {
          data: { paragraphs: [{ text: 'Acme necesita automatización y por lo tanto comprará este año.', claimIds: ['claim-acme-opportunity'] }] },
          telemetry: { modelName: 'test-model' },
        };
      }
      return { data: validOutputFor(section), telemetry: { modelName: 'test-model' } };
    },
  });

  assert.equal(result.metadata.status, 'partial');
  assert.deepEqual(result.document.narrative?.companyProfile, []);
  assert.deepEqual(result.document.narrative?.commercialReading, []);
  assert.equal(
    result.document.narrative?.leadContext[0].text,
    'La evidencia pública vincula a Ada Lovelace con la dirección de Operaciones.',
  );
  assert.doesNotThrow(() => validateResearchReportDocumentCitationsV1(result.document, snapshot));
});

test('rejects unsupported market-leadership prose', async () => {
  const snapshot = draftSnapshotFixture();
  const generatedAt = '2026-08-24T18:23:00.000Z';

  const result = await synthesizeResearchReportDocumentV1({ snapshot, generatedAt }, {
    generate: async (input) => {
      const section = sectionFromPrompt(input.prompt);
      if (section === 'companyProfile') {
        return {
          data: { paragraphs: [{ text: 'Acme lidera el mercado mundial.', claimIds: ['claim-acme-overview'] }] },
          telemetry: { modelName: 'test-model' },
        };
      }
      return { data: validOutputFor(section), telemetry: { modelName: 'test-model' } };
    },
  });

  assert.deepEqual(result.document.narrative?.companyProfile, []);
  assert.equal(result.metadata.status, 'partial');
});

test('one analyst rejection omits only that section and marks model synthesis partial', async () => {
  const snapshot = draftSnapshotFixture();
  const generatedAt = '2026-08-24T18:25:00.000Z';
  const sellerProfile = {
    companyName: 'Northstar',
    valueProposition: 'Automatización responsable de operaciones.',
  };

  const result = await synthesizeResearchReportDocumentV1({ snapshot, sellerProfile, generatedAt }, {
    generate: async (input) => {
      const section = sectionFromPrompt(input.prompt);
      if (section === 'leadContext') throw new Error('lead analyst unavailable');
      return { data: validOutputFor(section, true), telemetry: { modelName: 'test-model' } };
    },
  });

  assert.equal(result.metadata.generationMethod, 'model');
  assert.equal(result.document.synthesis.method, 'model');
  assert.equal(result.metadata.status, 'partial');
  assert.equal(result.metadata.retryable, true);
  assert.deepEqual(result.document.narrative?.leadContext, []);
  assert.equal(
    result.document.narrative?.companyProfile[0].text,
    'La propuesta de Acme pone el foco en reducir trabajo manual dentro de las operaciones.',
  );
  assert.match(result.document.narrative?.serviceFit?.[0].text || '', /Northstar/);
  assert.doesNotThrow(() => validateResearchReportDocumentCitationsV1(result.document, snapshot));
});

test('one analyst timeout cannot block the other specialized sections', async () => {
  const snapshot = draftSnapshotFixture();
  const generatedAt = '2026-08-24T18:27:00.000Z';
  const startedAt = Date.now();
  let timedOutSignalAborted = false;

  const result = await synthesizeResearchReportDocumentV1({
    snapshot,
    sellerProfile: { companyName: 'Northstar', services: ['Automatización de operaciones'] },
    generatedAt,
  }, {
    analystTimeoutMs: 20,
    generate: async (input) => {
      const section = sectionFromPrompt(input.prompt);
      if (section === 'leadContext') {
        input.signal?.addEventListener('abort', () => { timedOutSignalAborted = true; });
        return new Promise(() => undefined);
      }
      return { data: validOutputFor(section, true), telemetry: { modelName: `model-${section}` } };
    },
  });

  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(timedOutSignalAborted, true);
  assert.equal(result.metadata.status, 'partial');
  assert.equal(result.metadata.retryable, true);
  assert.deepEqual(result.document.narrative?.leadContext, []);
  assert.equal(
    result.metadata.model,
    'mixed:model-commercialReading,model-companyProfile,model-executiveSummary,model-serviceFit',
  );
  assert.doesNotThrow(() => validateResearchReportDocumentCitationsV1(result.document, snapshot));
});

test('all analyst failures throw ReportSynthesisFailed without a publishable document', async () => {
  const snapshot = draftSnapshotFixture({ includeRole: false });
  const generatedAt = '2026-08-24T18:30:00.000Z';
  let calls = 0;
  await assert.rejects(
    () => synthesizeResearchReportDocumentV1({ snapshot, generatedAt }, {
      generate: async () => {
        calls += 1;
        throw new Error('provider unavailable');
      },
    }),
    (error: unknown) => error instanceof ReportSynthesisFailed && error.code === 'report_synthesis_failed',
  );

  assert.equal(calls, 3);
});

test('canonical detail remains exhaustive while each analyst input stays bounded', async () => {
  const base = draftSnapshotFixture();
  const extraEvidence = Array.from({ length: 70 }, (_, index) => ({
    ...structuredClone(base.evidence[0]),
    id: `evidence-acme-extra-${index}`,
    statement: `Acme documenta la capacidad operativa verificable ${index + 1}: ${'x'.repeat(3_800)}`,
  }));
  const template = base.claims.find((claim) => claim.id === 'claim-acme-overview')!;
  const extraClaims = extraEvidence.map((evidence, index) => ({
    ...structuredClone(template),
    id: `claim-acme-extra-${index}`,
    statement: evidence.statement,
    supportingEvidenceIds: [evidence.id],
  }));
  const snapshot = {
    ...structuredClone(base),
    evidence: [...base.evidence, ...extraEvidence],
    claims: [...base.claims, ...extraClaims],
  };
  const generatedAt = '2026-08-24T18:35:00.000Z';
  const inputs: ReturnType<typeof canonicalInputFromPrompt>[] = [];

  const result = await synthesizeResearchReportDocumentV1({ snapshot, generatedAt }, {
    generate: async (input) => {
      inputs.push(canonicalInputFromPrompt(input.prompt));
      return {
        data: validOutputFor(sectionFromPrompt(input.prompt)),
        telemetry: { modelName: 'test-model' },
      };
    },
  });

  assert.equal(result.metadata.generationMethod, 'model');
  assert.equal(result.document.company.overview.length, 71);
  assert.deepEqual(result.document.completeness.claimCoverage, {
    available: 72,
    represented: 72,
    score: 1,
  });
  assert.equal(inputs.every((input) => input.claims.length <= 32), true);
  assert.equal(inputs.every((input) => input.evidence.length <= 64), true);
  assert.equal(
    inputs.every((input) => Buffer.byteLength(JSON.stringify(input), 'utf8') <= researchReportSynthesisInternals.maxAnalystInputBytes),
    true,
  );
  assert.doesNotThrow(() => validateResearchReportDocumentCitationsV1(result.document, snapshot));
});
