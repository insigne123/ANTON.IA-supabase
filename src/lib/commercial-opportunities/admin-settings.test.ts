import assert from 'node:assert/strict';
import test from 'node:test';
import { buyerSearch, isSearch, matchesSearch, readAdminSettings, ruleFor, ruleGroups, ruleLabel, sameSearch, searchHref, searchName, type AssignmentRule } from './admin-settings';

const DIEGO = '00000000-0000-4000-8000-000000000001', MARIA = '00000000-0000-4000-8000-000000000002', GONE = '00000000-0000-4000-8000-000000000009';
const rule = (id: string, userId: string, category: AssignmentRule['category'], minAmount: number | null = null): AssignmentRule => ({ id, userId, category, minAmount });

test('what is saved is read item by item: a rule or a search that no longer reads is passed over, never an error', () => {
  assert.deepEqual(readAdminSettings(null), { rules: [], searches: [] });
  assert.deepEqual(readAdminSettings({ rules: 'no' }), { rules: [], searches: [] });
  const read = readAdminSettings({ rules: [rule('a', DIEGO, 'seguridad'), { id: 'b', userId: MARIA, category: 'jardineria', minAmount: null }],
    searches: [{ id: 's', name: 'Seguridad', filter: 'recommended', source: 'tender', query: '', categories: ['seguridad'], notify: [DIEGO], createdBy: DIEGO }, { id: 't' }] });
  assert.deepEqual(read.rules.map(item => item.id), ['a'], 'a line of service that left is passed over');
  assert.deepEqual(read.searches.map(item => item.id), ['s']);
});

test('the first rule an opportunity meets gives it to someone; an amount in pesos at least the minimum, never one not said or in UF', () => {
  const members = new Set([DIEGO, MARIA]);
  const rules = [rule('big', MARIA, 'seguridad', 50_000_000), rule('guards', DIEGO, 'seguridad'), rule('gone', GONE, null)];
  const guards = { title: 'Servicio de guardias para 12 sucursales' };
  assert.equal(ruleFor({ ...guards, amount: 80_000_000, currency: 'CLP' }, rules, members)?.userId, MARIA);
  assert.equal(ruleFor({ ...guards, amount: 8_000_000, currency: 'CLP' }, rules, members)?.userId, DIEGO, 'under the minimum: the next rule');
  assert.equal(ruleFor({ ...guards, amount: 3_000, currency: 'UF' }, rules, members)?.userId, DIEGO, 'another currency never meets a minimum in pesos');
  assert.equal(ruleFor({ title: 'Compra de resmas de papel' }, rules, members), null, 'a rule for someone who left is passed over');
  assert.equal(ruleFor({ title: 'Compra de resmas de papel' }, [rule('all', DIEGO, null)], members)?.id, 'all', 'a rule with no line of service takes everything');
  assert.equal(ruleLabel(rules[0], 'María'), 'Seguridad desde $50\u00a0M → María', 'the amount never breaks from its unit');
  assert.equal(ruleLabel(rule('x', DIEGO, null), 'Diego'), 'Todas → Diego');
});

test('«Asignarlas» groups what each rule gives by person, in the order of the rules', () => {
  const members = [{ user_id: DIEGO, name: 'Diego Soto' }, { user_id: MARIA, name: 'María Paz' }];
  const groups = ruleGroups([
    { id: 'a', title: 'Servicio de aseo industrial para hospital' },
    { id: 'b', title: 'Guardias de seguridad para bodegas' },
    { id: 'c', title: 'Compra de resmas de papel' },
    { id: 'd', title: 'Servicios de aseo y limpieza de oficinas' },
  ], [rule('guards', DIEGO, 'seguridad'), rule('cleaning', MARIA, 'aseo')], members);
  assert.deepEqual(groups.map(group => [group.name, group.ids]), [['Diego Soto', ['b']], ['María Paz', ['a', 'd']]]);
});

test('a search is named by what it filters, opens the list with its filters, and is the same search whatever its name', () => {
  const state = { filter: 'recommended' as const, source: 'tender' as const, query: ' guardias ', categories: ['seguridad' as const] };
  assert.equal(searchName(state), '“guardias” · Seguridad · Licitaciones');
  assert.equal(searchName({ filter: 'all', source: 'all', query: '', categories: [] }), 'Todas las oportunidades');
  assert.equal(searchHref(state), '/opportunities?vista=lista&fuente=tender&q=guardias&rubro=seguridad');
  assert.ok(sameSearch(state, { ...state, query: 'GUARDIAS' }));
  assert.ok(!sameSearch(state, { ...state, filter: 'review' }));
  assert.ok(!isSearch({ filter: 'recommended', source: 'all', query: ' ', categories: [] }), 'the plain list is not a search');
  assert.deepEqual(buyerSearch(' Hospital Regional de Talca '), { name: 'Hospital Regional de Talca', filter: 'all', source: 'all', query: 'Hospital Regional de Talca', categories: [] });
});

test('the morning alert tells of a new one the search would show, never one the AI left out or that can no longer be bid', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  const search = { filter: 'recommended' as const, source: 'tender' as const, query: 'guardias', categories: [] };
  const fresh = { kind: 'tender', title: 'Servicio de GUARDIAS para el hospital', buyer_name: 'Hospital de Talca', deadline_at: '2026-11-10T15:00:00Z', evaluation: null };
  assert.ok(matchesSearch(fresh, search, now), 'still being read by the AI: told');
  assert.ok(!matchesSearch({ ...fresh, evaluation: 'excluded' }, search, now));
  assert.ok(!matchesSearch({ ...fresh, deadline_at: '2026-10-26T15:00:00Z' }, search, now));
  assert.ok(!matchesSearch({ ...fresh, kind: 'compra_agil' }, search, now), 'another source');
  assert.ok(matchesSearch({ ...fresh, title: 'Servicio de vigilancia' }, { ...search, query: 'talca' }, now), 'the words are looked for in the buyer too');
  assert.ok(matchesSearch({ ...fresh, title: 'Servicio de vigilancia' }, { ...search, query: '', categories: ['seguridad'] }, now));
  assert.ok(!matchesSearch({ ...fresh, title: 'Compra de resmas' }, { ...search, query: '', categories: ['seguridad'] }, now));
});
