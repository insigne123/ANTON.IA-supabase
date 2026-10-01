// Live measurement of the Cowork search (Plan 5, PR-4), for the maintainer: how many people three real offers bring before
// (one people search, exact titles, 25) and now (companies first, buyers first). The 1 Oct test brought 2 of 25; the goal is 20 or more.
// Needs APOLLO_API_KEY in the environment: it loads no env file, writes nothing, never reveals emails and saves no contact.
// Each offer spends provider credits: one company search (about 1 credit) plus the people searches (0 credits, by the
// provider's pricing), so 3 offers cost about 3 credits; --usage prints the provider's credit counters before and after.
//   APOLLO_API_KEY=... node scripts/measure-cowork-search.mjs --live [--usage] [--limit 25]
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
if (!args.includes('--live')) {
  console.log('Medición real: agrega --live (gasta créditos del proveedor). Uso: APOLLO_API_KEY=... node scripts/measure-cowork-search.mjs --live [--usage] [--limit 25]');
  process.exit(0);
}
if (!String(process.env.APOLLO_API_KEY || '').trim()) {
  console.error('Falta APOLLO_API_KEY en el entorno. Este script no lee archivos .env.');
  process.exit(1);
}
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? Math.max(1, Math.min(100, Number(args[limitArg + 1]) || 25)) : 25;

// The offers of the organizations that use the app today (src/lib/search/search-guidance.ts) and the AXIS test of 1 Oct.
const OFFERS = [
  { name: 'Revisión de antecedentes (prueba del 1 oct)', industries: ['servicios', 'outsourcing', 'seguridad'],
    titles: ['Gerente de Recursos Humanos', 'Jefe de Personas', 'Jefe de Reclutamiento'], decision: ['gerente de recursos humanos', 'jefe de personas', 'jefe de reclutamiento', 'gerente general'] },
  { name: 'GrupoExpro: outsourcing y BPO', industries: ['logística', 'centro de distribución', 'contact center', 'bodega'],
    titles: ['Gerente de Operaciones', 'Jefe de Logística', 'Gerente de Servicio al Cliente'], decision: ['gerente de operaciones', 'jefe de logística', 'gerente de servicio al cliente', 'gerente general'] },
  { name: 'PSOL: evaluaciones psicolaborales', industries: ['retail', 'servicios transitorios', 'contact center', 'seguridad'],
    titles: ['Jefe de Selección', 'Gerente de Recursos Humanos', 'Talent Acquisition'], decision: ['jefe de selección', 'gerente de recursos humanos', 'talent acquisition'] },
];

// The real search code and provider client; the database, quota and access modules are never reached here.
const stubs = {
  '@/lib/server/supabase-admin': 'export const getSupabaseAdminClient=()=>{throw new Error("no database in a measurement")};',
  '@/lib/server/daily-quota-store': 'export const getEffectiveDailyQuotaLimits=async()=>{throw new Error("no quota in a measurement")};export const checkAndConsumeDailyQuota=getEffectiveDailyQuotaLimits;',
  './access': 'export const requireCoworkWorkerAccess=async()=>{throw new Error("no access check in a measurement")};',
  './effects': 'export const admitCoworkContinuation=async()=>null;',
};
const bundle = await build({
  stdin: { contents: `export { runCoworkSearch, normalizeCoworkSearchResult } from './src/lib/server/cowork/external-search';
    export { requestApolloSearch } from './src/lib/server/apollo-search-client';
    export { coworkApolloPayload, coworkSearchCriteriaSchema } from './src/lib/cowork/search-proposal';
    export { getApolloUsageSnapshot } from './src/lib/server/apollo-provider/apollo';
    export { getGatewayConfig } from './src/lib/server/apollo-provider/gateway';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'measurement-stubs', setup(context) {
    context.onResolve({ filter: /.*/ }, input => stubs[input.path] ? { path: input.path, namespace: 'stub' } : undefined);
    context.onLoad({ filter: /.*/, namespace: 'stub' }, input => ({ contents: stubs[input.path] }));
  } }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const search = loaded.exports;

const usage = async () => args.includes('--usage')
  ? search.getApolloUsageSnapshot(process.env.APOLLO_API_KEY, search.getGatewayConfig(process.env)).then(snapshot => snapshot.credit_usage).catch(error => `sin datos (${error.message})`)
  : null;
const startUsage = await usage();
const rows = [];
for (const offer of OFFERS) {
  const criteria = search.coworkSearchCriteriaSchema.parse({ titles: offer.titles, industries: offer.industries, locations: ['Chile'], limit,
    rolePolicy: { decisionTerms: offer.decision, userTerms: [], referralTerms: ['analista', 'coordinador'], excludeTerms: ['práctica', 'practicante'] } });
  let calls = 0;
  const counted = payload => { calls++; return search.requestApolloSearch(payload); };
  // Before: the payload Cowork sent until this PR (one people search, exact titles).
  let before = null;
  try {
    const old = { ...search.coworkApolloPayload({ ...criteria, strategy: 'people' }, 'measurement'), include_similar_titles: false };
    before = search.normalizeCoworkSearchResult(await counted(old), limit, 'people', criteria.rolePolicy);
  } catch (error) { before = { error: error.message }; }
  const beforeCalls = calls;
  let after = null;
  const started = Date.now();
  try { after = await search.runCoworkSearch(criteria, 'measurement', counted); } catch (error) { after = { error: error.message }; }
  const buyers = after?.items?.filter(item => item.role === 'decision_maker_candidate').length ?? 0;
  rows.push({
    oferta: offer.name,
    antes: before.error ? `error: ${before.error}` : before.items.length,
    ahora: after.error ? `error: ${after.error}` : after.items.length,
    compradores: buyers,
    empresas: after.companies ? `${after.companies.withPeople} con personas de ${after.companies.found}` : '-',
    candidatos: after.candidates ?? '-',
    'traer más': after.next ? JSON.stringify(after.next) : 'no',
    llamadas: `${beforeCalls} antes, ${calls - beforeCalls} ahora`,
    segundos: Math.round((Date.now() - started) / 100) / 10,
  });
  if (after.items?.length) {
    console.log(`\n${offer.name}: los primeros 5`);
    for (const item of after.items.slice(0, 5)) console.log(`  - ${item.name} · ${item.title} · ${item.company} — ${item.fit}`);
  }
}
console.log('');
console.table(rows);
const endUsage = await usage();
if (startUsage !== null) {
  console.log('\nCréditos del proveedor antes:', JSON.stringify(startUsage));
  console.log('Créditos del proveedor después:', JSON.stringify(endUsage));
}
console.log(`\nMeta: 20 o más personas por oferta con limit ${limit} (antes de este cambio, la prueba del 1 oct trajo 2 de 25).`);
