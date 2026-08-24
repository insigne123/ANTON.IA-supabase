import assert from 'node:assert/strict';
import test from 'node:test';

import {
  draftEvidencePersonalizationStatementV2,
  draftContentFingerprintV2,
  requiredDraftPersonalizationV2,
  validateDraftPreflightV2,
  type GeneratedOutreachV2,
} from './draft-preflight-v2';
import { draftContextFixture } from './draft-v2-test-fixtures';

test('personalization uses a concise verbatim excerpt when evidence contains search boilerplate', () => {
  const statement = "Ada Lovelace - Directora de Operaciones del ...: Experiencia ; Directora de Operaciones para Chile - Perú. Acme. abr 2019 - actualidad 7 años 5 meses ; Analista de Operaciones. EMPRESA ...";
  const excerpt = draftEvidencePersonalizationStatementV2(statement);

  assert.equal(excerpt, 'Directora de Operaciones para Chile - Perú');
  assert.ok(statement.includes(excerpt));
});

function validOutput(): GeneratedOutreachV2 {
  const context = draftContextFixture();
  const evidence = context.evidence.find((item) => item.supportedFactClaimIds.includes('claim-acme-overview'))!;
  return {
    subject: 'Una idea para Acme',
    body: `Hola Ada,

Acme publica que ayuda a equipos de operaciones a reducir trabajo manual. En Northstar ayudamos a equipos que quieren ordenar tareas repetitivas sin imponer cambios bruscos a su forma de trabajo.

Por tu rol de Directora de Operaciones, pensé que podría ser útil compartir un ejemplo práctico de cómo detectar procesos que consumen tiempo y priorizar los primeros ajustes. La idea es entender el contexto de Acme antes de proponer cualquier alternativa concreta.

${context.constraints.cta.exactText}`,
    personalization: [{
      evidenceId: evidence.evidenceId,
      claimId: 'claim-acme-overview',
      sourceUrl: evidence.source.url,
    }],
    hypothesisIds: [],
  };
}

test('draft preflight passes an evidence-backed message with exactly one approved CTA', () => {
  const context = draftContextFixture();
  const output = validOutput();
  const result = validateDraftPreflightV2(context, output, { now: new Date('2026-08-22T12:00:00.000Z') });

  assert.equal(result.valid, true);
  assert.equal(result.preflight.status, 'passed');
  assert.equal(result.preflight.errors.length, 0);
});

test('draft preflight rejects provenance when only company terms and a paraphrase are visible', () => {
  const context = draftContextFixture();
  const output = validOutput();
  const result = validateDraftPreflightV2(context, {
    ...output,
    body: output.body.replace(
      'Acme publica que ayuda a equipos de operaciones a reducir trabajo manual.',
      'Acme comunica un foco claro en reducir tareas manuales de operaciones.',
    ),
  }, { now: new Date('2026-08-22T12:00:00.000Z') });

  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === 'personalization_invalid'));
});

test('draft preflight accepts an arbitrary exact CTA without requiring a known CTA cue', () => {
  const baseContext = draftContextFixture();
  const exactText = 'Gracias por considerar esta propuesta para Acme.';
  const context = {
    ...baseContext,
    constraints: {
      ...baseContext.constraints,
      cta: { ...baseContext.constraints.cta, exactText },
    },
  };
  const output = validOutput();
  const result = validateDraftPreflightV2(context, {
    ...output,
    body: output.body.replace(baseContext.constraints.cta.exactText, exactText),
  }, { now: new Date('2026-08-22T12:00:00.000Z') });

  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test('draft preflight rejects CTA language and questions outside the one exact CTA', () => {
  const context = draftContextFixture();
  const output = validOutput();

  for (const extra of ['Podemos conversar mañana.', '¿Hay algún detalle pendiente?']) {
    const result = validateDraftPreflightV2(context, {
      ...output,
      body: `${output.body}\n\n${extra}`,
    }, { now: new Date('2026-08-22T12:00:00.000Z') });

    assert.equal(result.valid, false, extra);
    assert.ok(result.issues.some((issue) => issue.code === 'cta_count'), extra);
  }
});

test('draft preflight blocks unresolved placeholders, prohibited phrases, duplicate content, and bad provenance', () => {
  const context = draftContextFixture();
  const output = validOutput();
  const result = validateDraftPreflightV2(context, {
    ...output,
    subject: '{{company.name}} y una idea',
    body: `${output.body}\n\n${context.constraints.cta.exactText}\n\nGarantizamos resultados para Acme.`,
    personalization: [{
      ...output.personalization[0],
      sourceUrl: 'https://unverified.example/source',
    }],
  }, {
    existingContentFingerprints: [draftContentFingerprintV2('{{company.name}} y una idea', `${output.body}\n\n${context.constraints.cta.exactText}\n\nGarantizamos resultados para Acme.`)],
    now: new Date('2026-08-22T12:00:00.000Z'),
  });

  assert.equal(result.valid, false);
  assert.equal(result.preflight.status, 'failed');
  assert.ok(result.issues.some((issue) => issue.code === 'unresolved_placeholder'));
  assert.ok(result.issues.some((issue) => issue.code === 'prohibited_phrase'));
  assert.ok(result.issues.some((issue) => issue.code === 'cta_count'));
  assert.ok(result.issues.some((issue) => issue.code === 'duplicate_content'));
  assert.ok(result.issues.some((issue) => issue.code === 'source_url_invalid'));
});

test('draft preflight blocks duplicate sentences and unsupported hypothesis provenance', () => {
  const context = draftContextFixture();
  const output = validOutput();
  const repeated = 'Acme publica un foco claro en reducir trabajo manual dentro de las operaciones.';
  const result = validateDraftPreflightV2(context, {
    ...output,
    body: `${output.body}\n\n${repeated} ${repeated}`,
    hypothesisIds: ['claim-not-in-context'],
  }, { now: new Date('2026-08-22T12:00:00.000Z') });

  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === 'duplicate_sentence'));
  assert.ok(result.issues.some((issue) => issue.code === 'hypothesis_invalid'));
});

test('person-scoped provenance requires the full evidence statement, not person terms', () => {
  const baseContext = draftContextFixture();
  const context = {
    ...baseContext,
    evidence: baseContext.evidence.map((evidence) => evidence.subjectScope === 'company'
      ? { ...evidence, supportedFactClaimIds: [] }
      : evidence),
  };
  const personalization = requiredDraftPersonalizationV2(context);
  const output = validOutput();
  const result = validateDraftPreflightV2(context, {
    ...output,
    personalization,
  }, { now: new Date('2026-08-22T12:00:00.000Z') });

  assert.equal(personalization[0].claimId, 'claim-ada-role');
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === 'personalization_invalid'));
});
