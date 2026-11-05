import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { coworkBranchRunIds, loadCoworkThreadRecall } from './thread-recall';

type Row = Record<string, unknown>;

/** A value at a PostgREST path: «payload», «payload->blocks», «payload->>action», «payload->document->>title». */
function at(row: Row, path: string): unknown {
  const keys = path.split(/->>?/);
  const ops = path.match(/->>?/g) || [];
  let value: unknown = row[keys[0]];
  for (let index = 1; index < keys.length; index++) {
    value = value && typeof value === 'object' ? (value as Row)[keys[index]] : undefined;
    if (ops[index - 1] === '->>' && value !== undefined && value !== null && typeof value !== 'string') value = typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return value ?? null;
}

/** An in-memory database that answers the reads this module makes, and keeps every filter to check the scope. */
function database(tables: Record<string, Row[]>) {
  const reads: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const client = { from(table: string) {
    let rows = [...(tables[table] || [])];
    let fields = '*';
    const filters: Record<string, unknown> = {};
    reads.push({ table, filters });
    let order: { column: string; ascending: boolean } | null = null;
    let limit = Infinity;
    const project = (row: Row) => fields === '*' ? row : Object.fromEntries(fields.split(',').map(field => {
      const [alias, path] = field.includes(':') ? field.split(':') : [field, field];
      return [alias, at(row, path)];
    }));
    const result = () => {
      const sorted = order ? [...rows].sort((a, b) => (String(at(a, order!.column)) < String(at(b, order!.column)) ? -1 : 1) * (order!.ascending ? 1 : -1)) : rows;
      return sorted.slice(0, limit).map(project);
    };
    const chain = {
      select(value: string) { fields = value; return chain; },
      eq(column: string, value: unknown) { filters[column] = value; rows = rows.filter(row => at(row, column) === value); return chain; },
      in(column: string, values: unknown[]) { filters[column] = values; rows = rows.filter(row => values.includes(at(row, column))); return chain; },
      order(column: string, options?: { ascending?: boolean }) { order = { column, ascending: options?.ascending !== false }; return chain; },
      limit(count: number) { limit = count; return chain; },
      async maybeSingle() { return { data: result()[0] ?? null, error: null }; },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) { return Promise.resolve({ data: result(), error: null }).then(resolve, reject); },
    };
    return chain;
  } } as unknown as SupabaseClient;
  return { client, reads };
}

// The shape of the conversation of 29 Oct with made-up people: two searches, an email written and edited for eight turns, a version
// left aside, and «Sí, guarda las 5 personas de la segunda búsqueda» at the end.
const scope = { userId: 'user-1', organizationId: 'org-1' };
const own = { user_id: scope.userId, organization_id: scope.organizationId };
const turns: Array<[id: string, parent: string | null, message: string, extra?: Row]> = [
  ['r01', null, 'Haz un recorrido para prospectar empresas en Concepción y el Biobío'],
  ['r02', 'r01', 'prefiero que igual sean 100 contactos'],
  ['r03', 'r02', 'Continúa a partir del resultado de búsqueda completado del trabajo anterior', { depth: 1 }],
  ['r04', 'r03', 'que tal empresas forestales o químicas, vuelve a intentar'],
  ['r05', 'r04', 'Continúa a partir del resultado de búsqueda completado del trabajo anterior', { depth: 1 }],
  ['r06', 'r05', 'Consulta la ficha de este contacto guardado'],
  ['r07', 'r06', 'Continúa a partir del efecto recién ejecutado', { depth: 1 }],
  ['r08', 'r07', 'diseñemos un correo para prospectar'],
  ['r09', 'r08', 'preséntame primero'],
  ['r10', 'r09', 'se más estratégico'],
  ['r11', 'r10', 'muy largo, más resumido'],
  ['r12', 'r11', 'Usa exactamente esta versión', { status: 'cancelled' }],
  ['r13', 'r11', 'que las últimas líneas sean agendar una reunión'],
  ['r14', 'r13', 'vuelve a mostrarme el correo'],
  ['r15', 'r14', 'cambia peaks por altas demandas'],
  ['r16', 'r15', 'Sí, guarda las 5 personas de la segunda búsqueda y busca sus correos', { status: 'running' }],
];
const runs = turns.map(([id, parent, message, extra], index) => ({ id, parent_run_id: parent, root_run_id: 'r01', message, status: 'completed', depth: 0,
  created_at: `2026-10-29T13:${String(10 + index).padStart(2, '0')}:00Z`, ...own, ...extra }));
const person = (n: number, company: string) => ({ id: `apollo:p${n}`, name: `Persona ${n}`, title: 'Jefe de Operaciones', company, status: 'No guardado', email: null });
const searchEvent = (runId: string, sequence: number, items: unknown[]) => ({ run_id: runId, sequence, kind: 'tool.completed', ...own,
  payload: { action: 'prospecting.search', input: { target: 'people', titles: ['Jefe de Operaciones'], locations: ['Concepción, Chile'], limit: 100 },
    result: { scope: 'external_search', items, truncated: true } } });
const completed = (runId: string, sequence: number, reply: string, blocks: unknown[] = []) => ({ run_id: runId, sequence, kind: 'run.completed', ...own,
  payload: { reply, document: null, blocks, telemetry: [] } });
const events = [
  searchEvent('r02', 1, [person(1, 'Constructora Norte'), person(2, 'Logística Sur'), person(3, 'Retail Uno'), person(4, 'Agro Dos')]),
  completed('r02', 2, 'Búsqueda terminada.'),
  completed('r03', 3, 'La búsqueda trajo solo 4 personas.'),
  { run_id: 'r04', sequence: 4, kind: 'tool.completed', ...own, payload: { action: 'assistant.note', input: '', result: { reply: 'Propongo buscar.' } } },
  searchEvent('r04', 5, [person(11, 'Celulosa del Pacífico'), person(12, 'Celulosa del Pacífico'), person(13, 'Celulosa del Pacífico'),
    person(14, 'Forestal Los Robles'), person(15, 'Forestal Los Robles')]),
  completed('r04', 6, 'Búsqueda terminada.'),
  completed('r05', 7, 'La segunda búsqueda trajo 5 personas, en Celulosa del Pacífico y Forestal Los Robles.'),
  { run_id: 'r05', sequence: 8, kind: 'contact.saved', ...own, payload: { leadId: 'lead-11', providerId: 'apollo:p11', name: 'Persona 11', company: 'Celulosa del Pacífico' } },
  completed('r06', 9, 'Encontramos su correo.'),
  { run_id: 'r06', sequence: 10, kind: 'effect.completed', ...own, payload: { kind: 'enrich_contact', label: 'Buscar el correo de Persona 11', result: { found: true } } },
  completed('r07', 11, 'Propuesta descartada.'),
  completed('r08', 12, 'Preparé una plantilla.', [{ type: 'email_draft', title: 'Correo para operaciones', to: null, subject: 'Hola', body: 'Primera versión' }]),
  completed('r15', 13, 'Hecho.', [{ type: 'email_draft', title: 'Correo para operaciones', to: null, subject: 'Hola', body: 'Última versión' }]),
  // Another person's conversation is never read.
  { ...searchEvent('r04', 14, [person(99, 'Ajena')]), user_id: 'someone-else' },
];
const leads = [{ id: 'lead-11', apollo_id: 'p11', source_provider_id: 'p11', created_at: '2026-10-29T13:26:00Z', ...own }];

test('the whole conversation behind a turn: its searches numbered with their people, the earlier turns condensed, and the branch', async () => {
  const { client, reads } = database({ cowork_runs: runs, cowork_run_events: events, leads });
  const history = ['r07', 'r08', 'r09', 'r10', 'r11', 'r13', 'r14', 'r15'];
  const recall = await loadCoworkThreadRecall(client, scope, { id: 'r16', root_run_id: 'r01', parent_run_id: 'r15' },
    { runIds: history, emailTitles: ['Correo para operaciones'] });
  assert.ok(recall?.context);
  const searches = recall.context.searches!;
  assert.deepEqual(searches.map(search => [search.n, search.runId, search.found, search.asked]),
    [[1, 'r02', 4, 'prefiero que igual sean 100 contactos'], [2, 'r04', 5, 'que tal empresas forestales o químicas, vuelve a intentar']]);
  assert.deepEqual(searches[1].people.map(item => item.id), ['apollo:p11', 'apollo:p12', 'apollo:p13', 'apollo:p14', 'apollo:p15']);
  // Who is saved now, not the «No guardado» of the day of the search.
  assert.equal(searches[1].people[0].savedLeadId, 'lead-11');
  assert.equal(searches[1].people[1].savedLeadId, undefined);
  assert.equal(searches[1].criteria, 'titles: Jefe de Operaciones · locations: Concepción, Chile');
  // The turns before history, in order, with what was done; the automatic steps without their internal message.
  const earlier = recall.context.earlierTurns!;
  assert.deepEqual(earlier.map(turn => turn.request ?? (turn.automatic ? 'auto' : null)),
    ['Haz un recorrido para prospectar empresas en Concepción y el Biobío', 'prefiero que igual sean 100 contactos', 'auto',
      'que tal empresas forestales o químicas, vuelve a intentar', 'auto', 'Consulta la ficha de este contacto guardado']);
  assert.deepEqual(earlier[1].searches, [1]);
  assert.deepEqual(earlier[3].searches, [2]);
  assert.equal(earlier[4].reply, 'La segunda búsqueda trajo 5 personas, en Celulosa del Pacífico y Forestal Los Robles.');
  assert.deepEqual(earlier[4].actions, ['Guardaste desde el panel a Persona 11 · Celulosa del Pacífico']);
  assert.deepEqual(earlier[5].actions, ['Buscar el correo de Persona 11 (ejecutada)']);
  // The email history shows is not repeated.
  assert.equal(recall.context.emails, undefined);
  // The checks of a proposal read both searches; the branch reaches the first message and leaves the other version out.
  assert.deepEqual(recall.archive.map(turn => turn.runId), ['r02', 'r04']);
  assert.equal((recall.archive[1].observations[0] as { result: { items: unknown[] } }).result.items.length, 5);
  assert.deepEqual(recall.branch, { runIds: ['r15', 'r14', 'r13', 'r11', 'r10', 'r09', 'r08', 'r07', 'r06', 'r05', 'r04', 'r03', 'r02', 'r01'], complete: true });
  // Every read is the person's own, in their organization.
  assert.ok(reads.every(read => read.filters.user_id === scope.userId && read.filters.organization_id === scope.organizationId));
});

test('the first turn has nothing behind it, and a batch checks its people against the whole branch, newest first', async () => {
  const { client } = database({ cowork_runs: runs, cowork_run_events: events, leads });
  assert.equal(await loadCoworkThreadRecall(client, scope, { id: 'r01', root_run_id: 'r01', parent_run_id: null }, { runIds: [] }), null);
  const ids = await coworkBranchRunIds(client, scope, 'r16');
  assert.deepEqual(ids, ['r16', 'r15', 'r14', 'r13', 'r11', 'r10', 'r09', 'r08', 'r07', 'r06', 'r05', 'r04', 'r03', 'r02', 'r01']);
  // A run of someone else is not found.
  await assert.rejects(coworkBranchRunIds(client, { ...scope, userId: 'someone-else' }, 'r16'), /unavailable/);
});

test('earlier emails come back when history no longer shows them', async () => {
  const { client } = database({ cowork_runs: runs, cowork_run_events: events, leads });
  const recall = await loadCoworkThreadRecall(client, scope, { id: 'r16', root_run_id: 'r01', parent_run_id: 'r15' },
    { runIds: ['r13', 'r14', 'r15'], emailTitles: [] });
  assert.deepEqual(recall?.context?.emails?.map(email => [email.title, email.body]), [['Correo para operaciones', 'Primera versión']]);
});
