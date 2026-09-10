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
import { DRAFT_BLOCKED_SAFETY_PHRASES } from './draft-context-v2';

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

test('only safety phrases block; report-derived wording remains editable', () => {
  for (const phrase of [...DRAFT_BLOCKED_SAFETY_PHRASES, 'custom unsafe restriction']) {
    const context = draftContextFixture();
    context.constraints.prohibitedPhrases.push('custom unsafe restriction');
    const output = validOutput();
    const result = validateDraftPreflightV2(context, {
      ...output,
      body: `${output.body}\n\nSeguimos facilitando el trabajo. ${phrase}.`,
    });
    assert.equal(result.valid, false, phrase);
    assert.ok(result.issues.some((issue) => issue.code === 'prohibited_phrase'), phrase);
    assert.ok(result.preflight.warnings.some((warning) => warning.includes('facilitando')), phrase);
  }
  const output = validOutput();
  const result = validateDraftPreflightV2(draftContextFixture(), {
    ...output,
    body: `${output.body}\n\nSabemos que necesitan automatizar, facilitando el trabajo.`,
    hypothesisIds: ['claim-acme-opportunity'],
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === 'hypothesis_unqualified'));
});

test('ordinary report wording is advisory and never blocks a supported draft', () => {
  for (const phrase of ['facilitando', 'seguimiento', 'secuencia', 'ángulo', 'enfoque acotado']) {
    const context = draftContextFixture();
    const output = validOutput();
    const result = validateDraftPreflightV2(context, {
      ...output,
      body: `${output.body} ${phrase}.`,
    });

    assert.equal(result.valid, true, phrase);
    assert.ok(!result.issues.some((issue) => issue.code === 'prohibited_phrase'), phrase);
    assert.ok(result.preflight.warnings.some((warning) => warning.includes(phrase)), phrase);
  }
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

test('draft preflight warns about generic corporate language without blocking editing', () => {
  const context = draftContextFixture();
  const output = validOutput();
  const result = validateDraftPreflightV2(context, {
    ...output,
    body: output.body.replace(
      'En Northstar automatizamos tareas repetitivas',
      'En Northstar nos especializamos en automatizar tareas repetitivas',
    ),
  });

  assert.equal(result.valid, true);
  assert.ok(result.preflight.warnings.some((warning) => warning.includes('nos especializamos')));
});

test('draft preflight warns about a seller mention without a practical commercial bridge', () => {
  const context = draftContextFixture();
  const output = validOutput();
  const result = validateDraftPreflightV2(context, {
    ...output,
    body: output.body.replace(
      'En Northstar automatizamos tareas repetitivas para reducir trabajo manual y dejar la información disponible para el equipo.',
      'Northstar ordena tareas repetitivas. Nuestro equipo presenta el servicio con una descripcion breve y directa.',
    ),
  });

  assert.equal(result.valid, true);
  assert.ok(result.preflight.warnings.some((warning) => warning.includes('relevancia comercial')));
});

test('draft preflight warns about follow-up wording and literal formal titles', () => {
  const context = draftContextFixture();
  const output = validOutput();
  const variants = [
    { ...output, subject: 'Seguimiento breve' },
    { ...output, body: `${output.body}\n\nPensé en un ángulo acotado para este seguimiento.` },
    { ...output, body: output.body.replace('En Northstar automatizamos', 'Por tu rol de Directora de Operaciones, En Northstar automatizamos') },
  ];

  for (const variant of variants) {
    const result = validateDraftPreflightV2(context, variant);
    assert.equal(result.valid, true, JSON.stringify(variant));
    assert.ok(result.preflight.warnings.length > context.warnings.length, JSON.stringify(variant));
  }
});

test('draft preflight treats abstract copy and lexical commercial relevance as editorial heuristics', () => {
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
  assert.equal(metaResult.valid, true);
  assert.ok(metaResult.preflight.warnings.some((warning) => warning.includes('abstracto')));
  assert.equal(unrelatedResult.valid, true);
  assert.ok(unrelatedResult.preflight.warnings.some((warning) => warning.includes('relevancia comercial')));
});

test('draft preflight warns about synthetic transitions used to pad outreach copy', () => {
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
    assert.equal(result.valid, true, phrase);
    assert.ok(result.preflight.warnings.some((warning) => warning.includes('Revisa el estilo')), phrase);
  }
});

test('draft preflight warns about a grounded corporate evidence catalog', () => {
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

  assert.equal(result.valid, true);
  assert.ok(result.preflight.warnings.some((warning) => warning.includes('enumera la fuente')));
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

test('draft preflight warns about duplicate sentences but blocks unsupported hypothesis provenance', () => {
  const context = draftContextFixture();
  const output = validOutput();
  const repeated = 'Acme publica un foco claro en reducir trabajo manual dentro de las operaciones.';
  const result = validateDraftPreflightV2(context, {
    ...output,
    body: `${output.body}\n\n${repeated} ${repeated}`,
    hypothesisIds: ['claim-not-in-context'],
  }, { now: new Date('2026-08-22T12:00:00.000Z') });

  assert.equal(result.valid, false);
  assert.ok(result.preflight.warnings.some((warning) => warning.includes('repite una misma oración')));
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

test('material numbers cannot be borrowed from a different subject, uncited evidence or the CTA', () => {
  for (const claim of ['Acme tiene 15 sedes.', 'Northstar tiene 300 clientes.', 'Acme reduce costos en 30%.']) {
    const context = draftContextFixture();
    context.evidence.push({ ...context.evidence[0], evidenceId: 'not-cited', statement: claim });
    const output = validOutput();
    const result = validateDraftPreflightV2(context, { ...output, body: `${output.body}\n\n${claim}` });
    assert.equal(result.valid, false, claim);
    assert.ok(result.issues.some((issue) => issue.code === 'unsupported_material_claim'), claim);
  }
});

test('material numbers keep their metric and subject even when the same digits exist in evidence', () => {
  const context = draftContextFixture();
  context.evidence[0].statement = 'Acme opera 16 sedes regionales.';
  const output = validOutput();
  for (const sentence of ['Acme opera 16 sedes regionales.', 'Acme opera 16 clientes regionales.', 'Northstar opera 16 sedes regionales.']) {
    const result = validateDraftPreflightV2(context, { ...output, body: output.body.replace('Acme comunica que ayuda a equipos de operaciones a reducir trabajo manual.', sentence) });
    assert.equal(result.issues.some((issue) => issue.code === 'unsupported_material_claim'), sentence !== 'Acme opera 16 sedes regionales.', sentence);
  }
});

test('conditional and negative evidence cannot become an accomplished positive claim', () => {
  for (const statement of ['Acme planea abrir una sede regional, siempre que obtenga permisos.', 'Acme no opera sedes regionales.']) {
    const context = draftContextFixture();
    context.evidence[0].statement = statement;
    const output = validOutput();
    const result = validateDraftPreflightV2(context, { ...output, body: output.body.replace('Acme comunica que ayuda a equipos de operaciones a reducir trabajo manual.', 'Acme opera una sede regional.') });
    assert.ok(result.issues.some((issue) => issue.code === 'unsupported_material_claim'), statement);
  }
});

test('compact structure is a warning, not a waiver of factual or CTA gates', () => {
  const context = draftContextFixture();
  const output = validOutput();
  const compact = output.body.replace('manual.\n\nEn Northstar', 'manual. En Northstar');
  const result = validateDraftPreflightV2(context, { ...output, body: compact });
  assert.ok(result.preflight.warnings.some((warning) => warning.includes('legibilidad')));
  assert.ok(!result.issues.some((issue) => issue.code === 'body_structure'));
  const invalid = validateDraftPreflightV2(context, { ...output, body: compact.replace(context.constraints.cta.exactText, '') });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.some((issue) => issue.code === 'cta_count'));
});

test('CTA normalization preserves template bullet boundaries', () => {
  const body = 'Oferta:\n· Seleccion de personal.\n· Evaluacion de candidatos.';
  assert.equal(stripUnapprovedDraftCtasV2(body, ''), body);
});

test('numeric grounding preserves percent units and whole numeric boundaries', () => {
  const context = draftContextFixture();
  context.evidence[0].statement = 'Acme opera 116 sedes regionales.';
  const output = validOutput();
  for (const claim of ['Acme opera 16 sedes regionales.', 'Acme opera 116% sedes regionales.']) {
    const result = validateDraftPreflightV2(context, { ...output, body: `${output.body}\n\n${claim}` });
    assert.ok(result.issues.some((issue) => issue.code === 'unsupported_material_claim'), claim);
  }
});

test('subject keywords cannot substitute for evidence in the actual body', () => {
  const context = draftContextFixture();
  const output = validOutput();
  const result = validateDraftPreflightV2(context, {
    ...output,
    subject: 'Acme y operaciones',
    body: `Hola Ada,\n\nUna nota breve sobre este tema.\n\nUn servicio con alcance definido.\n\n${context.constraints.cta.exactText}`,
  });
  assert.ok(result.issues.some((issue) => issue.code === 'personalization_invalid'));
});

test('quantities allow natural trailing prose without consuming connectors or new lines', () => {
  const context = draftContextFixture();
  context.evidence[0].statement = 'Acme opera 16 sedes regionales.';
  const output = validOutput();
  for (const sentence of ['Acme opera 16 sedes para atender operaciones.', 'Acme opera 16 sedes\npara atender operaciones.', 'Acme opera 16 sedes.\nFCL y LCL son servicios.']) {
    const result = validateDraftPreflightV2(context, { ...output, body: `${output.body}\n\n${sentence}` });
    assert.ok(!result.issues.some((issue) => issue.code === 'unsupported_material_claim'), sentence);
  }
});

test('list markers and FCL/LCL labels are not quantities but their numeric contents are', () => {
  const context = draftContextFixture();
  context.seller.services.push('Transporte maritimo FCL y LCL');
  const output = validOutput();
  for (const sentence of ['1. FCL\n2. LCL', '1) FCL\n2) LCL', 'FCL y LCL']) {
    const result = validateDraftPreflightV2(context, { ...output, body: `${output.body}\n\n${sentence}` });
    assert.ok(!result.issues.some((issue) => issue.code === 'unsupported_material_claim'), sentence);
  }
  for (const sentence of ['1 FCL', '1. 1 FCL', '1) Northstar transporta 1 FCL.', '1. Acme opera 300 clientes.', '1.5 FCL']) {
    const result = validateDraftPreflightV2(context, { ...output, body: `${output.body}\n\n${sentence}` });
    assert.ok(result.issues.some((issue) => issue.code === 'unsupported_material_claim'), sentence);
  }
  context.seller.proofPoints.push('Northstar transporta 1 FCL por semana.');
  const supported = validateDraftPreflightV2(context, { ...output, body: `${output.body}\n\nNorthstar transporta 1 FCL por semana.` });
  assert.ok(!supported.issues.some((issue) => issue.code === 'unsupported_material_claim'));
});

test('percent paraphrases preserve metric and subject and numeric feedback stays bounded', () => {
  const context = draftContextFixture();
  context.evidence[0].statement = 'Acme reduce costos en 30%.';
  const output = validOutput();
  for (const [sentence, allowed] of [
    ['Acme reduce costos en 30 por ciento.', true],
    ['Acme reduce tiempos en 30%.', false],
    ['Northstar reduce costos en 30%.', false],
    ['Acme reduce costos en 30.', false],
  ] as const) {
    const result = validateDraftPreflightV2(context, { ...output, body: `${output.body}\n\n${sentence}` });
    assert.equal(!result.issues.some((issue) => issue.code === 'unsupported_material_claim'), allowed, sentence);
  }
  const result = validateDraftPreflightV2(context, { ...output, body: `${output.body}\n\nAcme transporta 1 FCL ${'sin respaldo '.repeat(100)}.` });
  const issue = result.issues.find((item) => item.code === 'unsupported_material_claim')!;
  assert.match(issue.message, /1 FCL.*Oración/);
  assert.ok(issue.message.length < 400);
  assert.doesNotMatch(issue.message, /Hola Ada/);
});
