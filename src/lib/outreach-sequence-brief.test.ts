import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSharedSequenceBrief, RESEARCH_SEQUENCE_STEPS } from './outreach-sequence-brief';
import { selectOutreachExamples } from './outreach-example-library';
import { draftContextFixture } from './server/draft-v2-test-fixtures';

test('the brief plans four distinct stages before writing and retains facts, approved CTA and style', () => {
  const context = draftContextFixture();
  const brief = buildSharedSequenceBrief(context);
  assert.equal(RESEARCH_SEQUENCE_STEPS.length, 3);
  assert.deepEqual(brief.stages.map((stage) => stage.goal), ['initial', 'proof', 'angle', 'close']);
  assert.equal(new Set(brief.stages.flatMap((stage) => stage.exampleIds)).size, 4);
  const authorized = JSON.parse(brief.authorizedContext);
  assert.deepEqual(authorized.writingStyle, context.style.profile);
  assert.equal(authorized.approvedCta, context.constraints.cta.exactText);
  assert.equal(authorized.seller.companyName, 'Northstar');
  assert.ok(authorized.eligibleFacts.length > 0);
  assert.doesNotMatch(brief.authorizedContext, /12\.000|300 clientes|28 años|Computrabajo|Workges/);
});

test('all six playbook lines are gated by seller offering and adapted to role and stage', () => {
  for (const [offering, line] of [['Servicios transitorios', 'est'], ['Outsourcing BPO', 'bpo'], ['Selección y hunting', 'hunting'], ['Aseo y mantención', 'facility'], ['Seguridad privada', 'security'], ['Plataformas tecnológicas', 'technology']]) {
    for (const goal of ['initial', 'proof', 'angle', 'close'] as const) {
      const examples = selectOutreachExamples({ offering, goal, role: 'Gerente de Administración y Finanzas' });
      assert.equal(examples[0].id, `v2-${line}-finance-${goal}`);
      assert.match(examples[0].imitate, /previsibilidad del costo/);
      assert.match(examples[0].imitate, /No importar cifras/);
    }
  }
  const unrelated = selectOutreachExamples({ offering: 'Transporte marítimo FCL LCL', role: 'Gerente de Personas', goal: 'initial' });
  assert.equal(unrelated[0].id, 'v2-neutral-people-initial');
  assert.doesNotMatch(unrelated[0].body, /dotación|selección|plataforma/);
  const executive = selectOutreachExamples({ offering: 'BPO', role: 'Gerente General', goal: 'initial' });
  assert.match(executive[0].imitate, /menos de 90 palabras y sin bullets/);
});
