import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { collectCoworkLeadRows } from '@/lib/cowork/lead-export';
import { countCoworkLeads, queryCoworkLeads, segmentPhrases, summarizeCoworkLeads } from './lead-tools';

function client() {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'order', 'limit', 'or']) {
    chain[name] = (...args: unknown[]) => { calls.push([name, ...args]); return chain; };
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [], error: null }));
  return { calls, db: { from: (table: string) => { calls.push(['from', table]); return chain; } } as unknown as SupabaseClient };
}

test('reads always enforce user and organization and sanitize PostgREST grammar', async () => {
  const f = client();
  const result = await queryCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, 'leads.search', '%,id.not.is.null,(secret)');
  assert.ok(f.calls.some(call => call[0] === 'eq' && call[1] === 'user_id' && call[2] === 'owner'));
  assert.ok(f.calls.some(call => call[0] === 'eq' && call[1] === 'organization_id' && call[2] === 'org'));
  const filter = String(f.calls.find(call => call[0] === 'or')?.[1]);
  const parts = filter.split(',');
  assert.ok(!filter.includes('('));
  assert.equal(parts.length, 14);
  assert.ok(parts.every(part => /^\w+\.ilike\.%[^%,()]*%$/.test(part)));
  assert.equal(result.scope, 'own_saved_contacts');
  assert.equal(result.returned, 0);
});

test('detail lookup validates IDs and is bounded to one row', async () => {
  const f = client();
  await assert.rejects(queryCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, 'leads.get', 'x,or.id'));
  await queryCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, 'leads.get', '00000000-0000-4000-8000-000000000001');
  assert.ok(f.calls.some(call => call[0] === 'limit' && call[1] === 1));
});

function rowsClient(rows: unknown[]) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'order', 'limit', 'or']) {
    chain[name] = (...args: unknown[]) => { calls.push([name, ...args]); return chain; };
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: rows, error: null }));
  return { calls, db: { from: (table: string) => { calls.push(['from', table]); return chain; } } as unknown as SupabaseClient };
}

test('multi-term queries rank by overlap and declare partial matches', async () => {
  const rows = [
    { id: '1', name: 'Ana R.', title: 'Gerenta', company: 'Otra', email: null, city: null, country: null, created_at: '2026-01-03' },
    { id: '2', name: 'José C.', title: 'Reclutador Junior', company: 'GrupoExpro', email: null, city: null, country: null, created_at: '2026-01-02' },
  ];
  const f = rowsClient(rows);
  const result = await queryCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, 'leads.search', 'reclutador junior GrupoExpro Santiago');
  assert.deepEqual((result.items as Array<{ id: string }>).map(item => item.id), ['2', '1']);
  assert.equal(result.returned, 2);
  assert.equal(result.partial, true);
  assert.equal(result.terms, 4);
  assert.equal(result.truncated, false);
});

test('exact multi-term matches are not partial and empty queries list recent', async () => {
  const rows = [{ id: '2', name: 'José C.', title: 'Reclutador Junior', company: 'GrupoExpro', email: null, city: 'Santiago', country: null, created_at: '2026-01-02' }];
  const exact = rowsClient(rows);
  const full = await queryCoworkLeads(exact.db, { userId: 'owner', organizationId: 'org' }, 'leads.search', 'junior grupoexpro santiago');
  assert.equal(full.partial, false);
  const listed = rowsClient(rows);
  const empty = await queryCoworkLeads(listed.db, { userId: 'owner', organizationId: 'org' }, 'leads.search', '');
  assert.ok(!listed.calls.some(call => call[0] === 'or'));
  assert.equal(empty.returned, 1);
  assert.equal(empty.partial, false);
});

test('a saved contact can be found by its email address', async () => {
  const rows = [{ id: '9', name: 'Nico Prueba', title: null, company: null, email: 'nicogun123@gmail.com', city: null, country: null, created_at: '2026-09-25' }];
  const f = rowsClient(rows);
  const result = await queryCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, 'leads.search', 'nicogun123@gmail.com');
  const filter = String(f.calls.find(call => call[0] === 'or')?.[1]);
  assert.ok(filter.split(',').includes('email.ilike.%nicogun123@gmail.com%'));
  assert.equal(result.returned, 1);
  assert.equal(result.partial, false);
});

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const stored = (n: number, linkedin: unknown) => ({ id: ID(n), name: `Persona ${n}`, title: null, company: 'Empresa', email: null, city: null, country: null, created_at: `2026-09-0${n}`, linkedin_url: linkedin });

test('the saved contact reads its LinkedIn profile, so a batch can tell who has one', async () => {
  const f = rowsClient([stored(1, 'https://www.linkedin.com/in/ana-ruiz')]);
  await queryCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, 'leads.search', 'persona');
  assert.match(String(f.calls.find(call => call[0] === 'select')?.[1]), /(^|,)linkedin_url(,|$)/);
  const one = rowsClient([stored(1, 'https://www.linkedin.com/in/ana-ruiz')]);
  await queryCoworkLeads(one.db, { userId: 'owner', organizationId: 'org' }, 'leads.get', ID(1));
  assert.match(String(one.calls.find(call => call[0] === 'select')?.[1]), /(^|,)linkedin_url(,|$)/);
});

test('only the canonical profile address is passed on, and what is not a profile is nothing', async () => {
  const rows = [
    stored(1, 'https://cl.linkedin.com/in/ana-ruiz/?trk=public_profile'),
    stored(2, 'linkedin.com/in/hector-vidal'),
    stored(3, 'https://www.linkedin.com/company/alimentos-del-valle'),
    stored(4, 'sin perfil, pedir por correo'),
    stored(5, null),
    stored(6, undefined),
    stored(7, { url: 'https://www.linkedin.com/in/otro' }),
    stored(8, 'javascript:alert(1)'),
  ];
  const result = await queryCoworkLeads(rowsClient(rows).db, { userId: 'owner', organizationId: 'org' }, 'leads.search', '');
  const byId = new Map((result.items as Array<{ id: string; linkedin_url: string | null }>).map(item => [item.id, item.linkedin_url]));
  assert.equal(byId.get(ID(1)), 'https://www.linkedin.com/in/ana-ruiz');
  assert.equal(byId.get(ID(2)), 'https://www.linkedin.com/in/hector-vidal');
  for (const n of [3, 4, 5, 6, 7, 8]) assert.equal(byId.get(ID(n)), null, `contacto ${n}`);
  assert.equal(result.returned, 8);
  // The detail lookup says the same.
  const detail = await queryCoworkLeads(rowsClient([rows[0]]).db, { userId: 'owner', organizationId: 'org' }, 'leads.get', ID(1));
  assert.equal((detail.items as Array<{ linkedin_url: string | null }>)[0].linkedin_url, 'https://www.linkedin.com/in/ana-ruiz');
});

test('a malformed stored profile never makes the whole result unreadable for the exports and batches', async () => {
  const rows = [stored(1, 'https://www.linkedin.com/in/ana-ruiz'), stored(2, 'no es una url'), stored(3, 'http://[::1')];
  const result = await queryCoworkLeads(rowsClient(rows).db, { userId: 'owner', organizationId: 'org' }, 'leads.search', '');
  const observed = collectCoworkLeadRows([{ action: 'leads.search', result }]);
  assert.deepEqual(observed.map(row => row.id).sort(), [ID(1), ID(2), ID(3)]);
  assert.equal(observed.find(row => row.id === ID(2))?.linkedin_url, null);
});

/** A client that answers the three head counts of a segment by the filters each one applied. */
function countingClient(counts: { total: number; email: number; profile: number }, error = false) {
  const calls: Array<[string, ...unknown[]]> = [];
  const make = (table: string) => {
    const applied: string[] = [];
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'or', 'not', 'neq', 'ilike']) {
      chain[name] = (...args: unknown[]) => { calls.push([name, ...args]); applied.push(name); return chain; };
    }
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({
      count: applied.includes('ilike') ? counts.profile : applied.includes('neq') ? counts.email : counts.total, error: error ? { message: 'boom' } : null }));
    return chain;
  };
  return { calls, db: { from: (table: string) => { calls.push(['from', table]); return make(table); } } as unknown as SupabaseClient };
}

test('a segment is counted exactly, per user and organization, with whole phrases and no grammar from the model', async () => {
  const f = countingClient({ total: 214, email: 180, profile: 150 });
  const result = await countCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, 'Recursos Humanos | reclutador,%,id.not.is.null,(x)');
  assert.deepEqual(result.phrases, ['Recursos Humanos', 'reclutador', 'id.not.is.null', 'x'].filter(phrase => phrase.length >= 2));
  assert.equal(result.total, 214);
  assert.equal(result.withEmail, 180);
  assert.equal(result.withoutEmail, 34);
  assert.equal(result.withLinkedinProfile, 150);
  assert.equal(result.exact, true);
  assert.equal(f.calls.filter(call => call[0] === 'eq' && call[1] === 'user_id' && call[2] === 'owner').length, 3);
  assert.equal(f.calls.filter(call => call[0] === 'eq' && call[1] === 'organization_id' && call[2] === 'org').length, 3);
  assert.ok(f.calls.filter(call => call[0] === 'select').every(call => call[1] === 'id' && (call[2] as { head: boolean }).head === true), 'only counts leave the database');
  const filter = String(f.calls.find(call => call[0] === 'or')?.[1]);
  assert.ok(filter.includes('title.ilike."%Recursos Humanos%"'));
  assert.ok(!filter.includes('('), 'no parenthesis reaches the filter');
  assert.ok(filter.split(',').every(part => /^(title|company|industry)\.ilike\."%[^%,()"]+%"$/.test(part)), filter);
});

test('without phrases it counts every saved contact, and a value that is only symbols is rejected', async () => {
  const f = countingClient({ total: 9045, email: 7000, profile: 7642 });
  const all = await countCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, '');
  assert.deepEqual(all.phrases, []);
  assert.equal(all.total, 9045);
  assert.equal(f.calls.some(call => call[0] === 'or'), false);
  await assert.rejects(countCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, '%%,()'), /Invalid search term/);
  await assert.rejects(countCoworkLeads(countingClient({ total: 1, email: 1, profile: 1 }, true).db, { userId: 'owner', organizationId: 'org' }, 'rrhh'), /No se pudieron contar/);
});

test('segment phrases keep whole phrases, drop noise and stop at six', () => {
  assert.deepEqual(segmentPhrases('gerente general | a | talent acquisition'), ['gerente general', 'talent acquisition']);
  assert.equal(segmentPhrases('a1,b2,c3,d4,e5,f6,g7,h8').length, 6);
});

test('a contact another member holds comes with its team notice, so Cowork does not propose writing to them', async () => {
  const data: Record<string, unknown> = {
    leads: [
      { id: '1', name: 'Marcela Rojas', title: 'Gerenta de Personas', company: 'Sodexo', email: 'Marcela@Sodexo.cl', created_at: '2026-01-03' },
      { id: '2', name: 'Rafael Díaz', title: 'Gerente', company: 'Otra', email: 'rafael@otra.cl', created_at: '2026-01-02' },
    ],
    organizations: { collaboration_v1_enabled: true },
    organization_contact_threads: [{ recipient_key: 'marcela@sodexo.cl', status: 'active', opened_by_user_id: 'user-ana', first_contacted_at: '2026-09-01T00:00:00Z', last_contacted_at: '2026-09-20T00:00:00Z', reopened_at: null }],
    organization_members: [{ user_id: 'user-ana', profiles: { full_name: 'Ana Pérez' } }],
    contacted_leads: [{ email: 'marcela@sodexo.cl', replied_at: '2026-09-22T00:00:00Z' }],
  };
  const db = {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'order', 'limit', 'or', 'in', 'not']) chain[name] = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data: data[table], error: null });
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: data[table], error: null }));
      return chain;
    },
  } as unknown as SupabaseClient;
  const result = await queryCoworkLeads(db, { userId: 'user-beto', organizationId: 'org' }, 'leads.search', '');
  const byName = Object.fromEntries(result.items.map((item: any) => [item.name, item]));
  assert.equal(byName['Marcela Rojas'].teamLock, 'En conversación con Ana Pérez');
  assert.equal('teamLock' in byName['Rafael Díaz'], false, 'a free contact carries no notice');

test('the summary by state reads only the person\'s own rows, three bounded lists, and never names', async () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const data: Record<string, unknown[]> = {
    leads: [{ id: 'a', email: 'ana@x.cl', linkedin_url: null }, { id: 'b', email: null, linkedin_url: null }],
    contacted_leads: [{ lead_id: 'a', email: 'ana@x.cl', replied_at: null }],
    lead_research_jobs: [],
  };
  const db = { from: (table: string) => {
    calls.push(['from', table]);
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'order', 'limit']) chain[name] = (...args: unknown[]) => { calls.push([name, ...args]); return chain; };
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: data[table], error: null }));
    return chain;
  } } as unknown as SupabaseClient;
  const summary = await summarizeCoworkLeads(db, { userId: 'owner', organizationId: 'org' });
  assert.deepEqual(summary.groups.filter(group => group.count).map(group => [group.id, group.count]), [['contacted', 1], ['no_email', 1]]);
  assert.equal(calls.filter(call => call[0] === 'eq' && call[1] === 'user_id' && call[2] === 'owner').length, 3);
  assert.equal(calls.filter(call => call[0] === 'eq' && call[1] === 'organization_id' && call[2] === 'org').length, 3);
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'status' && call[2] === 'completed'), 'only finished research counts');
  assert.ok(calls.filter(call => call[0] === 'select').every(call => !/name|company|title/.test(String(call[1]))), 'no names leave the database');
  assert.ok(calls.filter(call => call[0] === 'limit').every(call => Number(call[1]) <= 10000));
});
