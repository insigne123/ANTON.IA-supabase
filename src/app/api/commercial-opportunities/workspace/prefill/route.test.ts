import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// «Cargar oportunidad» from a received e-mail or from the pasted invitation (OPP-49), with the jobs table and the model in memory.
async function load(entry: string, stubs: Record<string, string>) {
  const bundle = await build({
    stdin: { contents: entry, loader: 'ts', resolveDir: process.cwd() },
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

type Job = { payload: { text?: string; name?: string; documents?: number } };
const state: { role: string; jobs: Job[] } = { role: 'admin', jobs: [] };
(globalThis as any).__prefill = state;

const client = {
  from: () => {
    const chain: any = {
      insert: (row: Job) => { state.jobs.push(row); return chain; },
      select: () => chain, update: () => chain, eq: () => chain, maybeSingle: () => chain,
      then: (resolve: (value: unknown) => void) => resolve({ data: { id: 'job-1', state: 'ready', result: { fields: { title: 'Guardias para 3 recintos' }, missing: ['monto'] } }, error: null }),
    };
    return chain;
  },
};
(globalThis as any).__prefillClient = client;

const loaded = load(`export { POST } from './src/app/api/commercial-opportunities/workspace/prefill/route';`, {
  '@/lib/server/auth-utils': 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}',
  '/workspace-access': `export async function requireOpportunityWorkspace(){ return { admin: globalThis.__prefillClient } }
    export function opportunityScope(){ return { organizationId: 'org-1', userId: 'user-1', role: globalThis.__prefill.role } }
    export function assertOpportunityAdmin(scope){ if (scope.role !== 'admin') { const { AuthError } = require('@/lib/server/auth-utils'); throw new AuthError('Solo un administrador carga oportunidades.', 403) } }
    export async function assertOpportunityRead(){}`,
  '/workspace-store': 'export function opportunityDb(result){ if (result && result.error) throw result.error; return result ? result.data ?? null : null }',
  '/workspace-jobs': 'export async function runQueuedOpportunityJobNow(){}',
  '/responses': `export const opportunitiesJson = (body, status = 200) => new Response(JSON.stringify(body), { status });
    export const opportunitiesError = error => new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 });`,
});

const post = async (form: FormData) => {
  const { POST } = await loaded;
  const response: Response = await POST(new Request('http://app.test/api/commercial-opportunities/workspace/prefill', { method: 'POST', body: form }));
  return { status: response.status, body: await response.json() };
};
const part = (name: string, type: string, text: string) => ['--mix', `Content-Type: ${type}; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`,
  'Content-Transfer-Encoding: base64', '', Buffer.from(text).toString('base64')];
const invitation = ['From: compras@muni.cl', 'Subject: Invitación guardias', 'Content-Type: multipart/mixed; boundary="mix"', '',
  '--mix', 'Content-Type: text/plain; charset=utf-8', '', 'Los invitamos a cotizar guardias para 3 recintos. Ofertas por la plataforma Coupa hasta el 30 de octubre.',
  ...part('Bases técnicas.txt', 'text/plain', 'Servicio de guardias 24/7 para 3 recintos municipales, con supervisor y rondas cada hora.'),
  ...part('Planos.rar', 'application/x-rar-compressed', 'rar'), '--mix--', ''].join('\r\n');

test('a received e-mail is read as its message and the documents it brings, and what it brings that cannot be read is named', async () => {
  state.role = 'admin'; state.jobs = [];
  const form = new FormData();
  form.append('file', new File([invitation], 'Invitación guardias.eml', { type: 'message/rfc822' }));
  const { status, body } = await post(form);
  assert.equal(status, 200);
  assert.deepEqual(body.fields, { title: 'Guardias para 3 recintos' });
  assert.deepEqual(body.read, ['Correo - Invitación guardias.txt', 'Bases técnicas.txt']);
  assert.deepEqual(body.skipped, [{ name: 'Planos.rar', why: 'Es otro comprimido (RAR o 7z): descomprímelo y sube lo que trae.' }]);
  const text = state.jobs[0].payload.text || '';
  assert.match(text, /^=== Documento «Correo - Invitación guardias\.txt» ===[\s\S]*plataforma Coupa[\s\S]*=== Documento «Bases técnicas\.txt» ===[\s\S]*rondas cada hora/);
  assert.equal(state.jobs[0].payload.documents, 2);
});

test('the invitation pasted in the form is read the same way; a few words are not enough', async () => {
  state.role = 'admin'; state.jobs = [];
  const form = new FormData();
  form.append('text', 'Estimados: los invitamos a cotizar el servicio de aseo para el hospital. Cierre: 30 de octubre a las 15:00.');
  const { status, body } = await post(form);
  assert.equal(status, 200);
  assert.deepEqual(body.read, ['Texto pegado.txt']);
  assert.match(state.jobs[0].payload.text || '', /servicio de aseo para el hospital/);

  const short = new FormData();
  short.append('text', 'Licitación de aseo');
  assert.deepEqual(await post(short), { status: 400, body: { error: 'Pega el texto completo de la invitación: con tan poco la IA no puede completar el formulario.' } });
  assert.deepEqual(await post(new FormData()), { status: 400, body: { error: 'Elige el documento que recibiste.' } });
});

test('only an administrator loads an opportunity', async () => {
  state.role = 'member'; state.jobs = [];
  const form = new FormData();
  form.append('text', 'Estimados: los invitamos a cotizar el servicio de aseo para el hospital. Cierre: 30 de octubre a las 15:00.');
  assert.equal((await post(form)).status, 403);
  assert.equal(state.jobs.length, 0);
});
