import assert from 'node:assert/strict';
import test from 'node:test';

import {
  draftEvidencePersonalizationStatementV2,
  draftContentFingerprintV2,
  requiredDraftPersonalizationV2,
  stripUnapprovedDraftCtasV2,
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

test('personalization narrows a comma-separated service catalog to one factual detail', () => {
  const statement = 'Outsourcing de Recursos Humanos, reclutamiento y servicios transitorios para optimizar la gestión de personas.';

  assert.equal(draftEvidencePersonalizationStatementV2(statement), 'Outsourcing de Recursos Humanos');
});

test('personalization preserves a conditional qualifier after a comma', () => {
  const statement = 'Acme planea abrir una nueva sede, siempre que obtenga la aprobación regulatoria.';

  assert.equal(draftEvidencePersonalizationStatementV2(statement), statement);
});

function validOutput(): GeneratedOutreachV2 {
  const context = draftContextFixture();
  const evidence = context.evidence.find((item) => item.supportedFactClaimIds.includes('claim-acme-overview'))!;
  return {
    subject: 'Operaciones en Acme',
    body: `Hola Ada,

Acme comunica que ayuda a equipos de operaciones a reducir trabajo manual.

En Northstar automatizamos tareas repetitivas para reducir trabajo manual y dejar la información disponible para el equipo.

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

test('draft preflight accepts a faithful natural paraphrase of supported evidence', () => {
  const context = draftContextFixture();
  const output = validOutput();
  const result = validateDraftPreflightV2(context, {
    ...output,
    body: output.body.replace(
      'Acme comunica que ayuda a equipos de operaciones a reducir trabajo manual.',
      'Acme comunica un foco claro en reducir tareas manuales de operaciones.',
    ),
  }, { now: new Date('2026-08-22T12:00:00.000Z') });

  assert.equal(result.valid, true);
  assert.ok(!result.issues.some((issue) => issue.code === 'personalization_invalid'));
});

test('draft preflight accepts concise copy that keeps two material evidence concepts', () => {
  const context = draftContextFixture();
  const output = validOutput();
  const result = validateDraftPreflightV2(context, {
    ...output,
    body: output.body.replace(
      'Acme comunica que ayuda a equipos de operaciones a reducir trabajo manual.',
      'Acme está poniendo foco en sus operaciones.',
    ),
  });

  assert.equal(result.valid, true);
  assert.ok(!result.issues.some((issue) => issue.code === 'personalization_invalid'));
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

test('draft preflight preserves ordinary coordination language while removing coordination CTAs', () => {
  const context = draftContextFixture();
  const factualSentence = 'Acme coordina outsourcing de Recursos Humanos para apoyar sus operaciones.';
  const body = `Hola Ada,

${factualSentence}

Northstar ordena tareas repetitivas y facilita la revisión de documentos.

${context.constraints.cta.exactText}`;

  const stripped = stripUnapprovedDraftCtasV2(body, context.constraints.cta.exactText);

  assert.match(stripped, new RegExp(factualSentence));
  assert.doesNotMatch(
    stripUnapprovedDraftCtasV2(
      `${body}\n\nCoordinamos una llamada la próxima semana.`,
      context.constraints.cta.exactText,
    ),
    /Coordinamos una llamada/,
  );
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

test('draft preflight rejects generic corporate language that makes outreach feel automated', () => {
  const context = draftContextFixture();
  const output = validOutput();
  const result = validateDraftPreflightV2(context, {
    ...output,
    body: output.body.replace(
      'En Northstar automatizamos tareas repetitivas',
      'En Northstar nos especializamos en automatizar tareas repetitivas',
    ),
  });

  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === 'prohibited_phrase'));
});

test('draft preflight rejects a seller mention without a practical commercial bridge', () => {
  const context = draftContextFixture();
  const output = validOutput();
  const result = validateDraftPreflightV2(context, {
    ...output,
    body: output.body.replace(
      'En Northstar automatizamos tareas repetitivas para reducir trabajo manual y dejar la información disponible para el equipo.',
      'Northstar ordena tareas repetitivas.',
    ),
  });

  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === 'commercial_relevance'));
});

test('draft preflight rejects internal sequence language and literal formal titles', () => {
  const context = draftContextFixture();
  const output = validOutput();
  const variants = [
    { ...output, subject: 'Seguimiento breve' },
    { ...output, body: `${output.body}\n\nPensé en un ángulo acotado para este seguimiento.` },
    { ...output, body: output.body.replace('En Northstar automatizamos', 'Por tu rol de Directora de Operaciones, En Northstar automatizamos') },
  ];

  for (const variant of variants) {
    const result = validateDraftPreflightV2(context, variant);
    assert.equal(result.valid, false, JSON.stringify(variant));
    assert.ok(result.issues.some((issue) => issue.code === 'prohibited_phrase'), JSON.stringify(variant));
  }
});

test('draft preflight rejects meta caution and an offer unrelated to the seller profile', () => {
  const context = draftContextFixture();
  const output = validOutput();
  const variants = [
    output.body.replace(
      'En Northstar automatizamos tareas repetitivas para reducir trabajo manual y dejar la información disponible para el equipo.',
      'En Northstar buscamos ordenar ese relato para mejorar mensajes comerciales sin asumir prioridades actuales.',
    ),
    output.body.replace(
      'En Northstar automatizamos tareas repetitivas para reducir trabajo manual y dejar la información disponible para el equipo.',
      'En Northstar coordinamos campañas de eventos para que más invitados confirmen su asistencia.',
    ),
  ];

  const [metaResult, unrelatedResult] = variants.map((body) => validateDraftPreflightV2(context, { ...output, body }));
  assert.equal(metaResult.valid, false);
  assert.ok(metaResult.issues.some((issue) => issue.code === 'abstract_language' || issue.code === 'prohibited_phrase'));
  assert.equal(unrelatedResult.valid, false);
  assert.ok(unrelatedResult.issues.some((issue) => issue.code === 'commercial_relevance'));
});

test('draft preflight rejects synthetic transitions used to pad outreach copy', () => {
  const context = draftContextFixture();
  const output = validOutput();
  const phrases = [
    'Con ese alcance, mi foco sería una idea puntual.',
    'Es una forma acotada de ayudar sin sumar otra capa de trabajo.',
    'Te comparto el punto de manera breve.',
    'Quería compartirte una idea sobre operaciones.',
  ];

  for (const phrase of phrases) {
    const result = validateDraftPreflightV2(context, {
      ...output,
      body: output.body.replace('En Northstar automatizamos', `${phrase} En Northstar automatizamos`),
    });
    assert.equal(result.valid, false, phrase);
    assert.ok(result.issues.some((issue) => issue.code === 'prohibited_phrase'), phrase);
  }
});

test('draft preflight rejects a corporate evidence catalog instead of natural personalization', () => {
  const baseContext = draftContextFixture();
  const context = {
    ...baseContext,
    evidence: baseContext.evidence.map((evidence) => evidence.evidenceId === 'evidence-acme'
      ? {
        ...evidence,
        statement: 'Outsourcing de Recursos Humanos, reclutamiento y servicios transitorios para optimizar la gestión de personas.',
      }
      : evidence),
  };
  const output = validOutput();
  const result = validateDraftPreflightV2(context, {
    ...output,
    body: output.body.replace(
      'Acme comunica que ayuda a equipos de operaciones a reducir trabajo manual.',
      'Acme reúne outsourcing de Recursos Humanos, reclutamiento y servicios transitorios.',
    ),
  });

  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => (
    issue.code === 'personalization_invalid' && issue.message.includes('enumera la fuente')
  )));
});

test('draft preflight accepts natural prose that shares several concepts with a long evidence statement', () => {
  const baseContext = draftContextFixture();
  const context = {
    ...baseContext,
    evidence: baseContext.evidence.map((evidence) => evidence.evidenceId === 'evidence-acme'
      ? {
        ...evidence,
        statement: 'Acme publica que ayuda a equipos de operaciones a reducir trabajo manual mediante procesos claros y revisión de documentos.',
      }
      : evidence),
  };
  const output = validOutput();
  const result = validateDraftPreflightV2(context, {
    ...output,
    body: output.body.replace(
      'Acme comunica que ayuda a equipos de operaciones a reducir trabajo manual.',
      'Acme reduce trabajo manual en operaciones con procesos claros.',
    ),
  });

  assert.equal(result.valid, true);
  assert.ok(!result.issues.some((issue) => issue.code === 'personalization_invalid'));
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

test('person-scoped provenance rejects generic copy without material role evidence', () => {
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
    subject: 'Procesos en Acme',
    body: `Hola Ada,

Quería compartirte una idea breve que podría ser útil para ordenar tareas repetitivas y liberar tiempo del equipo sin cambiar de golpe su forma habitual de trabajar.

En Northstar partimos observando el flujo actual y elegimos un primer ajuste pequeño, medible y fácil de adoptar. Así la conversación comienza por el contexto real antes de proponer una alternativa concreta.

${context.constraints.cta.exactText}`,
    personalization,
  }, { now: new Date('2026-08-22T12:00:00.000Z') });

  assert.equal(personalization[0].claimId, 'claim-ada-role');
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === 'personalization_invalid'));
});
