// API contract test of GET /api/cowork/contacts (the composer's «@») with isolated authorization and an
// in-memory client. No environment, database or provider access.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const USER = '00000000-0000-4000-8000-0000000000aa';
const ORG = '00000000-0000-4000-8000-0000000000bb';
const lead = (n, name, title, company, email, owner = USER) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, name, title, company, email,
  status: 'saved', industry: null, location: null, city: null, country: null, created_at: `2026-09-${String(10 + n).padStart(2, '0')}T10:00:00Z`, user_id: owner, organization_id: ORG });
const state = {
  denied: false, queries: [],
  leads: [
    lead(1, 'Marcela Rojas', 'Gerente de Personas', 'Sodexo Chile', 'mrojas@sodexo.cl'),
    lead(2, 'Felipe Muñoz', 'Jefe de Reclutamiento', 'Securitas Chile', 'fmunoz@securitas.cl'),
    lead(3, 'Andrea Vega', 'HR Business Partner', 'Falabella', null),
    lead(4, 'Marcos Díaz', 'Analista', 'Otra empresa', 'mdiaz@otra.cl', '00000000-0000-4000-8000-0000000000cc'),
    ...Array.from({ length: 8 }, (_, index) => lead(20 + index, `Persona ${index + 1}`, 'Cargo', 'Empresa', null)),
    lead(40, '  ', 'Sin nombre', 'Empresa', null),
  ],
};
globalThis.__coworkContactsRoute = state;
// A PostgREST-like client over the leads above: only what queryCoworkLeads uses.
const client = {
  from: table => {
    assert.equal(table, 'leads');
    const query = { eq: [], or: null, limit: null };
    const builder = {
      select: () => builder,
      eq: (column, value) => { query.eq.push([column, value]); return builder; },
      order: () => builder,
      or: value => { query.or = value; return builder; },
      limit: value => { query.limit = value; return builder; },
      then: (resolve, reject) => {
        state.queries.push(query);
        const terms = query.or ? [...new Set(query.or.split(',').map(part => part.split('.ilike.%')[1]?.replace(/%$/, '').toLowerCase()))] : [];
        const rows = state.leads.filter(row => query.eq.every(([column, value]) => row[column] === value))
          .filter(row => !terms.length || terms.some(term => ['name', 'title', 'company', 'email'].some(field => String(row[field] || '').toLowerCase().includes(term))))
          .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, query.limit ?? undefined);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  },
};
globalThis.__coworkContactsClient = client;
const result = await build({
  entryPoints: ['src/app/api/cowork/contacts/route.ts'],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-route-dependencies', setup(build) {
    build.onResolve({ filter: /^next\/server$|^@\/lib\/server\/(cowork\/access|auth-utils)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onResolve({ filter: /^@\/lib\/server\/cowork\/lead-tools$/ }, () => ({ path: `${process.cwd()}/src/lib/server/cowork/lead-tools.ts` }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
      if (args.path === 'next/server') return { contents: 'export const NextResponse = Response;' };
      if (args.path.endsWith('auth-utils')) return { contents: 'export class AuthError extends Error {} export function handleAuthError(){return Response.json({error:"Forbidden"},{status:403})}' };
      return { contents: `import {AuthError} from "@/lib/server/auth-utils"; export async function requireCoworkAccess(){if(globalThis.__coworkContactsRoute.denied)throw new AuthError();return {user:{id:"${USER}"},organizationId:"${ORG}",supabase:globalThis.__coworkContactsClient};}` };
    });
  } }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, loaded, loaded.exports);
const get = async query => {
  const response = await loaded.exports.GET(new Request(`http://localhost/api/cowork/contacts${query === undefined ? '' : `?q=${encodeURIComponent(query)}`}`));
  return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
};
try {
  // Without Cowork access nothing is read.
  state.denied = true;
  const refused = await get('mar');
  assert.equal(refused.status, 403);
  assert.match(refused.cache, /private, no-store/);
  assert.equal(state.queries.length, 0);
  state.denied = false;

  // A name finds your own contact; another person's never shows. The page gets what the list shows, never an address.
  const marcela = await get('mar');
  assert.equal(marcela.status, 200);
  assert.match(marcela.cache, /private, no-store/);
  assert.deepEqual(marcela.body.contacts.map(contact => contact.name), ['Marcela Rojas']);
  assert.deepEqual(marcela.body.contacts[0], { id: state.leads[0].id, name: 'Marcela Rojas', title: 'Gerente de Personas', company: 'Sodexo Chile', hasEmail: true });
  assert.ok(!JSON.stringify(marcela.body).includes('@'), 'no email address reaches the page');
  assert.deepEqual(state.queries.at(-1).eq, [['organization_id', ORG], ['user_id', USER]], 'only your own contacts in your organization');

  // Without a query, the most recent ones, at most six, and never a row without a name.
  const recent = await get('');
  assert.equal(recent.body.contacts.length, 6);
  assert.ok(recent.body.contacts.every(contact => contact.name.trim()));
  assert.equal(recent.body.contacts[0].name, 'Persona 8');
  // Only signs: nothing to look for, not an error, and nothing is read.
  const reads = state.queries.length;
  const signs = await get('()*');
  assert.deepEqual([signs.status, signs.body.contacts], [200, []]);
  assert.equal(state.queries.length, reads);
  const missing = await get('zzz');
  assert.deepEqual(missing.body.contacts, []);
  // One letter (the search takes two): the most recent ones with a name or last name that starts with it, accents aside.
  const letter = await get('m');
  assert.equal(letter.status, 200);
  assert.deepEqual(letter.body.contacts.map(contact => contact.name), ['Felipe Muñoz', 'Marcela Rojas']);
  assert.deepEqual((await get('Á')).body.contacts.map(contact => contact.name), ['Andrea Vega']);
  assert.deepEqual(state.queries.at(-1).or, null, 'one letter lists the recent ones instead of searching');
  console.log('PASS: the composer\'s «@» asks for access first, finds only your own saved contacts (from one letter on), sends at most six without their addresses, and treats signs as no search.');
} finally {
  delete globalThis.__coworkContactsRoute;
  delete globalThis.__coworkContactsClient;
}
