import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_CONTINUE_AFTER_BATCH, COWORK_CONTINUE_AFTER_EFFECT, COWORK_CONTINUE_AFTER_PLAN, COWORK_CONTINUE_AFTER_SEARCH } from '../src/lib/cowork/continuation-messages';
import type { CorpusHistoryTurn, CorpusTurnResult } from './fixtures/cowork-conversation-corpus';
import { activeTask, COWORK_TASKS, nextTurn, simulateEffect, simulateSearch, taskWorld, writtenReads } from './fixtures/cowork-task-corpus';

const base = (over: Partial<CorpusTurnResult>): CorpusTurnResult => ({ actions: [], reply: '', document: null, proposal: null, search: null, note: null, failed: null, ...over });
const task = COWORK_TASKS[0];
const AT = '2026-09-25T13:10:00.000Z';

test('every task says what it asks, what done means and what a person expects on the way', () => {
  assert.ok(COWORK_TASKS.length >= 8);
  assert.equal(new Set(COWORK_TASKS.map(item => item.id)).size, COWORK_TASKS.length, 'ids are unique');
  for (const item of COWORK_TASKS) assert.ok(item.request.length > 30 && item.goal.length > 30 && item.expected.length > 0, item.id);
});

test('an approved search brings people that fit, shaped as the search returns them', () => {
  const found = simulateSearch({ titles: ['Jefe de Selección'], industries: ['retail'], locations: ['Santiago'], limit: 10 });
  assert.equal(found.scope, 'external_search');
  assert.equal(found.returned, 10);
  // As many as the plan asks for, up to 25, each a different person.
  const twenty = simulateSearch({ titles: ['Jefe de Selección'], industries: ['construcción'], limit: 20 });
  assert.equal(twenty.returned, 20);
  assert.equal(simulateSearch({ titles: ['Jefe de Selección'], industries: ['retail'], limit: 40 }).returned, 25);
  const many = simulateSearch({ titles: ['Jefe de Selección'], industries: ['retail'], limit: 25 }).items as Array<{ name: string }>;
  assert.equal(new Set(many.map(item => item.name)).size, 25);
  const first = found.items[0] as { id: string; title: string; industry: string; email: unknown; location: string };
  assert.match(first.id, /^apollo:sim-\d+$/);
  assert.equal(first.title, 'Jefe de Selección');
  assert.equal(first.industry, 'Retail');
  assert.equal(first.email, null, 'a search never brings emails');
  assert.match(first.location, /^Santiago/);
  assert.equal(simulateSearch({ target: 'companies', keywords: 'logística', limit: 8 }).scope, 'external_company_search');
});

test('the search resumes the conversation as the worker does, with its result in the history', () => {
  const criteria = { titles: ['Gerente de Personas'], industries: ['minería'], limit: 5 };
  const next = nextTurn(task, { request: task.request, at: AT, result: base({ search: criteria, note: 'Propongo buscar.' }), observations: [] }, [], 0)!;
  assert.equal(next.request, COWORK_CONTINUE_AFTER_SEARCH);
  assert.equal(next.turn.reply, 'Propongo buscar.');
  const observation = next.turn.observations!.at(-1) as { action: string; result: { items: unknown[] } };
  assert.equal(observation.action, 'prospecting.search');
  assert.equal(observation.result.items.length, 5);
});

test('a batch is played on the people it names: two of every three get an email, and the rest are ready with a note, as in production', () => {
  const found = simulateSearch({ titles: ['Gerente de Personas'], industries: ['retail'], limit: 3 });
  const history = [{ request: 'x', reply: 'y', at: AT, observations: [{ action: 'prospecting.search', input: {}, result: found }] }];
  const proposal = { kind: 'lead_prepare_batch', label: 'Preparar 3', prepareBatch: { goal: 'email' as const, people: 3 },
    who: found.items.map(item => ({ providerId: (item as { id: string }).id })) };
  const effect = simulateEffect(proposal, history) as { reply: string; result: { items: Array<{ name: string; email: string | null; status: string; steps: Array<{ step: string; detail?: string }> }> } };
  assert.deepEqual(effect.result.items.map(item => item.name), found.items.map(item => (item as { name: string }).name), 'the same people, by name');
  assert.deepEqual(effect.result.items.map(item => Boolean(item.email)), [true, true, false]);
  // prepare-batch-run.ts: an email the provider did not find is a done lookup with its note, not a failure.
  assert.deepEqual(effect.result.items.map(item => item.status), ['ready', 'ready', 'ready']);
  assert.equal(effect.result.items[2].steps.find(step => step.step === 'enrich')?.detail, 'El proveedor no encontró su correo.');
  const next = nextTurn(task, { request: COWORK_CONTINUE_AFTER_SEARCH, at: AT, result: base({ proposal, note: 'Preparo el lote.' }), observations: [] }, history, 0)!;
  assert.equal(next.request, COWORK_CONTINUE_AFTER_BATCH);
  assert.equal((next.turn.actions as Array<{ outcome: string }>)[0].outcome, 'ejecutada');
});

test('a question is answered with the task’s words, then by the person; an answer without one ends the work, a failure stops it', () => {
  const asking = nextTurn({ ...task, answers: ['Solo Santiago.'] }, { request: task.request, at: AT, result: base({ reply: '¿Qué comunas?', question: '¿Qué comunas?' }), observations: [] }, [], 0)!;
  assert.equal(asking.request, 'Solo Santiago.');
  assert.equal(asking.approved, null);
  assert.equal(nextTurn(task, { request: task.request, at: AT, result: base({ reply: '¿Qué comunas?', question: '¿Qué comunas?' }), observations: [] }, [], 0)!.request, null,
    'past the task’s own answers, the person answers in their words');
  assert.equal(nextTurn(task, { request: 'x', at: AT, result: base({ reply: 'Listo, la campaña quedó en pausa.' }), observations: [] }, [], 0), null);
  assert.equal(nextTurn(task, { request: 'x', at: AT, result: base({ failed: 'No pude.' }), observations: [] }, [], 0), null);
  assert.equal(nextTurn(task, { request: 'x', at: AT, result: base({ proposal: { kind: 'memory_save', label: 'Recordar' } }), observations: [] }, [], 0), null,
    'a remembered preference does not resume on its own');
});

test('the account the next turn reads keeps who the work saved: a search finds them and a campaign may go to them', () => {
  const found = simulateSearch({ titles: ['Gerente de Personas'], industries: ['retail'], limit: 3 });
  const proposal = { kind: 'lead_prepare_batch', label: 'Preparar 3', prepareBatch: { goal: 'email' as const, people: 3 },
    who: found.items.map(item => ({ providerId: (item as { id: string }).id })) };
  const history = [{ request: 'x', reply: 'y', at: AT, observations: [{ action: 'prospecting.search', input: {}, result: found }] }];
  const effect = simulateEffect(proposal, history) as { result: { items: Array<{ email: string | null }> } };
  history.push({ request: 'z', reply: 'w', at: AT, observations: [], actions: [{ kind: 'lead_prepare_batch', label: 'Preparar 3', outcome: 'ejecutada', result: effect.result }] } as never);
  const world = taskWorld(history);
  const emails = effect.result.items.flatMap(item => item.email ? [item.email] : []);
  assert.ok(emails.every(email => world.savedEmails.includes(email)));
  const listed = world.read('leads.search', 'con correo') as { items: Array<{ email: string | null; title: string | null }> };
  assert.ok(emails.every(email => listed.items.some(item => item.email === email)), 'a search «con correo» lists them');
  assert.equal(listed.items[0].title, 'Gerente de Personas', 'with the title the search gave them');
});

test('researches asked in the work finish: the conversation resumes with the notice and the research reads finished, with dated facts', () => {
  const found = simulateSearch({ titles: ['Gerente de Operaciones'], industries: ['minería'], limit: 2 });
  const history: CorpusHistoryTurn[] = [{ request: 'x', reply: 'y', at: AT, observations: [{ action: 'prospecting.search', input: {}, result: found }] }];
  const proposal = { kind: 'lead_prepare_batch', label: 'Preparar 2', prepareBatch: { goal: 'research' as const, people: 2 },
    who: found.items.map(item => ({ providerId: (item as { id: string }).id })) };
  const effect = simulateEffect(proposal, history) as { result: { items: Array<{ id: string; research: string | null }> } };
  history.push({ request: 'z', reply: 'w', at: AT, observations: [], actions: [{ kind: 'lead_prepare_batch', label: 'Preparar 2', outcome: 'ejecutada', result: effect.result }] } as never);
  const before = taskWorld(history).read('research.get_existing', effect.result.items[0].id) as { availability: string };
  assert.equal(before.availability, 'none', 'not finished before the notice');
  const next = nextTurn(task, { request: 'w', at: AT, result: base({ reply: 'Te aviso cuando terminen.' }), observations: [] }, history, 0)!;
  assert.match(next.request!, /^Terminaron las investigaciones que pediste en esta conversación:/);
  history.push(next.turn, { request: next.request!, reply: '', at: AT, observations: [] });
  const after = taskWorld(history).read('research.get_existing', effect.result.items[0].id) as { availability: string; research: { findings: string[] } };
  assert.equal(after.availability, 'available');
  assert.match(after.research.findings[0], /2026/);
});

test('an approved task: its turns carry the task, a delivery with steps left goes on by itself, a «sí» goes on with it and a new request ends it', () => {
  const plan = { goal: 'Campaña para retail', steps: [{ label: 'Buscar prospectos', kind: 'search' }, { label: 'Escribir el correo', kind: 'write' }, { label: 'Crear la campaña pausada', kind: 'campaign' }],
    limits: { searches: 1, credits: 10 } };
  const approved = simulateEffect({ kind: 'task_plan', label: 'Tarea de 3 pasos', task: plan as never }, []) as { result: unknown };
  const history: CorpusHistoryTurn[] = [{ request: task.request, reply: 'Te propongo el plan.', at: AT, observations: [], actions: [{ kind: 'task_plan', label: 'Tarea', outcome: 'ejecutada', result: approved.result }] }];
  const started = activeTask(history, COWORK_CONTINUE_AFTER_PLAN)!;
  assert.equal(started.next!.kind, 'search');
  assert.match(JSON.stringify(started.context), /Estás ejecutando una tarea que el usuario ya aprobó/);
  const found = simulateSearch({ titles: ['Gerente de Personas'], industries: ['retail'], limit: 3 });
  history.push({ request: COWORK_CONTINUE_AFTER_PLAN, reply: 'Busco.', at: AT, observations: [{ action: 'prospecting.search', input: {}, result: found }] });
  const email = { type: 'email_draft', title: 'Correo', to: [], subject: 'Hola', body: 'Texto' } as never;
  const next = nextTurn(task, { request: COWORK_CONTINUE_AFTER_SEARCH, at: AT, result: base({ reply: 'Escribí el correo.', blocks: [email] }), observations: [] }, history, 0)!;
  assert.match(next.request!, /^Continúa la tarea aprobada desde su entrega guardada\. Siguiente paso: Crear la campaña pausada\./, 'the write step was delivered by this turn');
  assert.equal(activeTask([...history, next.turn], 'Sí, adelante.')?.next?.kind, 'campaign', 'a «sí» of the person goes on with the task');
  assert.equal(activeTask([...history, next.turn], 'Busca gerentes de minería en Antofagasta'), null, 'a new request ends it');
  // An answer that asks waits for the person, and their answer goes on with the task; past it, the worker's continuation again.
  const asking = nextTurn(task, { request: COWORK_CONTINUE_AFTER_SEARCH, at: AT, result: base({ reply: 'Escribí el correo. ¿Lo dejo con tono formal?', question: '¿Lo dejo con tono formal?', blocks: [email] }), observations: [] }, history, 0)!;
  assert.equal(asking.request, null, 'the person answers');
  assert.deepEqual(asking.turn.open, { asked: true, offered: [] });
  const answered = activeTask([...history, asking.turn], 'Más cercano, de tú')!;
  assert.equal(answered.next!.kind, 'campaign');
  const after = nextTurn(task, { request: 'Más cercano, de tú', at: AT, result: base({ reply: 'Lo dejé más cercano.', blocks: [email] }), observations: [] }, [...history, asking.turn], 1)!;
  assert.match(after.request!, /^Continúa la tarea aprobada desde su entrega guardada\. Siguiente paso: Crear la campaña pausada\./);
});

test('the task goes on as the worker\'s graph says: a research batch keeps its step running until each research is read finished', () => {
  const plan = { goal: 'Minería', steps: [{ label: 'Buscar gerentes', kind: 'search' }, { label: 'Guardar e investigar', kind: 'prepare' }, { label: 'Escribir a cada uno', kind: 'write' }],
    limits: { searches: 1, credits: 10 } };
  const approved = simulateEffect({ kind: 'task_plan', label: 'Tarea', task: plan as never }, []) as { result: unknown };
  const found = simulateSearch({ titles: ['Gerente de Operaciones'], industries: ['minería'], limit: 2 });
  const history: CorpusHistoryTurn[] = [
    { request: task.request, reply: 'Plan.', at: AT, observations: [], actions: [{ kind: 'task_plan', label: 'Tarea', outcome: 'ejecutada', result: approved.result }] },
    { request: COWORK_CONTINUE_AFTER_PLAN, reply: 'Busco.', at: AT, observations: [{ action: 'prospecting.search', input: {}, result: found }] },
  ];
  const proposal = { kind: 'lead_prepare_batch', label: 'Preparar 2', prepareBatch: { goal: 'research' as const, people: 2 }, who: found.items.map(item => ({ providerId: (item as { id: string }).id })) };
  const effect = simulateEffect(proposal, history) as { result: { items: Array<{ id: string }> } };
  history.push({ request: COWORK_CONTINUE_AFTER_SEARCH, reply: 'Preparo.', at: AT, observations: [], actions: [{ kind: 'lead_prepare_batch', label: 'Preparar 2', outcome: 'ejecutada', result: effect.result }] });
  assert.equal(activeTask(history, COWORK_CONTINUE_AFTER_BATCH)!.graph.find(node => node.kind === 'prepare')!.state, 'running', 'researches still running');
  assert.equal(activeTask(history, COWORK_CONTINUE_AFTER_BATCH)!.next, null, 'nothing to go on with until they finish');
  // The turn after the notice reads both: every read counts, not only the newest the history keeps.
  const reads = effect.result.items.map(item => ({ action: 'research.get_existing', input: item.id, result: taskWorld(history, 'Terminaron las investigaciones que pediste en esta conversación:').read('research.get_existing', item.id) }));
  history.push({ request: 'Terminaron las investigaciones que pediste en esta conversación:', reply: 'Listas.', at: AT, observations: reads.slice(-1), reads });
  const after = activeTask(history, COWORK_CONTINUE_AFTER_EFFECT)!;
  assert.equal(after.graph.find(node => node.kind === 'prepare')!.state, 'succeeded');
  assert.equal(after.next!.kind, 'write');
});

test('the turn that resumes with a research notice already reads those researches finished, by id or by the JSON with it', () => {
  const found = simulateSearch({ titles: ['Gerente de Personas'], industries: ['logística'], limit: 1 });
  const history: CorpusHistoryTurn[] = [{ request: 'x', reply: 'y', at: AT, observations: [{ action: 'prospecting.search', input: {}, result: found }] }];
  const proposal = { kind: 'lead_prepare_batch', label: 'Preparar 1', prepareBatch: { goal: 'research' as const, people: 1 }, who: [{ providerId: (found.items[0] as { id: string }).id }] };
  const effect = simulateEffect(proposal, history) as { result: { items: Array<{ id: string }> } };
  history.push({ request: 'z', reply: 'w', at: AT, observations: [], actions: [{ kind: 'lead_prepare_batch', label: 'Preparar 1', outcome: 'ejecutada', result: effect.result }] });
  const lead = effect.result.items[0].id;
  const notice = 'Terminó la investigación que pediste en esta conversación:\n- Contacto: lista.';
  assert.equal((taskWorld(history, notice).read('research.get_existing', lead) as { availability: string }).availability, 'available');
  assert.equal((taskWorld(history, notice).read('research.get_existing', JSON.stringify({ leadId: lead })) as { availability: string }).availability, 'available');
  assert.equal((taskWorld(history, 'Sí, adelante.').read('research.get_existing', lead) as { availability: string }).availability, 'none');
});

test('what the Writer delivers in a turn marks its write step done in that turn, as onWriteDelivery does in production', () => {
  const plan = { goal: 'Retail', steps: [{ label: 'Buscar', kind: 'search' }, { label: 'Escribir el correo', kind: 'write' }, { label: 'Crear la campaña pausada', kind: 'campaign' }],
    limits: { searches: 1, credits: 0 } };
  const approved = simulateEffect({ kind: 'task_plan', label: 'Tarea', task: plan as never }, []) as { result: unknown };
  const found = simulateSearch({ titles: ['Gerente de Personas'], industries: ['retail'], limit: 3 });
  const history: CorpusHistoryTurn[] = [
    { request: task.request, reply: 'Plan.', at: AT, observations: [], actions: [{ kind: 'task_plan', label: 'Tarea', outcome: 'ejecutada', result: approved.result }] },
    { request: COWORK_CONTINUE_AFTER_PLAN, reply: 'Busco.', at: AT, observations: [{ action: 'prospecting.search', input: {}, result: found }] },
  ];
  const write = (during: unknown[] = []) => activeTask(history, COWORK_CONTINUE_AFTER_SEARCH, during)!.graph.find(node => node.kind === 'write')!.state;
  assert.equal(write(), 'pending');
  const written = base({ writer: { brief: {}, steps: [], blocks: [{ type: 'email_draft', title: 'Correo', to: [], subject: 'Hola', body: 'Texto' } as never] } });
  assert.equal(writtenReads(written).length, 1);
  assert.equal(write(writtenReads(written)), 'succeeded');
  assert.deepEqual(writtenReads(base({})), [], 'no Writer, nothing delivered');
  // A campaign carries its own emails: right after its write step's dependencies, the task approves it either way.
  assert.equal(activeTask(history, COWORK_CONTINUE_AFTER_SEARCH)!.approves('campaign_create', { searches: 0, credits: 0 }), true);
});

test('a task proposed with its «Programar» card is saved by the person, and the work ends there', () => {
  const weekly = COWORK_TASKS.find(item => item.id === 'cada-lunes')!;
  assert.deepEqual(weekly.doneAfter, ['schedule']);
  const schedule = { title: 'Prospectos de logística', prompt: 'Tráeme 5 prospectos nuevos de logística en Santiago para escribirles.', frequency: 'weekly', time: '09:00', weekday: 1 };
  const next = nextTurn(weekly, { request: weekly.request, at: AT, result: base({ reply: 'Te la dejo para programar.', schedule }), observations: [] }, [], 0)!;
  assert.equal(next.request, null);
  assert.equal(next.approved!.kind, 'schedule');
  assert.equal(next.approved!.reply, 'Programada: los lunes a las 09:00.');
  assert.equal(nextTurn(weekly, { request: weekly.request, at: AT, result: base({ reply: 'x', schedule: { ...schedule, weekday: null } }), observations: [] }, [], 0), null,
    'an invalid card is no card: the answer ends the work');
});
