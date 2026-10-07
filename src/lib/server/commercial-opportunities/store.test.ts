import assert from 'node:assert/strict';
import test from 'node:test';
import { createHiringProfile, readHiringProfileSuggestion, recentRuns, refreshHiringProfileFromPerfil } from './store';

type Row = Record<string, any>;
const ORG = '00000000-0000-4000-8000-000000000002';
const USER = '00000000-0000-4000-8000-000000000001';
const scope = { userId: USER, organizationId: ORG };

/** Just enough of the query builder: select/eq/contains/order/limit, maybeSingle, insert().select().single() and update. */
function fakeClient(tables: Record<string, Row[]>, options: { failInsert?: boolean } = {}) {
  const inserts: Row[] = [];
  const client = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let order: { column: string; ascending: boolean } | null = null;
      let limit = Infinity;
      let write: { kind: 'insert' | 'update'; row: Row } | null = null;
      const rows = () => {
        const list = (tables[table] || []).filter(row => filters.every(keep => keep(row)));
        if (order) list.sort((a, b) => (order!.ascending ? 1 : -1) * String(a[order!.column]).localeCompare(String(b[order!.column])));
        return list.slice(0, limit);
      };
      const builder: any = {
        select() { return builder; },
        eq(column: string, value: unknown) { filters.push(row => row[column] === value); return builder; },
        contains(column: string, values: unknown[]) { filters.push(row => values.every(value => (row[column] || []).includes(value))); return builder; },
        order(column: string, input: { ascending: boolean }) { order = { column, ascending: input.ascending }; return builder; },
        limit(value: number) { limit = value; return builder; },
        insert(row: Row) { write = { kind: 'insert', row }; return builder; },
        update(row: Row) { write = { kind: 'update', row }; return builder; },
        single: async () => {
          if (write?.kind !== 'insert') return { data: rows()[0] ?? null, error: null };
          if (options.failInsert) {
            // Someone else created it a moment ago.
            (tables[table] ||= []).push({ id: 'p-other', organization_id: ORG, active: true, sources: ['hiring', 'tender', 'compra_agil', 'project'], created_at: '2026-10-05T00:00:00Z', ...write.row, name: 'Otra pestaña' });
            return { data: null, error: { code: '23505', message: 'duplicate' } };
          }
          const created = { id: 'p-new', active: true, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z', ...write.row };
          inserts.push(created);
          (tables[table] ||= []).push(created);
          return { data: created, error: null };
        },
        maybeSingle: async () => {
          if (write?.kind === 'update') {
            const target = rows()[0];
            if (target) Object.assign(target, write.row);
            return { data: target ?? null, error: null };
          }
          return { data: rows()[0] ?? null, error: null };
        },
        then(resolve: (value: unknown) => void) { resolve({ data: rows(), error: null }); },
      };
      return builder;
    },
  };
  return { client: client as any, inserts };
}

const run = (id: string, source: string, startedAt: string) => ({
  id, organization_id: ORG, source, status: 'succeeded', started_at: startedAt, finished_at: startedAt, fetched: 1, created: 0, updated: 0, cost_estimate_usd: '0', error: null,
});

test('the last run of each source stays even when twelve newer runs pushed it out', async () => {
  const daily = Array.from({ length: 15 }, (_, index) => run(`d${index}`, ['jsearch', 'mercado_publico', 'compra_agil'][index % 3], `2026-10-${String(20 - Math.floor(index / 3)).padStart(2, '0')}T11:15:00Z`));
  const { client } = fakeClient({ commercial_opportunity_runs: [...daily, run('seia-1', 'seia', '2026-09-28T12:00:00Z')] });
  const runs = await recentRuns(client, scope);
  assert.ok(runs.some(item => String(item.source) === 'seia'), 'the SEIA upload is still there');
  assert.equal(runs.length, 13, '12 recent plus the older SEIA upload, without repeats');
  assert.deepEqual(runs.map(item => item.startedAt), [...runs.map(item => item.startedAt)].sort().reverse(), 'newest first');
});

test('the first save creates the profile; two tabs saving at once end in one profile with the last values', async () => {
  const patch = { name: 'Qué buscamos', offer: 'Arriendo de grúas', roles: ['operador de grúa'], regions: [], minAds: 3, keywords: ['arriendo de grúas'] };
  const fresh = fakeClient({ commercial_opportunity_profiles: [] });
  const created = await createHiringProfile(fresh.client, scope, patch);
  assert.equal(created?.offer, 'Arriendo de grúas');
  assert.deepEqual(fresh.inserts[0].roles, ['operador de grúa']);
  assert.equal(fresh.inserts[0].created_by, USER);

  const race = fakeClient({ commercial_opportunity_profiles: [] }, { failInsert: true });
  const saved = await createHiringProfile(race.client, scope, patch);
  assert.equal(saved?.id, 'p-other');
  assert.equal(saved?.offer, 'Arriendo de grúas', 'the other tab\'s profile gets this save');
});

test('without a profile the page suggests GrupoExpro\'s pilot only to GrupoExpro, and the own offer to anyone else', async () => {
  const pilot = await readHiringProfileSuggestion(fakeClient({ organizations: [{ id: ORG, name: 'GrupoExpro' }], profiles: [] }).client, scope);
  assert.equal(pilot.pilot, true);
  const other = await readHiringProfileSuggestion(fakeClient({
    organizations: [{ id: ORG, name: 'Constructora Andes' }],
    profiles: [{ id: USER, company_profile: 'Arriendo de maquinaria pesada para minería' }],
  }).client, scope);
  assert.equal(other.pilot, false);
  assert.equal(other.offer, 'Arriendo de maquinaria pesada para minería');
  assert.deepEqual(other.roles, []);

  const placed = await readHiringProfileSuggestion(fakeClient({
    organizations: [{ id: ORG, name: 'Constructora Andes' }],
    profiles: [{ id: USER, company_profile: 'Arriendo de grúas', signatures: { profile_extended: { targetLocations: 'Calama, Santiago' } } }],
  }).client, scope);
  assert.deepEqual(placed.regions, ['Antofagasta', 'Metropolitana'], 'the regions of «Tu cliente ideal» (Plan 15)');
});

test('the search follows «Perfil»: words are generated when missing or when the offer changes, and adjusted words stay otherwise', async () => {
  const stored = {
    id: 'p1', organization_id: ORG, name: 'Qué buscamos', offer: 'Arriendo de grúas', roles: [], regions: [], min_ads: 5, keywords: ['grúa horquilla'],
    unspsc_codes: [], seia_sectors: [], min_investment_usd: null, sources: ['hiring'], active: true, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  };
  const profile = { id: 'p1', name: 'Qué buscamos', offer: 'Arriendo de grúas', roles: [], regions: [], minAds: 5, keywords: ['grúa horquilla'],
    unspscCodes: [], sectors: [], minInvestmentUsd: null, updatedAt: stored.updated_at };
  const calls: string[] = [];
  const terms = async (perfil: { offer: string | null }) => { calls.push(String(perfil.offer)); return { keywords: ['arriendo de grúas', 'servicio de izaje'], sectors: ['industria'], source: 'ai' as const }; };
  const perfil = (offer: string | null) => ({ offer, services: [], sector: null, regions: [] });

  const same = fakeClient({ commercial_opportunity_profiles: [{ ...stored }] });
  assert.equal(await refreshHiringProfileFromPerfil(same.client, scope, profile, { terms, perfil: perfil('Arriendo de grúas') }), profile, 'nothing changed: no call');
  assert.equal(await refreshHiringProfileFromPerfil(same.client, scope, profile, { terms, perfil: perfil(null) }), profile, 'an empty «Perfil» changes nothing');
  assert.deepEqual(calls, []);

  const changed = fakeClient({ commercial_opportunity_profiles: [{ ...stored }] });
  const next = await refreshHiringProfileFromPerfil(changed.client, scope, profile, { terms, perfil: perfil('Arriendo de grúas e izaje') });
  assert.equal(next.offer, 'Arriendo de grúas e izaje');
  assert.deepEqual(next.keywords, ['arriendo de grúas', 'servicio de izaje']);
  assert.deepEqual(next.sectors, ['industria']);

  const asked = fakeClient({ commercial_opportunity_profiles: [{ ...stored }] });
  assert.deepEqual((await refreshHiringProfileFromPerfil(asked.client, scope, profile, { terms, perfil: perfil('Arriendo de grúas'), force: true })).keywords,
    ['arriendo de grúas', 'servicio de izaje'], '«Volver a generar»');
  assert.deepEqual(calls, ['Arriendo de grúas e izaje', 'Arriendo de grúas']);
});
