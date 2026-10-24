// API contract test of GET /api/cowork/overview (the Cowork home's figures, plan 2, V7) with isolated
// authorization, an in-memory session client and fixture reads. No environment, database or provider access.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const USER = '00000000-0000-4000-8000-0000000000aa';
const ORG = '00000000-0000-4000-8000-0000000000bb';
const state = { denied: false, failing: new Set(), queries: [], adminScopes: [], contextOptions: [], sinceReads: [], since: null, person: { fullName: 'Nicolás Yarur', offer: null } };
// «Desde tu última visita» and «Para hoy» have their own tests (since-visit, agenda-read): here only what the route hands them and passes on.
const SINCE = { at: '2026-10-14T12:00:00.000Z', replied: ['Camila Fuentes'], researched: [], counts: { replies: 1 } };
state.since = SINCE;
globalThis.__coworkOverview = state;
// Counts as PostgREST answers a head request: only rows matching every filter, never the rows themselves.
const rows = {
  leads: [
    { user_id: USER, organization_id: ORG, email: 'a@x.cl' }, { user_id: USER, organization_id: ORG, email: 'b@x.cl' },
    { user_id: USER, organization_id: ORG, email: null }, { user_id: USER, organization_id: ORG, email: '' },
    { user_id: '00000000-0000-4000-8000-0000000000cc', organization_id: ORG, email: 'otro@x.cl' },
  ],
  bulk_campaigns: [{ user_id: USER, organization_id: ORG }, { user_id: USER, organization_id: '00000000-0000-4000-8000-0000000000dd' }],
};
globalThis.__coworkOverviewClient = {
  from: table => {
    const query = { table, filters: [], head: false };
    const builder = {
      select: (_columns, options) => { query.head = Boolean(options?.head && options?.count === 'exact'); return builder; },
      eq: (column, value) => { query.filters.push(row => row[column] === value); return builder; },
      not: (column, operator, value) => { assert.equal(`${operator}.${value}`, 'is.null'); query.filters.push(row => row[column] !== null); return builder; },
      neq: (column, value) => { query.filters.push(row => row[column] !== value); return builder; },
      then: (resolve, reject) => {
        state.queries.push(query);
        if (state.failing.has(table)) return Promise.resolve({ data: null, count: null, error: { message: 'private detail' } }).then(resolve, reject);
        const count = (rows[table] || []).filter(row => query.filters.every(filter => filter(row))).length;
        return Promise.resolve({ data: query.head ? null : [], count, error: null }).then(resolve, reject);
      },
    };
    return builder;
  },
};
const result = await build({
  entryPoints: ['src/app/api/cowork/overview/route.ts'],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-route-dependencies', setup(build) {
    build.onResolve({ filter: /^next\/server$|^@\/lib\/server\/(cowork\/access|auth-utils|supabase-admin|cowork\/linkedin-reads|cowork\/user-context|cowork\/since-visit|cowork\/agenda-read)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onResolve({ filter: /^@\/lib\/cowork\/overview$/ }, () => ({ path: `${process.cwd()}/src/lib/cowork/overview.ts` }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
      if (args.path === 'next/server') return { contents: 'export const NextResponse = Response;' };
      if (args.path.endsWith('auth-utils')) return { contents: 'export class AuthError extends Error {} export function handleAuthError(){return Response.json({error:"Forbidden"},{status:403})} export async function requireAuth(){throw new Error("unexpected auth")}' };
      if (args.path.endsWith('supabase-admin')) return { contents: 'export function getSupabaseAdminClient(){ if (globalThis.__coworkOverview.failing.has("admin")) throw new Error("no admin"); return { admin: true }; }' };
      if (args.path.endsWith('linkedin-reads')) return { contents: 'export async function readCoworkLinkedinQuota(client, scope){ globalThis.__coworkOverview.adminScopes.push([client.admin === true, scope]); if (globalThis.__coworkOverview.failing.has("linkedin")) throw new Error("x"); return { pending: 2, sent7d: 5, limit: 20, allowed: true }; }' };
      if (args.path.endsWith('user-context')) return { contents: 'export async function loadCoworkUserContext(client, scope, options){ globalThis.__coworkOverview.contextOptions.push([client === globalThis.__coworkOverviewClient, scope, options]); return globalThis.__coworkOverview.person; }' };
      if (args.path.endsWith('since-visit')) return { contents: 'export async function loadCoworkSinceLastVisit(sources, scope){ const s = globalThis.__coworkOverview; s.sinceReads.push([sources.client === globalThis.__coworkOverviewClient, "opportunities" in sources, scope]); if (s.failing.has("since")) throw new Error("x"); return s.since; }' };
      if (args.path.endsWith('agenda-read')) return { contents: 'export async function readNeverWritten(client, scope){ if (globalThis.__coworkOverview.failing.has("toWrite")) throw new Error("x"); return { count: client === globalThis.__coworkOverviewClient && scope.userId ? 3 : 0 }; }' };
      return { contents: `import {AuthError} from "@/lib/server/auth-utils"; export async function requireCoworkAccess(){if(globalThis.__coworkOverview.denied)throw new AuthError();return {user:{id:"${USER}"},organizationId:"${ORG}",supabase:globalThis.__coworkOverviewClient};}` };
    });
  } }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, loaded, loaded.exports);
const get = async () => {
  const response = await loaded.exports.GET(new Request('http://localhost/api/cowork/overview'));
  return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
};
try {
  // Without Cowork access nothing is read.
  state.denied = true;
  const refused = await get();
  assert.equal(refused.status, 403);
  assert.match(refused.cache, /private, no-store/);
  assert.equal(state.queries.length + state.adminScopes.length + state.contextOptions.length, 0);
  state.denied = false;

  // Your own figures, counted: contacts, those with an email (not null, not empty), your campaigns in this organization.
  const overview = await get();
  assert.equal(overview.status, 200);
  assert.match(overview.cache, /private, no-store/);
  assert.deepEqual(overview.body, { firstName: 'Nicolás', hasOffer: false, contacts: 4, withEmail: 2, campaigns: 1, linkedin: { used: 7, limit: 20 }, since: SINCE, toWrite: 3, web: false });
  assert.ok(state.queries.every(query => query.head), 'counts only: no rows are read');
  // LinkedIn jobs are read by the worker's role, scoped to you; the profile through your session, without memories.
  assert.deepEqual(state.adminScopes, [[true, { userId: USER, organizationId: ORG }]]);
  assert.deepEqual(state.contextOptions, [[true, { userId: USER, organizationId: ORG }, { memories: false, mailbox: false }]]);
  // What changed since your last turn, through your session; «Oportunidades» is not part of Cowork (it has its own assistant).
  assert.deepEqual(state.sinceReads, [[true, false, { userId: USER, organizationId: ORG }]]);

  // A figure that fails is null (never a made-up zero) and the rest still arrive; the error detail stays on the server.
  state.failing = new Set(['bulk_campaigns', 'admin', 'toWrite']);
  state.person = { fullName: null, offer: 'AXIS' };
  state.sinceReads = [];
  const partial = await get();
  assert.equal(partial.status, 200);
  assert.deepEqual(partial.body, { firstName: null, hasOffer: true, contacts: 4, withEmail: 2, campaigns: null, linkedin: null, since: SINCE, toWrite: null, web: false });
  // Without the service client, what changed since your last turn still arrives.
  assert.deepEqual(state.sinceReads, [[true, false, { userId: USER, organizationId: ORG }]]);
  assert.ok(!JSON.stringify(partial.body).includes('private detail'));
  // Without a readable profile, whether there is an offer is unknown, not «no».
  state.failing = new Set();
  state.person = null;
  assert.equal((await get()).body.hasOffer, null);
  console.log('PASS: the home\'s figures ask for access first, count only your own contacts, emails and campaigns, read LinkedIn scoped to you, and leave out what fails instead of showing a zero.');
} finally {
  delete globalThis.__coworkOverview;
  delete globalThis.__coworkOverviewClient;
}
