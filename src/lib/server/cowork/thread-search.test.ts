import assert from 'node:assert/strict';
import test from 'node:test';

import { coworkSearchSnippet, searchCoworkThreads } from './thread-search';

const USER = '00000000-0000-4000-8000-000000000001';
const ORG = '00000000-0000-4000-8000-000000000002';

type Row = Record<string, any>;
/** The person's runs and the answers of those runs, with what each read asked for. */
function fake(runs: Row[], answers: Row[]) {
  const asked: Array<{ table: string; filters: string[] }> = [];
  const supabase = {
    from(table: string) {
      const filters: string[] = [];
      asked.push({ table, filters });
      let ids: string[] = [];
      let like = '';
      const builder: any = {
        select: () => builder, order: () => builder, limit: () => builder,
        eq: (column: string, value: string) => { filters.push(`${column}=${value}`); return builder; },
        in: (column: string, values: string[]) => { ids = values; filters.push(`${column} in ${values.length}`); return builder; },
        ilike: (column: string, pattern: string) => { like = pattern; filters.push(`${column} ilike ${pattern}`); return builder; },
        then(resolve: (value: unknown) => void) {
          if (table === 'cowork_runs') return resolve({ data: runs, error: null });
          const needle = like.replace(/^%|%$/g, '').replace(/\\(.)/g, '$1').toLowerCase();
          resolve({ data: answers.filter(row => ids.includes(row.run_id) && String(row.reply).toLowerCase().includes(needle)), error: null });
        },
      };
      return builder;
    },
  };
  return { asked, auth: { supabase, user: { id: USER }, organizationId: ORG } as any };
}

test('a search finds what was asked and what was answered, one line per conversation, newest first (COW-09)', async () => {
  const runs = [
    { id: 'r3', root_run_id: 'c2', message: 'Y ahora escríbeles', created_at: '2026-10-24T12:00:00Z' },
    { id: 'r2', root_run_id: 'c2', message: 'Busca gerentes de retail en Santiago', created_at: '2026-10-24T11:00:00Z' },
    { id: 'r1', root_run_id: 'c1', message: 'Prioridades de esta semana', created_at: '2026-10-23T10:00:00Z' },
    { id: 'h1', root_run_id: 'hidden', message: 'Licitación de aseo para el hospital', created_at: '2026-10-22T10:00:00Z' },
  ];
  const answers = [
    { run_id: 'r1', reply: 'Esta semana conviene escribir a Andrea Soto: pidió una reunión para hablar del hospital regional.' },
    { run_id: 'r3', reply: 'Listo, preparé tres correos.' },
  ];
  const { auth, asked } = fake(runs, answers);
  assert.deepEqual(await searchCoworkThreads(auth, '  Hospital ', { hiddenRootIds: ['hidden'] }), [
    { rootId: 'c1', snippet: '…Andrea Soto: pidió una reunión para hablar del hospital regional.' },
  ], 'the answer of c1 says it; the deleted conversation does not count');
  assert.deepEqual((await searchCoworkThreads(auth, 'retail')).map(match => match.rootId), ['c2'], 'what was asked counts too');
  assert.ok(asked.some(read => read.table === 'cowork_run_events' && read.filters.includes('kind=run.completed') && read.filters.includes(`user_id=${USER}`)));
  assert.deepEqual(await searchCoworkThreads(auth, 'ho'), [], 'two letters are not a search');
  // A percent sign is looked for as written, not as «anything».
  await searchCoworkThreads(auth, '100%');
  assert.ok(asked.some(read => read.filters.includes('payload->>reply ilike %100\\%%')));
});

test('the snippet shows the words around what was found', () => {
  assert.equal(coworkSearchSnippet('Corto y claro', 'claro'), 'Corto y claro');
  assert.equal(coworkSearchSnippet(`${'a '.repeat(60)}palabra${' b'.repeat(60)}`, 'palabra', 10), '…a a a a a palabra b b b b b…');
});
