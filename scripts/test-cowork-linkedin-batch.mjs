// Approving several LinkedIn invitations or messages at once: staging with the brakes of a single action, who goes today and who waits,
// the card, taking people off before the approval, and the approved run person by person. In-memory tables: no provider, secret or env file,
// and nothing is ever queued in a real database or sent.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const RUN = '00000000-0000-4000-8000-000000000010';
const ORIGIN = '00000000-0000-4000-8000-000000000011';
const L = n => `00000000-0000-4000-8000-0000000000a${n}`;
const USER = 'owner';
const ORG = 'org';
const hourAgo = () => new Date(Date.now() - 3600000).toISOString();

const lead = (n, name, company, slug, extra = {}) => ({ id: L(n), organization_id: ORG, name, email: slug ? `${slug.split('-')[0]}@${company.toLowerCase().replace(/\s/g, '')}.cl` : null,
  title: 'Gerente', company, linkedin_url: slug ? `https://www.linkedin.com/in/${slug}` : null, ...extra });
const leads = () => [
  lead(1, 'Ana Pérez', 'Servicios Norte', 'ana-perez'),
  lead(2, 'Luis García', 'Servicios Norte', 'luis-garcia'),
  lead(3, 'Eva Soto', 'Casino Central', 'eva-soto'),
  lead(4, 'Teo Ríos', 'Alimentos del Valle', 'teo-rios'),
  lead(5, 'Sin Perfil', 'Transportes Sur', null),
  lead(6, 'Marta Lagos', 'Retail Uno', 'otra-persona-distinta'),
];

const state = {
  runStatus: 'running', leads: leads(), events: [], jobs: [], batch: null, proposal: null, stages: [], companyReply: false,
  touchedByEmail: new Set(), emailSendsThrow: false, updates: 0,
};
globalThis.__liBatch = state;
const seen = ids => [{ run_id: ORIGIN, user_id: USER, organization_id: ORG, kind: 'tool.completed', payload: { action: 'leads.search', input: 'lista', result: { scope: 'own_saved_contacts',
  items: ids.map(id => ({ id, name: 'x' })) } } }];
const reset = () => {
  state.runStatus = 'running'; state.leads = leads(); state.jobs = []; state.batch = null; state.proposal = null; state.stages = [];
  state.companyReply = false; state.touchedByEmail = new Set(); state.events = seen([1, 2, 3, 4, 5, 6].map(L));
};

function table(name) {
  const s = globalThis.__liBatch;
  const q = { eq: [], in: [], gte: [], not: [], head: false, limit: null, patch: null };
  const rowsOf = () => {
    const source = name === 'leads' ? s.leads : name === 'cowork_linkedin_jobs' ? s.jobs : name === 'cowork_run_events' ? s.events
      : name === 'unified_crm_data' ? s.stages : [];
    return source.filter(row => q.eq.every(([c, v]) => row[c] === v) && q.in.every(([c, list]) => list.includes(row[c]))
      && q.gte.every(([c, v]) => String(row[c] || '') >= String(v))
      && q.not.every(([c, op, v]) => op === 'is' ? row[c] != null : !String(v).replace(/[()]/g, '').split(',').includes(String(row[c]))));
  };
  const single = () => {
    if (name === 'cowork_runs') return { data: { status: s.runStatus }, error: null };
    if (name === 'cowork_effect_proposals') return { data: s.proposal, error: null };
    if (name === 'cowork_batch_proposals') return { data: s.batch && q.eq.every(([c, v]) => s.batch[c] === v) ? { ...s.batch } : null, error: null };
    const rows = rowsOf();
    return { data: rows[0] ?? null, error: null };
  };
  const b = {
    select: (_cols, options) => { if (options && options.head) q.head = true; return b; },
    eq: (c, v) => { q.eq.push([c, v]); return b; },
    in: (c, list) => { q.in.push([c, list]); return b; },
    gte: (c, v) => { q.gte.push([c, v]); return b; },
    not: (c, op, v) => { q.not.push([c, op, v]); return b; },
    limit: n => { q.limit = n; return b; },
    maybeSingle: async () => {
      if (q.patch && name === 'cowork_batch_proposals') {
        // The table's guard: people can be taken off only while the proposal awaits the decision.
        if (!s.batch) return { data: null, error: null };
        if (!s.proposal || s.proposal.status !== 'proposed') return { data: null, error: { code: '23514', message: 'People can only be removed' } };
        s.updates++;
        Object.assign(s.batch, q.patch);
        return { data: { run_id: s.batch.run_id }, error: null };
      }
      if (q.upsert) return q.upsert();
      return single();
    },
    update: patch => { q.patch = patch; return b; },
    upsert: (values, options) => {
      q.upsert = () => {
        if (name === 'cowork_batch_proposals') {
          if (s.batch && options.ignoreDuplicates) return { data: null, error: null };
          s.batch = JSON.parse(JSON.stringify({ excluded: [], deferred: [], ...values }));
          return { data: { run_id: values.run_id }, error: null };
        }
        if (name === 'cowork_linkedin_jobs') {
          const dup = s.jobs.find(job => job.organization_id === values.organization_id && job.user_id === values.user_id && job.idempotency_key === values.idempotency_key);
          if (dup && options.ignoreDuplicates) return { data: null, error: null };
          const row = { id: `job-${s.jobs.length + 1}`, created_at: new Date().toISOString(), ...values };
          s.jobs.push(row);
          return { data: { id: row.id, status: row.status }, error: null };
        }
        throw new Error(`unexpected upsert ${name}`);
      };
      return b;
    },
    then: (resolve, reject) => {
      const rows = rowsOf();
      return Promise.resolve({ data: q.head ? null : (q.limit ? rows.slice(0, q.limit) : rows), error: null, count: rows.length }).then(resolve, reject);
    },
  };
  return b;
}
state.table = table;

const sources = {
  '@/lib/server/supabase-admin': 'export const getSupabaseAdminClient=()=>({from:t=>globalThis.__liBatch.table(t)});',
  './access': 'export const requireCoworkWorkerAccess=async()=>{};',
  './runs': 'export const getCoworkRun=async()=>({run:{status:globalThis.__liBatch.runStatus},events:[]});',
  '@/lib/server/campaign-send-guards': `export const findCompanyReply=async()=>globalThis.__liBatch.companyReply?{stopped:true,email:"jefe@empresa.cl"}:{stopped:false};
    export const findNegotiationHold=async()=>({held:false});
    export const listCompanyKeysSentToday=async()=>{const s=globalThis.__liBatch;if(s.emailSendsThrow)throw new Error("Historial de envíos incompleto.");return new Set(s.touchedByEmail);};`,
};
const bundle = await build({ entryPoints: ['src/lib/server/cowork/linkedin-batch.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-services', setup(b) {
    b.onResolve({ filter: /.*/ }, args => sources[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: sources[args.path] }));
  } }] });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const api = loaded.exports;
const scope = { userId: USER, organizationId: ORG };
const auth = { user: { id: USER }, organizationId: ORG };
const flag = process.env.COWORK_LINKEDIN_BATCH_ENABLED;
process.env.COWORK_LINKEDIN_BATCH_ENABLED = 'true';
const ids = (...ns) => ns.map(L);
const invites = (...ns) => ({ leads: ns.map(n => ({ leadId: L(n) })) });
const refuse = (kind, input, pattern) => assert.rejects(api.stageCoworkLinkedinBatch(scope, RUN, ORIGIN, kind, input), pattern);
const approve = (effectKind, hash, patch = {}) => { state.proposal = { status: 'executing', kind: effectKind, target_id: `linkedinbatch:${hash}`, ...patch }; state.runStatus = 'waiting_approval'; };

try {
  // 1. What cannot be proposed at all is refused with the way out.
  reset();
  await refuse('invite', { leads: [{ leadId: L(1), message: 'Hola' }] }, /Las invitaciones van sin nota/);
  await refuse('message', { leads: [{ leadId: L(1) }] }, /necesita su propio texto/);
  await refuse('invite', { leads: [{ leadId: L(1) }, { leadId: L(1) }] }, /repetidas/);
  await refuse('invite', { leads: [] }, /too_small|at least|Too small/i);
  state.events = seen([L(1)]);
  await refuse('invite', invites(1, 2), /consultado antes/);
  state.events = seen(ids(1, 2, 3, 4, 5, 6).concat(L(9)));
  await refuse('invite', invites(1, 9), /contactos de tu organización/);
  assert.equal(state.batch, null, 'nothing is staged by a refusal');
  reset();
  state.runStatus = 'completed';
  await refuse('invite', invites(1), /ya no admite propuestas/);

  // 2. Invitations: the first of each company goes, and everyone who does not says why.
  reset();
  const staged = await api.stageCoworkLinkedinBatch(scope, RUN, ORIGIN, 'invite', invites(1, 2, 3, 4, 5, 6));
  assert.match(staged.hash, /^[a-f0-9]{64}$/);
  assert.equal(staged.label, 'Invitar a 3 personas en LinkedIn');
  assert.deepEqual([staged.count, staged.deferred], [3, 3]);
  assert.equal(state.batch.kind, 'linkedin_invite_batch');
  assert.deepEqual(state.batch.items.map(item => item.id), ids(1, 3, 4));
  assert.ok(state.batch.items.every(item => !('message' in item)), 'invitations carry no note');
  assert.deepEqual(state.batch.items[0], { id: L(1), name: 'Ana Pérez', company: 'Servicios Norte', title: 'Gerente', canonicalUrl: 'https://www.linkedin.com/in/ana-perez' });
  const why = Object.fromEntries(state.batch.deferred.map(item => [item.id, item.reason]));
  assert.match(why[L(2)], /Otra persona de esa empresa va hoy en este lote/);
  assert.match(why[L(5)], /no tiene una URL de perfil LinkedIn válida/);
  assert.match(why[L(6)], /nombre no corresponde|no corresponde/);
  assert.deepEqual(state.jobs, [], 'staging queues nothing');
  // The same proposal again keeps it; another list in the same work is refused.
  assert.equal((await api.stageCoworkLinkedinBatch(scope, RUN, ORIGIN, 'invite', invites(1, 2, 3, 4, 5, 6))).hash, staged.hash);
  await refuse('invite', invites(1, 3), /otro lote/);

  // 3. The brakes: the weekly quota, a company with something out today (email or LinkedIn) and a profile already invited.
  reset();
  for (let n = 0; n < 98; n++) state.jobs.push({ id: `old-${n}`, organization_id: ORG, user_id: USER, kind: 'invite', status: 'queued', idempotency_key: `k${n}`.padEnd(64, '0'), created_at: hourAgo(), canonical_url: `https://www.linkedin.com/in/x-${n}` });
  await api.stageCoworkLinkedinBatch(scope, RUN, ORIGIN, 'invite', invites(1, 3, 4));
  assert.deepEqual(state.batch.items.map(item => item.id), ids(1, 3), 'only what is left of the weekly quota goes');
  assert.match(state.batch.deferred[0].reason, /cupo semanal/);
  reset();
  state.touchedByEmail = new Set(['domain:casinocentral.cl']);
  state.jobs.push({ id: 'today', organization_id: ORG, user_id: USER, kind: 'message', status: 'confirmed', idempotency_key: 'a'.repeat(64), company_key: 'domain:alimentosdelvalle.cl', created_at: new Date().toISOString(), canonical_url: 'https://www.linkedin.com/in/otra' });
  await api.stageCoworkLinkedinBatch(scope, RUN, ORIGIN, 'invite', invites(1, 3, 4));
  assert.deepEqual(state.batch.items.map(item => item.id), [L(1)]);
  assert.ok(state.batch.deferred.every(item => /una empresa por día/.test(item.reason)), 'email and LinkedIn both count');
  reset();
  state.jobs.push({ id: 'dup', organization_id: ORG, user_id: USER, kind: 'invite', status: 'queued', idempotency_key: '', created_at: hourAgo(), canonical_url: 'https://www.linkedin.com/in/ana-perez' });
  state.jobs[0].idempotency_key = (await (async () => { const { createHash } = await import('node:crypto'); return createHash('sha256').update(`linkedin|invite|${ORG}|${USER}|https://www.linkedin.com/in/ana-perez`).digest('hex'); })());
  await api.stageCoworkLinkedinBatch(scope, RUN, ORIGIN, 'invite', invites(1, 3));
  assert.deepEqual(state.batch.items.map(item => item.id), [L(3)]);
  assert.match(state.batch.deferred[0].reason, /Ya hay una invitación registrada/);
  // Nobody can go: it says why instead of proposing an empty batch; a broken read of today's sends never reads as free.
  reset();
  state.touchedByEmail = new Set(['domain:serviciosnorte.cl', 'domain:casinocentral.cl']);
  await refuse('invite', invites(1, 3), /Nadie del lote puede salir hoy\. Ya hay una acción para esa empresa hoy/);
  assert.equal(state.batch, null);
  reset();
  state.emailSendsThrow = true;
  await refuse('invite', invites(1), /Historial de envíos incompleto/);
  state.emailSendsThrow = false;

  // 4. Messages: each with its own text, and the brakes of a single message hold one by one.
  reset();
  const texts = { leads: [{ leadId: L(1), message: 'Hola Ana, gracias por aceptar.' }, { leadId: L(3), message: 'Hola Eva, gracias por aceptar.' }] };
  const messages = await api.stageCoworkLinkedinBatch(scope, RUN, ORIGIN, 'message', texts);
  assert.equal(messages.label, 'Escribir a 2 personas en LinkedIn');
  assert.equal(state.batch.kind, 'linkedin_message_batch');
  assert.deepEqual(state.batch.items.map(item => item.message), ['Hola Ana, gracias por aceptar.', 'Hola Eva, gracias por aceptar.']);
  reset();
  state.companyReply = true;
  await refuse('message', texts, /Nadie del lote puede salir hoy\. Esta empresa ya respondió/);
  reset();
  state.stages = [{ id: `lead_saved|${L(1)}`, organization_id: ORG, stage: 'negotiation' }, { id: `lead_saved|${L(3)}`, organization_id: ORG, stage: 'contacted' }];
  await api.stageCoworkLinkedinBatch(scope, RUN, ORIGIN, 'message', texts);
  assert.deepEqual(state.batch.items.map(item => item.id), [L(3)], 'an account in negotiation waits');
  assert.match(state.batch.deferred[0].reason, /Mensaje retenido/);

  // 5. The card: who goes with what, who waits, who was taken off, whether it can still be changed, and whether it is the proposed list.
  reset();
  const pinned = await api.stageCoworkLinkedinBatch(scope, RUN, ORIGIN, 'invite', invites(1, 2, 3, 4));
  const target = `linkedinbatch:${pinned.hash}`;
  state.proposal = { status: 'proposed', kind: 'linkedin_invite_batch', target_id: target };
  let preview = await api.readCoworkLinkedinBatchPreview(auth, RUN, target);
  assert.equal(preview.kind, 'invite');
  assert.equal(preview.matches, true);
  assert.equal(preview.open, true);
  assert.deepEqual(preview.items.map(item => item.id), ids(1, 3, 4));
  assert.deepEqual(preview.deferred.map(item => item.id), [L(2)]);
  assert.deepEqual(preview.quota, { used: 0, limit: 100 });
  assert.equal(preview.results, null);
  assert.equal((await api.readCoworkLinkedinBatchPreview(auth, RUN, `linkedinbatch:${'f'.repeat(64)}`)).matches, false, 'another target does not match');
  state.batch.items[0].canonicalUrl = 'https://www.linkedin.com/in/otra-persona';
  assert.equal((await api.readCoworkLinkedinBatchPreview(auth, RUN, target)).matches, false, 'a list that is not the proposed one is flagged');
  state.batch.items[0].canonicalUrl = 'https://www.linkedin.com/in/ana-perez';
  state.batch = null;
  assert.equal(await api.readCoworkLinkedinBatchPreview(auth, RUN, target), null);

  // 6. Taking people off: only people of the batch, never all of them, and only while the proposal awaits the decision.
  reset();
  const open = await api.stageCoworkLinkedinBatch(scope, RUN, ORIGIN, 'invite', invites(1, 3, 4));
  const openTarget = `linkedinbatch:${open.hash}`;
  state.proposal = { status: 'proposed', kind: 'linkedin_invite_batch', target_id: openTarget };
  assert.deepEqual(await api.setCoworkLinkedinBatchExclusions(auth, RUN, [L(3)]), { excluded: [L(3)] });
  assert.deepEqual(state.batch.excluded, [L(3)]);
  assert.deepEqual((await api.readCoworkLinkedinBatchPreview(auth, RUN, openTarget)).excluded, [L(3)]);
  await assert.rejects(api.setCoworkLinkedinBatchExclusions(auth, RUN, [L(2)]), /Solo se puede quitar a personas del lote/);
  await assert.rejects(api.setCoworkLinkedinBatchExclusions(auth, RUN, ids(1, 3, 4)), /Quitaste a todas las personas/);
  await assert.rejects(api.setCoworkLinkedinBatchExclusions(auth, RUN, [L(3), L(3)]), /repetidas/);
  await assert.rejects(api.setCoworkLinkedinBatchExclusions(auth, RUN, ['no-es-un-id']), /uuid|Invalid/i);
  assert.deepEqual(await api.setCoworkLinkedinBatchExclusions(auth, RUN, []), { excluded: [] }, 'a person put back is included again');
  await api.setCoworkLinkedinBatchExclusions(auth, RUN, [L(3)]);
  state.proposal = { ...state.proposal, status: 'approved' };
  await assert.rejects(api.setCoworkLinkedinBatchExclusions(auth, RUN, []), /ya se decidió/);
  assert.deepEqual(state.batch.excluded, [L(3)], 'after the approval the list of who was taken off stands');

  // 7. Executing: the flag stops it, the approval and the list must be the ones proposed, and nobody taken off is queued.
  reset();
  const run = await api.stageCoworkLinkedinBatch(scope, RUN, ORIGIN, 'invite', invites(1, 3, 4));
  approve('linkedin_invite_batch', run.hash);
  state.batch.excluded = [L(3)];
  delete process.env.COWORK_LINKEDIN_BATCH_ENABLED;
  await assert.rejects(api.executeCoworkLinkedinBatch(auth, RUN, `linkedinbatch:${run.hash}`, 'linkedin_invite_batch'), /desactivados por ahora: no se encoló nada/);
  process.env.COWORK_LINKEDIN_BATCH_ENABLED = 'true';
  await assert.rejects(api.executeCoworkLinkedinBatch(auth, RUN, 'sendbatch:abc', 'linkedin_invite_batch'), /no es válida/);
  await assert.rejects(api.executeCoworkLinkedinBatch(auth, RUN, `linkedinbatch:${run.hash}`, 'linkedin_anything'), /no es válida/);
  await assert.rejects(api.executeCoworkLinkedinBatch(auth, RUN, `linkedinbatch:${'f'.repeat(64)}`, 'linkedin_invite_batch'), /autorización del lote ya no está vigente/);
  state.proposal.status = 'proposed';
  await assert.rejects(api.executeCoworkLinkedinBatch(auth, RUN, `linkedinbatch:${run.hash}`, 'linkedin_invite_batch'), /autorización del lote ya no está vigente/);
  state.proposal.status = 'executing';
  state.batch.items[0].canonicalUrl = 'https://www.linkedin.com/in/otra';
  await assert.rejects(api.executeCoworkLinkedinBatch(auth, RUN, `linkedinbatch:${run.hash}`, 'linkedin_invite_batch'), /cambió desde tu revisión/);
  state.batch.items[0].canonicalUrl = 'https://www.linkedin.com/in/ana-perez';
  state.runStatus = 'failed';
  await assert.rejects(api.executeCoworkLinkedinBatch(auth, RUN, `linkedinbatch:${run.hash}`, 'linkedin_invite_batch'), /ya no está disponible en este trabajo/);
  state.runStatus = 'waiting_approval';
  assert.deepEqual(state.jobs, [], 'nothing was queued in any refusal');

  const done = await api.executeCoworkLinkedinBatch(auth, RUN, `linkedinbatch:${run.hash}`, 'linkedin_invite_batch');
  assert.deepEqual(state.jobs.map(job => [job.kind, job.display_name, job.message, job.company_key, job.status]), [
    ['invite', 'Ana Pérez', null, 'domain:serviciosnorte.cl', 'queued'],
    ['invite', 'Teo Ríos', null, 'domain:alimentosdelvalle.cl', 'queued'],
  ]);
  assert.deepEqual(done.result.items.map(item => [item.name, item.status]), [['Ana Pérez', 'queued'], ['Eva Soto', 'removed'], ['Teo Ríos', 'queued']]);
  assert.equal(done.result.queued, 2);
  assert.match(done.reply, /^Quedaron listas 2 de 3 invitaciones\. Para enviar cada invitación: abre cada perfil en LinkedIn, abre la extensión de ANTON\.IA, toca «Consultar trabajos» y luego «Ejecutar»\. Nada sale solo; vence en 7 días si no lo ejecutas\. Quitaste a 1 persona de la lista\.$/);
  assert.ok(state.jobs.every(job => job.run_id === RUN && job.user_id === USER && job.organization_id === ORG));

  // 8. Each person is checked again when it runs: a profile that changed, a company with something out since, the quota, a stopped account.
  reset();
  const again = await api.stageCoworkLinkedinBatch(scope, RUN, ORIGIN, 'invite', invites(1, 3, 4));
  approve('linkedin_invite_batch', again.hash);
  state.leads.find(item => item.id === L(1)).linkedin_url = 'https://www.linkedin.com/in/ana-perez-otra';
  state.touchedByEmail = new Set(['domain:casinocentral.cl']);
  const partial = await api.executeCoworkLinkedinBatch(auth, RUN, `linkedinbatch:${again.hash}`, 'linkedin_invite_batch');
  assert.deepEqual(partial.result.items.map(item => [item.name, item.status]), [['Ana Pérez', 'skipped'], ['Eva Soto', 'skipped'], ['Teo Ríos', 'queued']]);
  assert.match(partial.result.items[0].reason, /perfil del contacto cambió|no corresponde|no coincide/);
  assert.match(partial.result.items[1].reason, /una empresa por día/);
  assert.match(partial.reply, /^Quedaron listas 1 de 3 invitaciones\..* 2 no salieron: el motivo está en cada persona\.$/);
  assert.equal(state.jobs.length, 1);
  // If nobody can be queued, the effect fails with the reasons instead of reporting a batch that did nothing.
  reset();
  const none = await api.stageCoworkLinkedinBatch(scope, RUN, ORIGIN, 'invite', invites(1, 3));
  approve('linkedin_invite_batch', none.hash);
  state.touchedByEmail = new Set(['domain:serviciosnorte.cl', 'domain:casinocentral.cl']);
  await assert.rejects(api.executeCoworkLinkedinBatch(auth, RUN, `linkedinbatch:${none.hash}`, 'linkedin_invite_batch'), /No se encoló nada del lote\. Ya hay una acción para esa empresa hoy/);
  assert.equal(state.jobs.length, 0);
  // The quota of the week is counted as the jobs go in: the batch cannot pass it.
  reset();
  const quotaRun = await api.stageCoworkLinkedinBatch(scope, RUN, ORIGIN, 'invite', invites(1, 3, 4));
  approve('linkedin_invite_batch', quotaRun.hash);
  for (let n = 0; n < 98; n++) state.jobs.push({ id: `old-${n}`, organization_id: ORG, user_id: USER, kind: 'invite', status: 'queued', idempotency_key: `k${n}`.padEnd(64, '0'), created_at: hourAgo(), canonical_url: `https://www.linkedin.com/in/x-${n}` });
  const capped = await api.executeCoworkLinkedinBatch(auth, RUN, `linkedinbatch:${quotaRun.hash}`, 'linkedin_invite_batch');
  assert.deepEqual(capped.result.items.map(item => item.status), ['queued', 'queued', 'skipped']);
  assert.match(capped.result.items[2].reason, /Cupo semanal cubierto/);

  // 9. Messages run with the approved text, and the brakes are checked again.
  reset();
  const sendRun = await api.stageCoworkLinkedinBatch(scope, RUN, ORIGIN, 'message', texts);
  approve('linkedin_message_batch', sendRun.hash);
  const sent = await api.executeCoworkLinkedinBatch(auth, RUN, `linkedinbatch:${sendRun.hash}`, 'linkedin_message_batch');
  assert.deepEqual(state.jobs.map(job => [job.kind, job.display_name, job.message]), [
    ['message', 'Ana Pérez', 'Hola Ana, gracias por aceptar.'], ['message', 'Eva Soto', 'Hola Eva, gracias por aceptar.'],
  ]);
  assert.match(sent.reply, /^Quedaron listas 2 de 2 mensajes\. Para enviar cada mensaje: abre cada perfil en LinkedIn, abre la extensión de ANTON\.IA/);
  // Approving it again queues nothing new: the jobs are found by their keys.
  state.proposal = { status: 'executing', kind: 'linkedin_message_batch', target_id: `linkedinbatch:${sendRun.hash}` };
  state.touchedByEmail = new Set();
  const replay = await api.executeCoworkLinkedinBatch(auth, RUN, `linkedinbatch:${sendRun.hash}`, 'linkedin_message_batch');
  assert.deepEqual(replay.result.items.map(item => item.status), ['reused', 'reused']);
  assert.equal(state.jobs.length, 2);
  // The company answered, or the account is negotiating, between the proposal and the approval.
  reset();
  const late = await api.stageCoworkLinkedinBatch(scope, RUN, ORIGIN, 'message', texts);
  approve('linkedin_message_batch', late.hash);
  state.companyReply = true;
  await assert.rejects(api.executeCoworkLinkedinBatch(auth, RUN, `linkedinbatch:${late.hash}`, 'linkedin_message_batch'), /No se encoló nada del lote\. Esta empresa ya respondió/);
  assert.equal(state.jobs.length, 0);
  console.log('PASS: a LinkedIn batch keeps the brakes of each single action, one company a day across email and LinkedIn, people can be taken off only before the approval, and the run reports person by person.');
} finally {
  delete globalThis.__liBatch;
  if (flag === undefined) delete process.env.COWORK_LINKEDIN_BATCH_ENABLED; else process.env.COWORK_LINKEDIN_BATCH_ENABLED = flag;
}
