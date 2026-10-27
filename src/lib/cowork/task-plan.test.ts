import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkTaskApproves, coworkTaskContext, coworkTaskPlanLabel, coworkTaskPlanProblem, coworkTaskPlanSchema, coworkTaskReplyContinues,
  coworkTaskThreadBudget, type CoworkActiveTask, type CoworkTaskPlan } from './task-plan';

const plan: CoworkTaskPlan = {
  goal: 'Escribirles una secuencia a los 10 mejores gerentes de RR. HH. de retail en Santiago',
  steps: [
    { label: 'Buscar 25 gerentes de RR. HH. de retail en Santiago', kind: 'search' },
    { label: 'Guardar a los 10 mejores y buscar su correo', kind: 'prepare' },
    { label: 'Escribir una secuencia de 3 correos', kind: 'write' },
    { label: 'Dejar la campaña pausada con ellos', kind: 'campaign' },
  ],
  limits: { searches: 1, credits: 10 },
};
const task = (used = { steps: 0, searches: 0, credits: 0 }): CoworkActiveTask => ({ startRunId: 'run-1', startDepth: 1, plan, used });

test('a plan has 2 to 6 steps of known kinds and limits it can spend at most', () => {
  assert.equal(coworkTaskPlanSchema.safeParse(plan).success, true);
  assert.equal(coworkTaskPlanSchema.safeParse({ ...plan, steps: plan.steps.slice(0, 1) }).success, false, 'one step is not a task');
  assert.equal(coworkTaskPlanSchema.safeParse({ ...plan, steps: [...plan.steps, { label: 'Enviar los correos', kind: 'send' }] }).success, false, 'sending is never a step');
  assert.equal(coworkTaskPlanSchema.safeParse({ ...plan, limits: { searches: 2, credits: 10 } }).success, false);
  assert.equal(coworkTaskPlanSchema.safeParse({ ...plan, limits: { searches: 1, credits: 51 } }).success, false);
});

test('limits say what the steps need', () => {
  assert.equal(coworkTaskPlanProblem(plan), null);
  assert.match(coworkTaskPlanProblem({ ...plan, limits: { searches: 0, credits: 10 } }) || '', /limits\.searches es 0/);
  assert.match(coworkTaskPlanProblem({ ...plan, steps: plan.steps.filter(step => step.kind !== 'prepare') }) || '', /limits\.credits/);
});

test('the card says the steps and the most it can spend', () => {
  assert.equal(coworkTaskPlanLabel(plan), 'Tarea de 4 pasos · hasta 1 búsqueda y 10 créditos');
  assert.equal(coworkTaskPlanLabel({ ...plan, steps: plan.steps.slice(2), limits: { searches: 0, credits: 0 } }), 'Tarea de 2 pasos · sin gastos');
});

test('inside the plan and its limits the task approves by itself; anything else waits for the person', () => {
  assert.equal(coworkTaskApproves(task(), null, { searches: 1, credits: 0 }), true, 'the search of the plan');
  assert.equal(coworkTaskApproves(task(), 'lead_prepare_batch', { searches: 0, credits: 10 }), true);
  assert.equal(coworkTaskApproves(task(), 'campaign_create', { searches: 0, credits: 0 }), true, 'a paused campaign');
  for (const kind of ['send_email', 'campaign_activate', 'campaign_schedule_batch', 'linkedin_invite', 'linkedin_message_batch', 'reply_thread', 'code_execute', 'enrich_phone']) {
    assert.equal(coworkTaskApproves(task(), kind, { searches: 0, credits: 0 }), false, kind);
  }
  // Beyond what is left.
  assert.equal(coworkTaskApproves(task({ steps: 1, searches: 1, credits: 0 }), null, { searches: 1, credits: 0 }), false, 'a second search');
  assert.equal(coworkTaskApproves(task({ steps: 1, searches: 1, credits: 4 }), 'lead_prepare_batch', { searches: 0, credits: 7 }), false, 'more credits');
  assert.equal(coworkTaskApproves(task({ steps: 5, searches: 1, credits: 10 }), 'campaign_create', { searches: 0, credits: 0 }), false, 'more steps than the plan');
  // A plan without a campaign step does not create one by itself.
  const noCampaign: CoworkActiveTask = { ...task(), plan: { ...plan, steps: plan.steps.slice(0, 3) } };
  assert.equal(coworkTaskApproves(noCampaign, 'campaign_create', { searches: 0, credits: 0 }), false);
});

test('a thread running a task has room for its steps, never past 10 deep', () => {
  const base = { maxDepth: 5, maxEffects: 6, maxSearches: 2, maxDrafts: 3 };
  assert.deepEqual(coworkTaskThreadBudget(base, null), base);
  assert.deepEqual(coworkTaskThreadBudget(base, { ...task(), startDepth: 3 }), { maxDepth: 9, maxEffects: 6, maxSearches: 2, maxDrafts: 3 });
  assert.equal(coworkTaskThreadBudget(base, { ...task(), startDepth: 8 }).maxDepth, 10);
});

test('a turn of the task reads the plan, what it spent and what is left', () => {
  const context = coworkTaskContext(task({ steps: 1, searches: 1, credits: 0 }));
  assert.deepEqual(context.left, { searches: 0, credits: 10 });
  assert.match(context.instruction, /siguiente paso pendiente del plan/);
  assert.match(context.instruction, /enviar, activar, LinkedIn o un gasto mayor/);
});

test('a reply of the person goes on with the task when it is a «sí», the answer it asked for or one it offered; a stop or a new request ends it', () => {
  const quiet = { asked: false, offered: [] };
  for (const yes of ['Sí', 'sí, dale', 'Dale, sigue.', 'ok adelante por favor', '¡Perfecto, continúa!', 'Ya', 'de acuerdo, hazlo', 'Con todo']) {
    assert.equal(coworkTaskReplyContinues(yes, quiet), true, yes);
  }
  // An answer goes on only when the turn before asked: without a question it is a new request.
  const asked = { asked: true, offered: [] };
  assert.equal(coworkTaskReplyContinues('Solo Santiago y Valparaíso.', asked), true);
  assert.equal(coworkTaskReplyContinues('Sí, dale con la investigación de Camila y Felipe', asked), true);
  assert.equal(coworkTaskReplyContinues('Solo Santiago y Valparaíso.', quiet), false);
  assert.equal(coworkTaskReplyContinues('Ahora búscame gerentes de minería en Antofagasta', quiet), false);
  // A button or a choice the turn offered, as the app sends it.
  const offered = { asked: false, offered: ['Crear la campaña pausada', 'Solo a los 5 con correo'] };
  assert.equal(coworkTaskReplyContinues('Crear la campaña pausada', offered), true);
  assert.equal(coworkTaskReplyContinues('Crear otra campaña', offered), false);
  // A stop or a plain «no» ends it even after a question; «para» inside a sentence is not a stop.
  for (const stop of ['Para', 'para, no sigas', 'Espera.', 'Esperá un poco', 'No, mejor no', 'No', 'No, gracias', 'No, todavía no', 'no, espera',
    'sí pero no sigas con la campaña', 'Cancela la tarea', 'detenla']) {
    assert.equal(coworkTaskReplyContinues(stop, asked), false, stop);
  }
  assert.equal(coworkTaskReplyContinues('Prepara los correos para Camila y Felipe', asked), true);
  // A «no» that answers or steers goes on, as the task bench's person wrote it.
  assert.equal(coworkTaskReplyContinues('No, solo Santiago', asked), true);
  assert.equal(coworkTaskReplyContinues('No, todavía no. Primero lee los informes de Valentina y Matías y confirma las dos señales en fuentes reales, no solo en la portada. Después escribe los correos.', asked), true);
  assert.equal(coworkTaskReplyContinues('No, solo Santiago', quiet), false, 'after a turn that asked nothing it is a new request');
  // A long message, or one that opens as a new request, is a new request whatever came before.
  assert.equal(coworkTaskReplyContinues(`Sí, ${'y además '.repeat(40)}`, asked), false);
  assert.equal(coworkTaskReplyContinues(`Solo Santiago, ${'y también Valparaíso '.repeat(14)}`, asked), false);
  assert.equal(coworkTaskReplyContinues('Ahora busca gerentes de minería', asked), false);
  assert.equal(coworkTaskReplyContinues('Otra cosa: ¿cuántos créditos me quedan?', asked), false);
  assert.equal(coworkTaskReplyContinues('   ', asked), false);
});
