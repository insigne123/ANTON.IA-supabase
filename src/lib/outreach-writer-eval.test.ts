import assert from 'node:assert/strict';
import test from 'node:test';

import { draftContextFixture } from '@/lib/server/draft-v2-test-fixtures';
import { DEFAULT_DRAFT_CTA } from '@/lib/server/draft-context-v2';
import { validateDraftPreflightV2 } from '@/lib/server/draft-preflight-v2';
import { selectOutreachStrategy } from './outreach-evidence-ranking';
import { selectOutreachExamples } from './outreach-example-library';

// Golden evaluation: template-style copy must pass the factual firewall,
// while identity substitution and fabricated figures must fail.

const CTA = DEFAULT_DRAFT_CTA;

function output(subject: string, body: string) {
  const context = draftContextFixture({ includeRole: true });
  const evidence = context.evidence.find((item) => item.supportedFactClaimIds.includes('claim-acme-overview'))!;
  return {
    context,
    output: {
      subject,
      body,
      personalization: [{
        evidenceId: evidence.evidenceId,
        claimId: 'claim-acme-overview',
        sourceUrl: evidence.source.url,
      }],
      hypothesisIds: [],
    },
  };
}

test('a template-style email grounded in evidence and seller offer passes preflight', () => {
  const { context, output: candidate } = output(
    'Acme · el trabajo manual en operaciones',
    [
      'Hola Ada,',
      '',
      'Acme comunica que ayuda a los equipos de operaciones a reducir el trabajo manual del día a día.',
      '',
      'En Northstar automatizamos esas tareas repetitivas para que la información quede disponible y el equipo responda sin pasos extra.',
      '',
      '· Automatización de operaciones con supervisión del equipo',
      '· Menos trabajo manual en la operación diaria',
      '',
      CTA,
    ].join('\n'),
  );
  const strategy = selectOutreachStrategy(context);
  assert.ok(strategy);
  assert.equal(strategy?.exploratory, false);
  const result = validateDraftPreflightV2(context, candidate);
  assert.deepEqual(result.issues, []);
  assert.equal(result.valid, true);
});

test('presenting another company as the sender loses commercial relevance', () => {
  const { context, output: candidate } = output(
    'Acme · el trabajo manual en operaciones',
    [
      'Hola Ada,',
      '',
      'Acme comunica que ayuda a los equipos de operaciones a reducir el trabajo manual del día a día.',
      '',
      'En OtroProveedor tomamos el proceso completo con equipo y supervisión propia para que recibas el resultado.',
      '',
      CTA,
    ].join('\n'),
  );
  const result = validateDraftPreflightV2(context, candidate);
  assert.ok(result.preflight.warnings.some((warning) => /relevancia comercial/i.test(warning)));
});

test('a fabricated figure fails the factual firewall', () => {
  const { context, output: candidate } = output(
    'Acme · el trabajo manual en operaciones',
    [
      'Hola Ada,',
      '',
      'Acme comunica que ayuda a los equipos de operaciones a reducir el trabajo manual del día a día.',
      '',
      'En Northstar automatizamos tareas y ya reducimos los costos un 40% en operaciones como la tuya.',
      '',
      CTA,
    ].join('\n'),
  );
  const result = validateDraftPreflightV2(context, candidate);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === 'unsupported_material_claim'));
});

test('strategy and examples stay available for the fixture context', () => {
  const context = draftContextFixture({ includeRole: true });
  const strategy = selectOutreachStrategy(context);
  assert.ok(strategy?.primaryFact.statement.length);
  assert.ok(strategy?.capability.length);
  const examples = selectOutreachExamples({ goal: 'initial', role: context.person.title, count: 2 });
  assert.equal(examples.length, 2);
});
