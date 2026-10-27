import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_CONTINUE_AFTER_BATCH, COWORK_CONTINUE_AFTER_PLAN, COWORK_CONTINUE_AFTER_SEARCH } from '../src/lib/cowork/continuation-messages';
import type { CorpusHistoryTurn, CorpusTurnResult } from './fixtures/cowork-conversation-corpus';
import { activeTask, COWORK_TASKS, nextTurn, simulateEffect, simulateSearch, taskWorld } from './fixtures/cowork-task-corpus';

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

test('a batch is played on the people it names: two of every three get an email, the rest say why not', () => {
  const found = simulateSearch({ titles: ['Gerente de Personas'], industries: ['retail'], limit: 3 });
  const history = [{ request: 'x', reply: 'y', at: AT, observations: [{ action: 'prospecting.search', input: {}, result: found }] }];
  const proposal = { kind: 'lead_prepare_batch', label: 'Preparar 3', prepareBatch: { goal: 'email' as const, people: 3 },
    who: found.items.map(item => ({ providerId: (item as { id: string }).id })) };
  const effect = simulateEffect(proposal, history) as { reply: string; result: { items: Array<{ name: string; email: string | null; status: string }> } };
  assert.deepEqual(effect.result.items.map(item => item.name), found.items.map(item => (item as { name: string }).name), 'the same people, by name');
  assert.deepEqual(effect.result.items.map(item => Boolean(item.email)), [true, true, false]);
  assert.deepEqual(effect.result.items.map(item => item.status), ['ready', 'ready', 'partial']);
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
