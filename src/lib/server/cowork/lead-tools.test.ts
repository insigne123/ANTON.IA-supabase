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
  const employee = rowsClient([{ id: '10', name: 'Empleado', email: 'persona@linkedin.com' }]);
  const linkedinEmail = await queryCoworkLeads(employee.db, { userId: 'owner', organizationId: 'org' }, 'leads.search', 'persona@linkedin.com');
  assert.equal(linkedinEmail.returned, 1, 'an email at linkedin.com is still an email query, not a profile');
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

/** A client that answers the head counts of a segment by the table and the filters each one applied. */
function countingClient(counts: { total: number; email: number; profile: number }, error = false,
  enriched: { total: number; email: number; profile: number } | 'error' = { total: 0, email: 0, profile: 0 }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const make = (table: string) => {
    const applied: string[] = [];
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'or', 'not', 'neq', 'ilike', 'is']) {
      chain[name] = (...args: unknown[]) => { calls.push([name, ...args]); applied.push(name); return chain; };
    }
    const source = table === 'enriched_leads' ? enriched : counts;
    const failed = table === 'enriched_leads' ? enriched === 'error' : error;
    const pick = (value: { total: number; email: number; profile: number } | 'error') => value === 'error' ? null
      : applied.includes('ilike') ? value.profile : applied.includes('neq') ? value.email : value.total;
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ count: pick(source), error: failed ? { message: 'boom' } : null }));
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
  assert.equal(f.calls.filter(call => call[0] === 'eq' && call[1] === 'user_id' && call[2] === 'owner').length, 6, 'saved and «Por escribir»');
  assert.equal(f.calls.filter(call => call[0] === 'eq' && call[1] === 'organization_id' && call[2] === 'org').length, 6);
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
});

test('the summary by state reads only the person\'s own rows, four bounded lists, and never names', async () => {
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
  assert.equal(calls.filter(call => call[0] === 'eq' && call[1] === 'user_id' && call[2] === 'owner').length, 4, 'saved, «Por escribir», sends and research');
  assert.equal(calls.filter(call => call[0] === 'eq' && call[1] === 'organization_id' && call[2] === 'org').length, 4);
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'status' && call[2] === 'completed'), 'only finished research counts');
  assert.ok(calls.filter(call => call[0] === 'select').every(call => !/name|company|title/.test(String(call[1]))), 'no names leave the database');
  assert.ok(calls.filter(call => call[0] === 'limit').every(call => Number(call[1]) <= 10000));
});

/** A client whose tables answer their own rows (or an error), whatever the filters: enough to see how the sources merge. */
function tablesClient(tables: Record<string, unknown[] | 'error'>) {
  const calls: Array<[string, ...unknown[]]> = [];
  const db = { from: (table: string) => {
    calls.push(['from', table]);
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'order', 'limit', 'or', 'in', 'not', 'is', 'neq', 'ilike']) {
      chain[name] = (...args: unknown[]) => { calls.push([name, table, ...args]); return chain; };
    }
    const answer = () => tables[table] === 'error' ? { data: null, error: { message: 'boom' } } : { data: tables[table] || [], error: null };
    chain.maybeSingle = () => Promise.resolve(answer());
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(answer()));
    return chain;
  } } as unknown as SupabaseClient;
  return { calls, db };
}

const SAVED_A = '00000000-0000-4000-8000-0000000000a1';
const ENRICHED_B = '00000000-0000-4000-8000-0000000000b2';
const ENRICHED_LINKED = '00000000-0000-4000-8000-0000000000c3';

test('«Por escribir» joins the search: a saved person once, with the LinkedIn its email search found, and the rest as enriched', async () => {
  const f = tablesClient({
    leads: [{ id: SAVED_A, name: 'Rafael Díaz', title: 'Gerente de Personas', company: 'Sodexo', email: null, linkedin_url: null, created_at: '2026-09-20T10:00:00Z' }],
    enriched_leads: [
      { id: ENRICHED_LINKED, full_name: 'Rafael Díaz', title: 'Gerente de Personas', company_name: 'Sodexo', email: 'rdiaz@sodexo.cl',
        linkedin_url: 'https://cl.linkedin.com/in/rafael-diaz/', saved_lead_id: SAVED_A, created_at: '2026-09-21T10:00:00Z' },
      { id: ENRICHED_B, full_name: 'Susana Mora', title: 'Jefa de Reclutamiento', company_name: null, organization_name: 'Andes Servicios',
        email: 'smora@andes.cl', organization_industry: 'Staffing', linkedin_url: 'linkedin.com/in/susana-mora', created_at: '2026-09-25T10:00:00Z' },
    ],
  });
  const result = await queryCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, 'leads.search', '');
  assert.equal(result.scope, 'own_saved_contacts', 'the observed rows keep their scope');
  assert.deepEqual(result.sources, { saved: 1, enriched: 1 });
  const byId = new Map((result.items as Array<Record<string, unknown>>).map(item => [item.id, item]));
  assert.equal(byId.size, 2, 'each person once');
  assert.deepEqual(
    { source: byId.get(SAVED_A)?.source, email: byId.get(SAVED_A)?.email, linkedin: byId.get(SAVED_A)?.linkedin_url },
    { source: 'saved', email: 'rdiaz@sodexo.cl', linkedin: 'https://www.linkedin.com/in/rafael-diaz' });
  assert.deepEqual(
    { source: byId.get(ENRICHED_B)?.source, name: byId.get(ENRICHED_B)?.name, company: byId.get(ENRICHED_B)?.company,
      industry: byId.get(ENRICHED_B)?.industry, linkedin: byId.get(ENRICHED_B)?.linkedin_url },
    { source: 'enriched', name: 'Susana Mora', company: 'Andes Servicios', industry: 'Staffing', linkedin: 'https://www.linkedin.com/in/susana-mora' });
  assert.equal((result.items as Array<{ id: string }>)[0].id, ENRICHED_B, 'the most recent first');
  assert.ok(f.calls.some(call => call[0] === 'eq' && call[1] === 'enriched_leads' && call[2] === 'user_id' && call[3] === 'owner'), '«Por escribir» is read per user too');
  // The exports and batches see them as observed contacts.
  assert.deepEqual(collectCoworkLeadRows([{ action: 'leads.search', result }]).map(row => row.id).sort(), [SAVED_A, ENRICHED_B].sort());
});

test('a search term looks in «Por escribir» with its own columns and no grammar from the model', async () => {
  const f = tablesClient({ leads: [], enriched_leads: [{ id: ENRICHED_B, full_name: 'Susana Mora', email: 'smora@andes.cl', created_at: '2026-09-25T10:00:00Z' }] });
  const result = await queryCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, 'leads.search', 'Susana (Mora)');
  const filter = String(f.calls.find(call => call[0] === 'or' && call[1] === 'enriched_leads')?.[2]);
  assert.ok(filter.split(',').every(part => /^(full_name|title|company_name|email|city|country)\.ilike\.%[^%,()]*%$/.test(part)), filter);
  assert.equal(result.returned, 1);
  assert.equal(result.partial, false);
});

test('a personal LinkedIn URL finds only that profile, never URL-word overlaps with other contacts', async () => {
  const profile = 'https://www.linkedin.com/in/contacto-de-prueba-23825746';
  const f = tablesClient({
    leads: [
      { id: SAVED_A, name: 'Otra persona', email: 'otra@empresa.com', company: 'Linkedin Services', linkedin_url: 'https://www.linkedin.com/in/otro-perfil' },
    ],
    enriched_leads: [
      { id: ENRICHED_B, full_name: 'Contacto de Prueba', linkedin_url: 'http://cl.linkedin.com/in/contacto-de-prueba-23825746/?trk=test' },
      { id: ENRICHED_LINKED, full_name: 'Candidato parecido', linkedin_url: `${profile}-otra-persona` },
    ],
  });
  const result = await queryCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, 'leads.search', `${profile}/`);
  assert.ok('match' in result);
  assert.equal(result.match, 'linkedin_url');
  assert.equal(result.partial, false);
  assert.deepEqual(result.items.map(item => item.id), [ENRICHED_B]);
  assert.equal(result.items[0].linkedin_url, profile);
  const filters = f.calls.filter(call => call[0] === 'or').map(call => String(call[2]));
  assert.equal(filters.length, 2);
  assert.ok(filters.every(filter => filter.split(',').every(part => part.startsWith('linkedin_url.ilike.'))));
  assert.ok(f.calls.some(call => call[0] === 'eq' && call[1] === 'leads' && call[2] === 'user_id' && call[3] === 'owner'));
  assert.ok(f.calls.some(call => call[0] === 'eq' && call[1] === 'enriched_leads' && call[2] === 'organization_id' && call[3] === 'org'));
});

test('an unsaved exact profile proposes one profile lookup, while an incomplete read never asserts absence', async () => {
  const profile = 'https://www.linkedin.com/in/contacto-de-prueba-23825746';
  const empty = await queryCoworkLeads(tablesClient({ leads: [], enriched_leads: [] }).db,
    { userId: 'owner', organizationId: 'org' }, 'leads.search', profile);
  assert.equal(empty.returned, 0);
  assert.ok('sourcesComplete' in empty && 'profileLookup' in empty);
  assert.equal(empty.sourcesComplete, true);
  assert.deepEqual(empty.profileLookup, { action: 'prospecting.propose_search', searchCriteria: {
    linkedinUrl: profile, titles: [], industries: [], locations: [], limit: 1,
  } });
  const failed = await queryCoworkLeads(tablesClient({ leads: [], enriched_leads: 'error' }).db,
    { userId: 'owner', organizationId: 'org' }, 'leads.search', profile);
  assert.ok('sourcesComplete' in failed && 'notice' in failed);
  assert.equal(failed.sourcesComplete, false);
  assert.equal('profileLookup' in failed, false);
  assert.match(failed.notice || '', /no puedo confirmar/);
  await assert.rejects(() => queryCoworkLeads(tablesClient({}).db,
    { userId: 'owner', organizationId: 'org' }, 'leads.search', 'https://www.linkedin.com/company/example'), /perfil personal/);
});

test('a contact of «Por escribir» is read by its id, and if «Por escribir» fails the saved contacts still answer', async () => {
  const one = tablesClient({ leads: [], enriched_leads: [{ id: ENRICHED_B, full_name: 'Susana Mora', email: 'smora@andes.cl', linkedin_url: 'https://www.linkedin.com/in/susana-mora' }] });
  const detail = await queryCoworkLeads(one.db, { userId: 'owner', organizationId: 'org' }, 'leads.get', ENRICHED_B);
  assert.equal(detail.returned, 1);
  assert.deepEqual([(detail.items as Array<Record<string, unknown>>)[0].name, (detail.items as Array<Record<string, unknown>>)[0].source], ['Susana Mora', 'enriched']);
  const down = tablesClient({ leads: [{ id: SAVED_A, name: 'Rafael Díaz', email: null }], enriched_leads: 'error' });
  const saved = await queryCoworkLeads(down.db, { userId: 'owner', organizationId: 'org' }, 'leads.search', '');
  assert.deepEqual(saved.sources, { saved: 1, enriched: 0 });
  assert.equal(saved.returned, 1);
});

test('the summary counts «Por escribir» once per person, with their emails and LinkedIn', async () => {
  const f = tablesClient({
    leads: [{ id: SAVED_A, email: null, linkedin_url: null }],
    enriched_leads: [
      { id: ENRICHED_LINKED, email: 'rdiaz@sodexo.cl', linkedin_url: 'https://www.linkedin.com/in/rafael-diaz', saved_lead_id: SAVED_A },
      { id: ENRICHED_B, email: 'smora@andes.cl', linkedin_url: 'https://www.linkedin.com/in/susana-mora' },
    ],
    contacted_leads: [], lead_research_jobs: [{ lead_id: ENRICHED_B }],
  });
  const summary = await summarizeCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' });
  assert.equal(summary.total, 2);
  assert.deepEqual(summary.groups.filter(group => group.count).map(group => [group.id, group.count]), [['ready', 1], ['with_email', 1]]);
  assert.equal(summary.withLinkedinProfile, 2);
  assert.deepEqual(summary.sources, { saved: 1, porEscribir: 1 });
  assert.match(summary.note, /«Por escribir»/);
  const down = tablesClient({ leads: [{ id: SAVED_A, email: null }], enriched_leads: 'error', contacted_leads: [], lead_research_jobs: [] });
  const partial = await summarizeCoworkLeads(down.db, { userId: 'owner', organizationId: 'org' });
  assert.deepEqual(partial.sources, { saved: 1, porEscribir: null });
  assert.match(partial.note, /No se pudo leer «Por escribir»/);
});

test('a segment counts «Por escribir» too, without the ones already tied to a saved contact', async () => {
  const f = countingClient({ total: 10, email: 4, profile: 1 }, false, { total: 30, email: 30, profile: 25 });
  const result = await countCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, 'reclutador');
  assert.deepEqual([result.total, result.withEmail, result.withoutEmail, result.withLinkedinProfile], [40, 34, 6, 26]);
  assert.deepEqual(result.bySource, { saved: { total: 10, withEmail: 4, withLinkedinProfile: 1 }, porEscribir: { total: 30, withEmail: 30, withLinkedinProfile: 25 } });
  assert.ok(f.calls.some(call => call[0] === 'is' && call[1] === 'data->>sourceSavedLeadId' && call[2] === null), 'no person counts twice through its link');
  const enrichedFilter = String(f.calls.filter(call => call[0] === 'or').map(call => call[1]).find(value => String(value).includes('company_name')));
  assert.ok(enrichedFilter.split(',').every(part => /^(title|company_name|organization_industry)\.ilike\."%[^%,()"]+%"$/.test(part)), enrichedFilter);
  const down = await countCoworkLeads(countingClient({ total: 10, email: 4, profile: 1 }, false, 'error').db, { userId: 'owner', organizationId: 'org' }, '');
  assert.deepEqual([down.total, down.exact, down.bySource.porEscribir], [10, false, null]);
});

test('«Ver todos» brings the whole list up to 500, and says when even that is cut', async () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const many = Array.from({ length: 130 }, (_, n) => ({ id: id(n + 1), name: `Persona ${n}`, title: 'Gerente de Personas', company: `Empresa ${n}`, email: null,
    city: null, country: null, created_at: `2026-01-${String((n % 28) + 1).padStart(2, '0')}` }));
  const turn = tablesClient({ leads: many, enriched_leads: [] });
  const cut = await queryCoworkLeads(turn.db, { userId: 'owner', organizationId: 'org' }, 'leads.search', 'personas');
  assert.equal(cut.items.length, 20);
  assert.equal(cut.truncated, true);
  assert.ok(turn.calls.some(call => call[0] === 'limit' && call[1] === 'leads' && call[2] === 60));
  const all = tablesClient({ leads: many, enriched_leads: [] });
  const full = await queryCoworkLeads(all.db, { userId: 'owner', organizationId: 'org' }, 'leads.search', 'personas', { max: 500 });
  assert.equal(full.items.length, 130);
  assert.equal(full.truncated, false);
  assert.equal(full.limit, 500);
  assert.ok(all.calls.some(call => call[0] === 'limit' && call[1] === 'leads' && call[2] === 500));
  assert.equal((await queryCoworkLeads(tablesClient({ leads: many, enriched_leads: [] }).db, { userId: 'owner', organizationId: 'org' }, 'leads.search', 'personas', { max: 9999 })).limit, 500);
});
