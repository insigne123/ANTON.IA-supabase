import { buildDraftMessageBrief } from '../src/lib/draft-message-brief';
import { draftContextFixture } from '../src/lib/server/draft-v2-test-fixtures';
import { draftEvidencePersonalizationStatementV2, requiredDraftPersonalizationV2, validateDraftPreflightV2 } from '../src/lib/server/draft-preflight-v2';
import { draftQualityFixtures } from './draft-quality-fixtures';

export function evaluateDraftQuality() {
  const rows = draftQualityFixtures.map((fixture) => {
    const context = draftContextFixture();
    context.person.title = fixture.role;
    context.seller.companyName = 'GrupoExpro';
    context.seller.services = draftQualityFixtures.map((item) => item.capability);
    context.seller.valueProposition = 'Servicios para empresas.';
    context.seller.description = '';
    context.seller.proofPoints = [];
    context.evidence = [{ ...context.evidence[0], statement: fixture.fact }];
    const sequence = {
      sequenceInstruction: 'Continuar sin repetir.',
      priorMessages: [{ kind: 'initial' as const, index: 0, name: 'Inicial', subject: 'Tema de Acme', body: fixture.previous }],
      currentStep: { index: 1, total: 2, name: 'Segundo', offsetDays: 4, instruction: 'Precisar alcance sin inventar prueba.' },
    };
    const brief = buildDraftMessageBrief(context, sequence);
    // Faithful v8 field projection for these fixtures, not an LLM baseline:
    // role and bodies absent, capabilities sliced to four, fact excerpt retained.
    const baseline = {
      role: null,
      capabilities: context.seller.services.slice(0, 4),
      fact: draftEvidencePersonalizationStatementV2(fixture.fact),
      previousSubjects: sequence.priorMessages.map((message) => message.subject),
    };
    const output = {
      subject: `Acme y ${fixture.service}`,
      body: `Hola Ada,\n\n${fixture.fact}\n\n${fixture.offer}\n\n${context.constraints.cta.exactText}`,
      personalization: requiredDraftPersonalizationV2(context),
      hypothesisIds: [],
    };
    const positive = validateDraftPreflightV2(context, output);
    const attacks = [
      { name: 'unsupported_seller_scale', body: `${output.body}\n\nGrupoExpro tiene 12000 trabajadores.`, personalization: output.personalization, code: 'unsupported_material_claim' },
      { name: 'unsupported_target_number', body: `${output.body}\n\nAcme opera 16 sedes.`, personalization: output.personalization, code: 'unsupported_material_claim' },
      { name: 'extra_cta', body: `${output.body}\n\n¿Conversamos?`, personalization: output.personalization, code: 'cta_count' },
      { name: 'forged_source', body: output.body, personalization: [{ ...output.personalization[0], sourceUrl: 'https://forged.example' }], code: 'source_url_invalid' },
    ].map((attack) => {
      const result = validateDraftPreflightV2(context, { ...output, body: attack.body, personalization: attack.personalization });
      return { name: attack.name, blockedForExpectedReason: !result.valid && result.issues.some((issue) => issue.code === attack.code) };
    });
    return {
      service: fixture.service,
      baselineCoverage: { role: baseline.role !== null, fact: baseline.fact === fixture.fact, capability: baseline.capabilities.includes(fixture.capability), priorBody: JSON.stringify(baseline).includes(fixture.previous) },
      newCoverage: { role: brief.recipient.role === fixture.role, fact: brief.eligibleFacts.some((fact) => fact.statement === fixture.fact), capability: brief.seller.capabilities.includes(fixture.capability), priorBody: brief.sequence.previousMessages[0].body.text === fixture.previous },
      handwrittenPositivePassed: positive.valid,
      positiveErrors: positive.issues,
      attacks,
    };
  });
  return {
    kind: 'deterministic_context_and_guard_evaluation',
    liveLlmCalls: 0,
    rubric: 'Exact availability of role, selected factual anchor, relevant authorized service and prior body; handwritten grounded acceptance; adversarial rejection with expected reason. Coverage is not prose quality or demonstrated continuity.',
    limitations: 'Synthetic approvals only. No verified GrupoExpro metrics. No live model, delivery, reply-rate or human naturalness measurement. v8 projection compares fields, not historical model outputs. Lexical guards are not entailment.',
    rows,
  };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/evaluate-draft-quality.ts')) {
  console.log(JSON.stringify(evaluateDraftQuality(), null, 2));
}
