// Real Claude, the assistant of Oportunidades with its agent on (OPPORTUNITIES_RUNTIME=harness), on a workspace in memory: eight opportunities, a report,
// the purchase plan and two contracts. Seven questions of a member and an administrator, each read by hand afterwards and checked for what the answer must
// say and not say. The database and the ledger are in memory; nothing but Anthropic is called. Explicit opt-in only. Never loads env files.
//
//   ANTHROPIC_API_KEY=... node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-opportunities-assistant.ts --live
//   (with the spend guard in front: node --import ./scripts/spend-guard.mjs --loader ./scripts/ts-test-loader.mjs ...)
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { anthropicModel } from '@/lib/agent-harness/index';

async function load() {
  const stubs: Record<string, string> = {
    '@/lib/server/auth-utils': 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}',
    './workspace-access': 'export async function assertOpportunityRead(client, scope, id){ if (globalThis.__unreadable?.includes(id)) throw new Error("no access") } export function assertOpportunityAdmin(){} export async function readableOpportunityIds(client, scope){ return globalThis.__readable ?? null }',
    './workspace-ai': 'export async function opportunityGenerate(){ throw new Error("single call not used here") } export const PRICING_VERSION = "t"; export function prices(){ return { input: .1, output: .5, cache: .01, write: .2 } }'
      + ' export async function reserveOpportunityStep(client, job, input){ (globalThis.__steps ||= []).push(input); return { fresh: true, id: "res-" + globalThis.__steps.length } }'
      + ' export async function settleOpportunityStep(client, id, cost){ (globalThis.__settled ||= []).push([id, cost]) }',
  };
  const bundle = await build({
    stdin: { contents: `export * from './src/lib/server/commercial-opportunities/workspace-assistant';`, loader: 'ts', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    plugins: [{ name: 'stubs', setup(builder) {
      const filter = new RegExp(`(${Object.keys(stubs).map(name => name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
      builder.onResolve({ filter }, args => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: stubs[Object.keys(stubs).find(name => args.path.endsWith(name))!] }));
    } }],
  });
  const compiled: { exports: any } = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  return compiled.exports;
}

function memory(seed: Record<string, any[]>, list: (args: any) => any[]) {
  let serial = 0; let clock = Date.parse('2026-10-24T12:00:00Z');
  const tables: Record<string, any[]> = { opportunity_assistant_threads: [], opportunity_assistant_messages: [], opportunity_jobs: [], opportunity_work: [], opportunity_company_context: [],
    opportunity_purchase_plan: [], opportunity_chat_messages: [], commercial_opportunities: [], organization_members: [], opportunity_tender_profile: [], opportunity_company_documents: [],
    opportunity_reports: [], ...seed };
  const defaults = (name: string) => { const at = new Date(clock += 1000).toISOString(); return name === 'opportunity_jobs' ? { state: 'queued', error: null, created_at: at } : { created_at: at, updated_at: at, answer: null }; };
  const query = (name: string) => {
    const filters: Array<(row: any) => boolean> = []; const sorts: Array<{ key: string; ascending: boolean }> = [];
    let action: { kind: string; values?: any; conflict?: string[]; ignore?: boolean } = { kind: 'select' };
    const run = () => {
      const match = (row: any) => filters.every(filter => filter(row));
      if (action.kind === 'insert') { const added = ([] as any[]).concat(action.values).map(value => ({ id: `${name.split('_').at(-1)}-${++serial}`, ...defaults(name), ...value })); tables[name].push(...added); return { data: added, error: null }; }
      if (action.kind === 'upsert') {
        for (const value of ([] as any[]).concat(action.values)) {
          const index = tables[name].findIndex(row => action.conflict!.every(key => row[key] === value[key]));
          if (index >= 0 && action.ignore) continue;
          if (index >= 0) tables[name][index] = { ...tables[name][index], ...value }; else tables[name].push({ id: `${name.split('_').at(-1)}-${++serial}`, ...defaults(name), ...value });
        }
        return { data: null, error: null };
      }
      if (action.kind === 'update') { tables[name] = tables[name].map(row => match(row) ? { ...row, ...action.values } : row); return { data: null, error: null }; }
      if (action.kind === 'delete') { tables[name] = tables[name].filter(row => !match(row)); return { data: null, error: null }; }
      const found = tables[name].filter(match);
      for (const sort of [...sorts].reverse()) found.sort((a, b) => (a[sort.key] < b[sort.key] ? -1 : a[sort.key] > b[sort.key] ? 1 : 0) * (sort.ascending ? 1 : -1));
      return { data: found, error: null };
    };
    const first = () => { const result = run(); return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error }; };
    const builder: any = {
      select: () => builder, insert: (values: any) => { action = { kind: 'insert', values }; return builder; },
      upsert: (values: any, opts: any) => { action = { kind: 'upsert', values, conflict: String(opts.onConflict).split(','), ignore: Boolean(opts.ignoreDuplicates) }; return builder; },
      update: (values: any) => { action = { kind: 'update', values }; return builder; }, delete: () => { action = { kind: 'delete' }; return builder; },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return builder; }, in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return builder; },
      lt: (key: string, value: any) => { filters.push(row => row[key] < value); return builder; },
      not: (key: string, operator: string, value: unknown) => { filters.push(row => !(operator === 'is' && value === null ? row[key] === null || row[key] === undefined : row[key] === value)); return builder; },
      order: (key: string, opts?: { ascending?: boolean }) => { sorts.push({ key, ascending: opts?.ascending !== false }); return builder; }, limit: () => builder,
      maybeSingle: async () => first(), single: async () => first(), then: (resolve: (value: unknown) => void) => resolve(run()),
    };
    return builder;
  };
  const rpc = async (name: string, args: any) => name === 'opportunity_workspace_list' ? { data: list(args), error: null } : { data: null, error: null };
  return { tables, client: { from: query, rpc } as any };
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const op = (id: string, title: string, buyer: string, days: number | null, evaluation: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'tender', title, company_name: null, buyer_name: buyer,
  company_domain: null, url: null, score: evaluation === 'recommended' ? 82 : 40, reasons: ['Calza con la oferta'], deadline_at: days === null ? null : inDays(days), amount: null, currency: 'CLP', data: { evaluation }, updated_at: '2026-10-23T00:00:00Z', ...extra });
const ITEMS = [
  op('00000000-0000-4000-8000-000000000001', 'Servicio de aseo Hospital de Castro', 'Hospital de Castro', 2, 'recommended', { amount: 48_000_000 }),
  op('00000000-0000-4000-8000-000000000002', 'Guardias de seguridad Municipalidad de Puerto Montt', 'Municipalidad de Puerto Montt', 3, 'recommended', { amount: 120_000_000 }),
  op('00000000-0000-4000-8000-000000000003', 'Cámaras de televigilancia Municipalidad de Ancud', 'Municipalidad de Ancud', 12, 'recommended'),
  op('00000000-0000-4000-8000-000000000004', 'Mantención de áreas verdes Serviu Los Lagos', 'Serviu Los Lagos', 20, 'review'),
  op('00000000-0000-4000-8000-000000000005', 'Suministro de uniformes Ejército', 'Ejército de Chile', 25, 'review'),
  op('00000000-0000-4000-8000-000000000006', 'Aseo industrial Universidad de Los Lagos', 'Universidad de Los Lagos', 9, 'review'),
  op('00000000-0000-4000-8000-000000000007', 'Monitoreo de alarmas Hospital de Ancud', 'Hospital de Ancud', 15, 'review'),
  op('00000000-0000-4000-8000-000000000008', 'Servicio de casino Gendarmería', 'Gendarmería', 40, 'excluded'),
];
const list = (args: any) => {
  const words = plain(String(args.p_query || '')).split(/\s+/).filter(Boolean);
  return ITEMS.filter(item => (args.p_view === 'recommended' ? item.data.evaluation === 'recommended' : true))
    .filter(item => !words.length || words.some(word => plain(`${item.title} ${item.buyer_name}`).includes(word)));
};
const month = Number(new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: 'America/Santiago' }).format(new Date()));
const seed = {
  organization_members: [{ organization_id: 'org', user_id: 'u1', role: 'member' }, { organization_id: 'org', user_id: 'a1', role: 'admin' }],
  opportunity_company_context: [{ organization_id: 'org', offer: 'Aseo industrial, guardias y monitoreo de cámaras para organismos públicos del sur de Chile', services: ['Aseo', 'Guardias', 'Monitoreo de cámaras'] }],
  opportunity_purchase_plan: [
    { organization_id: 'org', year: 2026, institution: 'Hospital Grande de Castro', description: 'Servicio de aseo y sanitización', amount: 90_000_000, month },
    { organization_id: 'org', year: 2026, institution: 'Municipalidad de Ancud', description: 'Cámaras de televigilancia', amount: 40_000_000, month: Math.min(12, month + 1) },
  ],
  opportunity_jobs: [{ organization_id: 'org', kind: 'contracts', state: 'ready', created_at: '2026-10-18T10:00:00Z',
    result: { contracts: [{ agency: 'Hospital de Puerto Montt', name: 'Servicio de aseo', endsOn: '2026-12-01', winnerName: 'Aseos del Sur', amount: 5_000_000, currency: 'CLP' },
      { agency: 'Municipalidad de Castro', name: 'Mantención de cámaras', endsOn: '2027-01-15', winnerName: null, amount: null, currency: 'CLP' }] } }],
  commercial_opportunities: ITEMS.map(item => ({ ...item, organization_id: 'org' })),
  opportunity_reports: [{ organization_id: 'org', opportunity_id: ITEMS[0].id, created_at: '2026-10-22T10:00:00Z',
    report: { recommendation: 'conditional', executive: 'Conviene postular si se logra la boleta de garantía a tiempo.', nextSteps: ['Pedir la boleta de garantía', 'Preparar el anexo económico'], questions: [],
      requirements: [{ title: 'Boleta de garantía de seriedad de la oferta', status: 'pending' }, { title: 'Certificado F30-1 vigente', status: 'supported' }], milestones: [{ label: 'Cierre de ofertas', date: inDays(2) }] } }],
};
const QUESTIONS: Array<{ id: string; role: 'member' | 'admin'; user: string; question: string; expect: RegExp[]; forbid?: RegExp[] }> = [
  { id: 'cierran-pronto', role: 'member', user: 'u1', question: '¿Qué licitaciones cierran en los próximos 3 días?', expect: [/aseo/, /guardias/], forbid: [/uniformes/, /casino/] },
  { id: 'camaras', role: 'member', user: 'u1', question: '¿Hay algo de cámaras de seguridad o televigilancia?', expect: [/ancud/] },
  { id: 'requisitos-informe', role: 'member', user: 'u1', question: '¿Qué requisitos tiene la licitación de aseo del Hospital de Castro?', expect: [/garant/, /f30/] },
  { id: 'demanda-admin', role: 'admin', user: 'a1', question: '¿Qué planea comprar el Hospital de Castro este año?', expect: [/aseo/] },
  { id: 'contratos-admin', role: 'admin', user: 'a1', question: '¿Qué contratos de aseo vencen pronto?', expect: [/puerto montt/, /diciembre|2026-12|1 de dic/] },
  { id: 'saludo', role: 'member', user: 'u1', question: 'Hola', expect: [/ayud|hola/] },
  { id: 'sin-dato', role: 'member', user: 'u1', question: '¿Cuántos oferentes participaron en la licitación de uniformes del Ejército?', expect: [/no (tengo|encuentro|dispongo|aparece|figura|puedo)|sin (dato|informaci)|no hay/] },
];

async function main() {
  if (!process.argv.includes('--live') || !String(process.env.ANTHROPIC_API_KEY || '').trim()) throw new Error('Requires --live and an explicit ANTHROPIC_API_KEY. The offline check is workspace-assistant.test.ts.');
  Object.assign(process.env, { OPPORTUNITIES_RUNTIME: 'harness' }); delete process.env.OPPORTUNITIES_CHAT_MODEL;
  const { askOpportunityAssistant, runOpportunityAssistant } = await load();
  const model = anthropicModel({ model: 'claude-haiku-5-5' });
  let pass = 0;
  for (const item of QUESTIONS) {
    (globalThis as any).__steps = []; (globalThis as any).__settled = [];
    const { tables, client } = memory(JSON.parse(JSON.stringify(seed)), list);
    const scope = { organizationId: 'org', userId: item.user, role: item.role };
    const { threadId } = await askOpportunityAssistant(client, scope, { question: item.question, requestId: `r-${item.id}` });
    const job = { id: `job-${item.id}`, organization_id: 'org', requested_by: item.user, opportunity_id: null, kind: 'assistant', payload: { requestId: `r-${item.id}`, threadId }, lease_token: 'l', state: 'running' };
    const started = Date.now();
    let saved: any = null; let error = '';
    try { saved = await runOpportunityAssistant(client, job, model); } catch (failure) { error = failure instanceof Error ? failure.message.slice(0, 200) : String(failure); }
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    const text = plain(`${saved?.answer || ''} ${(saved?.cards || []).map((card: any) => `${card.title} ${card.note || ''}`).join(' ')}`);
    const failed = error ? [`error: ${error}`] : [...item.expect.filter(pattern => !pattern.test(text)).map(pattern => `falta ${pattern}`), ...(item.forbid || []).filter(pattern => pattern.test(text)).map(pattern => `no debía decir ${pattern}`)];
    if (!failed.length) pass++;
    console.log(`\n${failed.length ? 'FAIL' : 'PASS'} ${item.id} (${item.role}) — ${(globalThis as any).__steps.length} rondas, ${seconds}s${failed.length ? ` — ${failed.join('; ')}` : ''}`);
    console.log(`  P: ${item.question}`);
    console.log(`  R: ${String(saved?.answer || error).replace(/\s+/g, ' ').slice(0, 520)}`);
    console.log(`  tarjetas: ${(saved?.cards || []).map((card: any) => card.title.slice(0, 40)).join(' | ') || '—'}; derivación: ${saved?.handoff ? saved.handoff.title.slice(0, 40) : '—'}; seguimientos: ${(saved?.followups || []).length}`);
    void tables;
  }
  console.log(`\nasistente con agente: ${pass}/${QUESTIONS.length}`);
}
main().catch(error => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
