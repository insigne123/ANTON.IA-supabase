import assert from 'node:assert/strict';
import test from 'node:test';
import { runCoworkReadLoop } from './agent-loop';
import { coworkDecisionContext } from './decision-context';
import { coworkAgentInstructions } from './agent-instructions';
import {
  coworkBranch, coworkEarlierEmails, coworkEarlierTurns, coworkRecallArchive, coworkRecallCards, coworkSearchCriteria, coworkThreadRecallContext,
  coworkThreadSearches, coworkWithRecallArchive, type CoworkRecallRun, type CoworkRecallTurnInput,
} from './thread-recall';

// Every name here is made up: the conversation is the shape of the one of 29 Oct, not its people.
const run = (id: string, parentId: string | null, message: string, extra: Partial<CoworkRecallRun> = {}): CoworkRecallRun =>
  ({ id, parentId, message, status: 'completed', createdAt: `2026-10-29T13:${String(10 + Number(id.slice(1))).padStart(2, '0')}:00Z`, depth: 0, ...extra });
const person = (n: number, company: string) => ({ id: `apollo:p${n}`, name: `Persona ${n}`, title: 'Jefe de Operaciones', company, location: 'Concepción, Chile',
  fit: 'Cargo de operaciones en una empresa del rubro' });
const search = (people: ReturnType<typeof person>[], input: unknown = { target: 'people', titles: ['Jefe de Operaciones'], locations: ['Concepción, Chile'], limit: 100 }) =>
  ({ action: 'prospecting.search', input, result: { scope: 'external_search', items: people, truncated: true } });
const firstSearch = search([person(1, 'Constructora Norte'), person(2, 'Logística Sur'), person(3, 'Retail Uno'), person(4, 'Agro Dos')]);
const secondSearch = search([person(11, 'Celulosa del Pacífico'), person(12, 'Celulosa del Pacífico'), person(13, 'Celulosa del Pacífico'),
  person(14, 'Forestal Los Robles'), person(15, 'Forestal Los Robles')], { target: 'people', titles: ['Gerente de Compras'], industries: ['forestal', 'química'] });

test('the branch runs from the first message to the turn, without other versions, missing runs or loops', () => {
  const runs = [run('r1', null, 'Hola'), run('r2', 'r1', 'Busca'), run('r3', 'r2', 'Otra versión', { status: 'cancelled' }), run('r4', 'r2', 'Sigue')];
  assert.deepEqual(coworkBranch(runs, 'r4').map(item => item.id), ['r1', 'r2', 'r4']);
  // A run older than what was read ends the branch there.
  assert.deepEqual(coworkBranch(runs.filter(item => item.id !== 'r1'), 'r4').map(item => item.id), ['r2', 'r4']);
  assert.deepEqual(coworkBranch(runs, null), []);
  assert.deepEqual(coworkBranch([run('a', 'b', 'x'), run('b', 'a', 'y')], 'a').map(item => item.id), ['b', 'a']);
});

test('every search of the conversation is numbered in order, with its people, their ids and who is saved now', () => {
  const searches = coworkThreadSearches([
    { runId: 'r2', at: '2026-10-29T13:18:00Z', asked: 'prefiero que igual sean 100 contactos', payload: firstSearch },
    { runId: 'r2', at: '2026-10-29T13:18:00Z', asked: 'prefiero que igual sean 100 contactos', payload: { action: 'leads.search', result: { items: [] } } },
    { runId: 'r4', at: '2026-10-29T13:22:00Z', asked: 'empresas forestales o químicas', payload: secondSearch },
  ], { saved: new Map([['apollo:p11', '00000000-0000-4000-8000-000000000011']]) });
  assert.deepEqual(searches.map(item => [item.n, item.runId, item.found]), [[1, 'r2', 4], [2, 'r4', 5]]);
  assert.equal(searches[1].asked, 'empresas forestales o químicas');
  assert.equal(searches[1].criteria, 'titles: Gerente de Compras · industries: forestal, química');
  assert.deepEqual(searches[1].people[0], { id: 'apollo:p11', name: 'Persona 11', title: 'Jefe de Operaciones', company: 'Celulosa del Pacífico',
    location: 'Concepción, Chile', fit: 'Cargo de operaciones en una empresa del rubro', savedLeadId: '00000000-0000-4000-8000-000000000011' });
  assert.equal(searches[1].people[1].savedLeadId, undefined);
  // A search of companies is numbered with the others.
  const companies = coworkThreadSearches([{ runId: 'r9', at: null, asked: 'empresas', payload: { action: 'prospecting.search', input: 'forestales',
    result: { scope: 'external_company_search', items: [{ id: 'apollo-company:c1', company: 'Forestal Los Robles', website: 'https://robles.example' }] } } }]);
  assert.deepEqual([companies[0].kind, companies[0].criteria, companies[0].people[0].id], ['empresas', 'forestales', 'apollo-company:c1']);
});

test('within the budget, the searches history also shows lose their list first, then the longest lists are cut and say how many', () => {
  const many = (from: number) => search(Array.from({ length: 60 }, (_, index) => person(from + index, `Empresa ${from + index}`)));
  const entries = [
    { runId: 'old', at: null, asked: 'la primera', payload: many(100) },
    { runId: 'recent', at: null, asked: 'la última', payload: many(200) },
  ];
  const all = coworkThreadSearches(entries, { inHistory: new Set(['recent']) });
  assert.equal(all[0].people.length, 60);
  assert.equal(all[1].inHistory, true);
  const tight = coworkThreadSearches(entries, { inHistory: new Set(['recent']), budget: 8_000 });
  assert.deepEqual([tight[1].people.length, tight[1].peopleOmitted], [0, 60]);
  assert.ok(tight[0].people.length > 0 && tight[0].people.length < 60);
  assert.equal(tight[0].people.length + (tight[0].peopleOmitted ?? 0), 60);
  assert.deepEqual(tight[0].people[0].id, 'apollo:p100');
  assert.ok(JSON.stringify(tight).length <= 8_000);
});

test('the earlier turns read in a line or two, automatic steps without their internal message, and fit their budget', () => {
  const turn = (n: number, extra: Partial<CoworkRecallTurnInput> = {}): CoworkRecallTurnInput => ({ runId: `r${n}`, at: `2026-10-29T13:${10 + n}:00Z`,
    message: `Pedido ${n} `.repeat(60), automatic: false, status: 'completed', reply: `Respuesta ${n} `.repeat(80), document: null,
    blocks: [{ type: 'email_draft', title: `Correo ${n}`, subject: 'Hola', body: 'Texto' }], actions: ['Guardar contacto Persona 1 (ejecutada)'], searches: [], ...extra });
  const { turns, omitted } = coworkEarlierTurns([turn(1), turn(2, { automatic: true, message: 'Continúa a partir del resultado de búsqueda…', searches: [2] })]);
  assert.equal(omitted, 0);
  assert.ok(turns[0].request!.length <= 300 && turns[0].reply!.length <= 500);
  assert.deepEqual(turns[0].cards, ['Correo: Correo 1']);
  assert.deepEqual([turns[1].automatic, 'request' in turns[1], turns[1].searches], [true, false, [2]]);
  // Too many for the budget: shorter first, then the oldest after the first go.
  const long = coworkEarlierTurns(Array.from({ length: 80 }, (_, index) => turn(index + 1)), 12_000);
  assert.ok(JSON.stringify(long.turns).length <= 12_000);
  assert.ok(long.omitted > 0);
  assert.equal(long.turns[0].at, '2026-10-29T13:11:00Z');
  assert.equal(long.turns.length + long.omitted, 80);
  assert.ok(long.turns[1].reply!.length <= 160);
});

test('the emails written before history come back in their latest version, newest first, without the ones history shows', () => {
  const email = (title: string, body: string) => ({ type: 'email_draft', title, to: null, subject: `Asunto de ${title}`, body });
  const emails = coworkEarlierEmails([
    { at: '2026-10-29T13:29:00Z', blocks: [email('Correo para operaciones', 'Primera versión')] },
    { at: '2026-10-29T13:31:00Z', blocks: [email('Correo para operaciones', 'Segunda versión'), { type: 'table', title: 'Personas' }] },
    { at: '2026-10-29T13:34:00Z', blocks: [{ type: 'sequence', title: 'Seguimientos', steps: [{ day: 3, subject: 'Re: hola', body: 'Te escribo de nuevo' }] }] },
    { at: '2026-10-29T13:40:00Z', blocks: [email('Correo corto', 'Visto en history')] },
  ], new Set(['Correo corto']));
  assert.deepEqual(emails.map(item => item.title), ['Seguimientos', 'Correo para operaciones']);
  assert.equal(emails[1].body, 'Segunda versión');
  assert.deepEqual(emails[0].steps, [{ day: 3, subject: 'Re: hola', body: 'Te escribo de nuevo' }]);
  assert.deepEqual(coworkRecallCards([email('Correo corto', 'x'), { type: 'metrics', title: 'Semana' }, { type: 'chart' }]), ['Correo: Correo corto', 'Cifras: Semana', 'Gráfico']);
  assert.equal(coworkSearchCriteria(null), null);
});

test('the recall travels in the decision context with its instruction and its local times, and not at all when it is empty', () => {
  assert.equal(coworkThreadRecallContext({ earlierTurns: [], earlierTurnsOmitted: 0, searches: [] }), null);
  const recall = coworkThreadRecallContext({ earlierTurns: [{ at: '2026-10-29T13:22:00Z', request: 'Busca forestales', reply: 'Encontré 5.' }], earlierTurnsOmitted: 2,
    searches: coworkThreadSearches([{ runId: 'r4', at: '2026-10-29T13:22:00Z', asked: 'forestales', payload: secondSearch }]) })!;
  assert.match(recall.instruction, /la segunda búsqueda/);
  assert.match(recall.instruction, /nunca digas que no tienes algo que está aquí/);
  assert.equal(recall.earlierTurnsOmitted, 2);
  const context = coworkDecisionContext(coworkAgentInstructions({ externalSearch: true, automaticExternalSearch: false }), {
    history: { turns: [], olderTurnsOmitted: true }, threadRecall: recall, request: 'guarda las 5 personas de la segunda búsqueda', observations: [],
    mustAnswer: false, executionPolicy: null,
  }, new Date('2026-10-29T19:07:00Z'), 'America/Santiago') as unknown as { threadRecall: { searches: Array<{ atLocal?: string }>; earlierTurns: Array<{ atLocal?: string }> } };
  assert.equal(context.threadRecall.searches[0].atLocal, '29 oct 2026, 10:22');
  assert.equal(context.threadRecall.earlierTurns[0].atLocal, '29 oct 2026, 10:22');
});

test('«guarda las 5 personas de la segunda búsqueda», ten turns later: the people of that search can be prepared and saved again', async () => {
  // The turns history carries: writing and editing the email, none of them with the search.
  const recent = Array.from({ length: 8 }, (_, index) => ({ runId: `recent-${index}`, observations: [], reply: 'Ajusté el correo.' }));
  const archive = coworkRecallArchive([
    { runId: 'search-1', at: null, asked: '100 contactos', payload: firstSearch },
    { runId: 'search-2', at: null, asked: 'forestales', payload: secondSearch },
  ]);
  assert.deepEqual(archive.map(turn => turn.runId), ['search-1', 'search-2']);
  const history = coworkWithRecallArchive(archive, recent);
  // The last turn is still the last one: what a «sí» answers.
  assert.equal(history.at(-1), recent.at(-1));
  const proposals: Array<Record<string, unknown>> = [];
  const base = { message: 'Sí, guarda las 5 personas de la segunda búsqueda y busca sus correos', runId: 'now', signal: new AbortController().signal,
    authorize: async () => {}, record: async () => {}, execute: async () => ({}), prepareBatch: true,
    proposeEffect: async (proposal: Record<string, unknown>) => { proposals.push(proposal); } };
  const people = { goal: 'email', people: secondSearch.result.items.map(item => ({ providerId: item.id })) };
  const prepare = { action: 'contacts.prepare_batch' as const, query: null, leadId: null, answer: null, prepareBatch: people };
  // Before: only the recent turns, and nobody of that search could be proposed.
  await assert.rejects(runCoworkReadLoop({ ...base, history: recent, decide: async () => prepare as never }), /observed first/);
  await runCoworkReadLoop({ ...base, history, decide: async () => prepare as never });
  assert.deepEqual(proposals[0], { kind: 'lead_prepare_batch', targetId: 'new-prepare-batch', label: 'Preparar contactos', originRunId: 'search-1', prepareBatch: people });
  // Saving one of them is anchored to the run that found them: saving reads that run again.
  await runCoworkReadLoop({ ...base, history, decide: async () => ({ action: 'leads.save_contact', query: null, leadId: null, providerId: 'apollo:p14', answer: null }) as never });
  assert.equal(proposals[1].kind, 'save_contact');
  assert.equal(proposals[1].originRunId, 'search-2');
  assert.equal(proposals[1].targetId, 'apollo:p14');
});
