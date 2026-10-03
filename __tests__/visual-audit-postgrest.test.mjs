import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, handleRest, parseSelect, parseOrder, getPath, splitTopLevel } from '../scripts/visual-audit/fake-supabase/postgrest.mjs';

// The visual audit's PostgREST stand-in answers what supabase-js sends; these cases are the query shapes the app uses.
const rows = {
  leads: [
    { id: 'a', organization_id: 'o1', user_id: 'u1', full_name: 'Ana Rojas', email: 'ana@acme.cl', score: 7, created_at: '2026-10-01T10:00:00Z', data: { source: 'linkedin', tags: ['vip'] }, archived: false },
    { id: 'b', organization_id: 'o1', user_id: 'u2', full_name: 'Luis Soto', email: null, score: 3, created_at: '2026-10-02T10:00:00Z', data: { source: 'csv' }, archived: true },
    { id: 'c', organization_id: 'o2', user_id: 'u1', full_name: 'Carla, Mena', email: 'carla@x.cl', score: 10, created_at: '2026-09-30T10:00:00Z', data: null, archived: false },
  ],
  profiles: [{ id: 'u1', full_name: 'Dueña QA' }, { id: 'u2', full_name: 'Miembro QA' }],
};
// supabase-js appends each parameter (so `%` travels encoded); pairs keep the raw text the same way.
const params = query => new URLSearchParams(query.split('&').filter(Boolean).map(part => { const at = part.indexOf('='); return [part.slice(0, at), part.slice(at + 1)]; }));
const get = (query, extra = {}) => handleRest({ store: createStore(rows), method: 'GET', table: 'leads', search: params(query), ...extra });

test('column filters, JSON paths, is, in with quoted values and the not. prefix', () => {
  assert.deepEqual(get('organization_id=eq.o1').body.map(row => row.id), ['a', 'b']);
  assert.deepEqual(get('email=is.null').body.map(row => row.id), ['b']);
  assert.deepEqual(get('email=not.is.null').body.map(row => row.id), ['a', 'c']);
  assert.deepEqual(get('data->>source=eq.linkedin').body.map(row => row.id), ['a']);
  assert.deepEqual(get('full_name=in.("Carla, Mena",Ana Rojas)').body.map(row => row.id), ['a', 'c']);
  assert.deepEqual(get('score=gte.7&archived=is.false').body.map(row => row.id), ['a', 'c']);
  assert.deepEqual(get('full_name=ilike.*rojas*').body.map(row => row.id), ['a']);
  assert.deepEqual(get('data=cs.{"tags":["vip"]}').body.map(row => row.id), ['a']);
});

test('or groups with nested and, quoted values and filters on JSON paths', () => {
  assert.deepEqual(get('or=(email.ilike."%acme.cl",and(score.lt.5,archived.is.true))').body.map(row => row.id), ['a', 'b']);
  assert.deepEqual(get('organization_id=eq.o1&or=(data->>source.eq.csv,full_name.eq.Ana Rojas)').body.map(row => row.id), ['a', 'b']);
});

test('order with nulls placement, limit and offset, Range and exact counts on GET and HEAD', () => {
  assert.deepEqual(get('order=created_at.desc').body.map(row => row.id), ['b', 'a', 'c']);
  assert.deepEqual(get('order=email.asc.nullsfirst').body.map(row => row.id), ['b', 'a', 'c']);
  const page = get('order=score.desc&offset=1&limit=1', { prefer: 'count=exact' });
  assert.deepEqual(page.body.map(row => row.id), ['a']);
  assert.equal(page.headers['content-range'], '1-1/3');
  const head = handleRest({ store: createStore(rows), method: 'HEAD', table: 'leads', search: new URLSearchParams('organization_id=eq.o1'), prefer: 'count=exact' });
  assert.equal(head.body, undefined);
  assert.equal(head.headers['content-range'], '0-1/2');
  assert.deepEqual(get('order=score.asc', { range: '0-1' }).body.map(row => row.id), ['b', 'a']);
});

test('single objects, aliases and embedded profiles', () => {
  assert.equal(get('id=eq.a', { accept: 'application/vnd.pgrst.object+json' }).body.full_name, 'Ana Rojas');
  assert.equal(get('id=eq.zzz', { accept: 'application/vnd.pgrst.object+json' }).status, 406);
  const embedded = get('select=id,source:data->>source,profiles(full_name)&id=eq.a').body[0];
  assert.equal(embedded.source, 'linkedin');
  assert.deepEqual(embedded.profiles, { id: 'u1', full_name: 'Dueña QA', ...{} });
  const aliased = get('select=id,owner:user_id(full_name)&id=eq.b').body[0];
  assert.equal(aliased.owner.full_name, 'Miembro QA');
});

test('insert, upsert, update and delete change only the in-memory store', () => {
  const store = createStore(rows);
  const insert = handleRest({ store, method: 'POST', table: 'leads', search: new URLSearchParams('select=*'), body: [{ full_name: 'Nueva' }], prefer: 'return=representation' });
  assert.equal(insert.status, 201);
  assert.ok(insert.body[0].id);
  handleRest({ store, method: 'POST', table: 'leads', search: new URLSearchParams('on_conflict=id'), body: { id: 'a', score: 9 }, prefer: 'resolution=merge-duplicates' });
  assert.equal(store.tables.leads.find(row => row.id === 'a').score, 9);
  const patch = handleRest({ store, method: 'PATCH', table: 'leads', search: new URLSearchParams('id=eq.b'), body: { archived: false }, prefer: 'return=representation' });
  assert.equal(patch.body[0].archived, false);
  handleRest({ store, method: 'DELETE', table: 'leads', search: new URLSearchParams('organization_id=eq.o2') });
  assert.deepEqual(store.tables.leads.map(row => row.id).sort(), ['a', 'b', insert.body[0].id].sort());
  assert.equal(rows.leads.length, 3, 'the fixtures stay as they were');
});

test('helpers: select, order and JSON path parsing; unknown tables are logged and empty', () => {
  assert.deepEqual(parseSelect('id,owner:user_id(full_name),n:data->>x').map(item => item.kind), ['column', 'embed', 'alias']);
  assert.deepEqual(parseOrder('a.desc.nullslast,b->>c'), [{ column: 'a', ascending: false, nulls: 'last' }, { column: 'b->>c', ascending: true, nulls: 'last' }]);
  assert.equal(getPath({ data: '{"a":{"b":1}}' }, 'data->a->>b'), 1);
  assert.deepEqual(splitTopLevel('a.eq.1,and(b.eq.2,c.eq.3),d.in.(1,2)'), ['a.eq.1', 'and(b.eq.2,c.eq.3)', 'd.in.(1,2)']);
  const store = createStore({});
  const result = handleRest({ store, method: 'GET', table: 'nope', search: new URLSearchParams() });
  assert.deepEqual(result.body, []);
  assert.deepEqual(store.log[0], { kind: 'table-unfixtured', table: 'nope', method: 'GET' });
});
