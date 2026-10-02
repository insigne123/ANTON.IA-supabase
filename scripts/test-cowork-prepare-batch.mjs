// «Preparar contactos» with one approval: staging with the real state of each person (what is done is skipped), the refusals the
// model reads, the single actions that say «ya está hecho», the card's removals and the approved run person by person (save, look
// up the email, research) with partial failures and quotas. In-memory tables: no provider, secret or env file, nothing real.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const RUN = '00000000-0000-4000-8000-000000000010';
const PARENT = '00000000-0000-4000-8000-000000000011';
const L = n => `00000000-0000-4000-8000-0000000000a${n}`;
const USER = 'owner';
const ORG = 'org';

const state = {};
globalThis.__prepBatch = state;
const searchEvent = (runId, items) => ({ run_id: runId, user_id: USER, organization_id: ORG, kind: 'tool.completed',
  payload: { action: 'prospecting.search', input: '', result: { scope: 'external_search', items } } });
const savedEvent = (runId, ids) => ({ run_id: runId, user_id: USER, organization_id: ORG, kind: 'tool.completed',
  payload: { action: 'leads.search', input: '', result: { scope: 'own_saved_contacts', items: ids.map(id => ({ id, name: 'x' })) } } });
const reset = () => Object.assign(state, {
  runStatus: 'running',
  runs: { [RUN]: { parent_run_id: PARENT }, [PARENT]: { parent_run_id: null } },
  leads: [
    { id: L(1), user_id: USER, organization_id: ORG, name: 'Susana Cáceres', company: 'MSTI', title: 'RR. HH.', email: null, apollo_id: 'susana', source_provider_id: 'susana' },
    { id: L(2), user_id: USER, organization_id: ORG, name: 'Ana Pérez', company: 'Acme', title: 'Gerente', email: 'ana@acme.cl', apollo_id: null, source_provider_id: null },
    { id: L(3), user_id: 'someone-else', organization_id: ORG, name: 'Otra Persona', company: 'Otra', title: 'Jefa', email: null, apollo_id: null, source_provider_id: null },
  ],
  enriched: [], research: [],
  // The search was in the turn before; the saved contacts in this one.
  events: [
    searchEvent(PARENT, [
      { id: 'apollo:rafael', name: 'Rafael Du***n', company: 'R&D Montajes', title: 'Jefe de Operaciones', linkedin_url: null, company_website: 'https://rdmontajes.cl' },
      { id: 'apollo:susana', name: 'Susana Ca***s', company: 'MSTI', title: 'RR. HH.' },
    ]),
    savedEvent(RUN, [L(1), L(2), L(3)]),
  ],
  batch: null, proposal: null, saves: [], lookups: [], researches: [], lookupError: null, researchError: null,
});

function table(name) {
  const s = globalThis.__prepBatch;
  const q = { eq: [], in: [], filter: [], patch: null };
  const source = () => name === 'leads' ? s.leads : name === 'cowork_run_events' ? s.events : name === 'enriched_leads' ? s.enriched
    : name === 'lead_research_jobs' ? s.research : [];
  const matches = row => q.eq.every(([c, v]) => row[c] === v) && q.in.every(([c, list]) => list.includes(row[c]))
    && q.filter.every(([path, list]) => list.includes(path.split('->>').reduce((value, key) => value?.[key], row)));
  const single = () => {
    if (name === 'cowork_runs') {
      const id = q.eq.find(([c]) => c === 'id')?.[1];
      if (id === RUN && q.patch === null && q.eq.length > 1 && !q.parent) return { data: { status: s.runStatus, ...s.runs[RUN] }, error: null };
      return { data: s.runs[id] ? { status: s.runStatus, ...s.runs[id] } : null, error: null };
    }
    if (name === 'cowork_effect_proposals') return { data: s.proposal, error: null };
    if (name === 'cowork_batch_proposals') return { data: s.batch && q.eq.every(([c, v]) => s.batch[c] === v) ? JSON.parse(JSON.stringify(s.batch)) : null, error: null };
    return { data: source().filter(matches)[0] ?? null, error: null };
  };
  const b = {
    select: () => b,
    eq: (c, v) => { q.eq.push([c, v]); return b; },
    in: (c, list) => { q.in.push([c, list]); return b; },
    filter: (path, op, value) => { assert.equal(op, 'in'); q.filter.push([path.replace('data->>', 'data->>'), value.replace(/[()]/g, '').split(',')]); return b; },
    order: () => b,
    limit: () => b,
    update: patch => { q.patch = patch; return b; },
    upsert: values => { q.upsert = values; return b; },
    maybeSingle: async () => {
      if (q.patch && name === 'cowork_batch_proposals') {
        if (!s.batch) return { data: null, error: null };
        if (!s.proposal || s.proposal.status !== 'proposed') return { data: null, error: { code: '23514', message: 'People can only be removed' } };
        Object.assign(s.batch, q.patch);
        return { data: { run_id: s.batch.run_id }, error: null };
      }
      if (q.upsert && name === 'cowork_batch_proposals') {
        if (s.batch) return { data: null, error: null };
        s.batch = JSON.parse(JSON.stringify({ excluded: [], ...q.upsert }));
        return { data: { run_id: q.upsert.run_id }, error: null };
      }
      return single();
    },
    then: (resolve, reject) => Promise.resolve({ data: source().filter(matches), error: null }).then(resolve, reject),
  };
  return b;
}
state.table = table;

const sources = {
  '@/lib/server/supabase-admin': 'export const getSupabaseAdminClient=()=>({from:t=>globalThis.__prepBatch.table(t)});',
  '@/lib/server/apollo-credit-balance': 'export const loadLatestApolloCreditBalance=async()=>({remaining:120,capturedAt:new Date().toISOString()});export const isApolloCreditBalanceStale=()=>false;',
  './access': 'export const requireCoworkWorkerAccess=async()=>{};',
  './runs': 'export const getCoworkRun=async()=>({run:{status:globalThis.__prepBatch.runStatus},events:[]});',
  './save-contact': `export const coworkSavedContactId=(org,user,providerId)=>"00000000-0000-4000-8000-"+providerId.length.toString(16).padStart(12,"b");
    export const insertCoworkContact=async(auth,providerId,observed)=>{const s=globalThis.__prepBatch;s.saves.push({providerId,observed});
      const lead={id:"00000000-0000-4000-8000-0000000000c"+s.saves.length,name:observed.name,company:observed.company};s.leads.push({...lead,user_id:auth.user.id,organization_id:auth.organizationId,apollo_id:providerId.slice(7)});return {lead,reused:false};};`,
  './enrich-contact': `export const enrichCoworkSavedLead=async(auth,runId,leadId)=>{const s=globalThis.__prepBatch;s.lookups.push(leadId);
      if(s.lookupError&&s.lookups.length>=s.lookupError.after)throw new Error(s.lookupError.message);
      return leadId==="${'00000000-0000-4000-8000-0000000000c1'}"
        ?{email:"rduran@rdmontajes.cl",emailStatus:"verified",found:true,reused:false,fullName:"Rafael Durán",linkedinUrl:"https://www.linkedin.com/in/rafael-duran",emailWarning:null}
        :{email:null,emailStatus:null,found:false,reused:false};};`,
  './start-research': `export const startCoworkResearchForLead=async(auth,runId,leadId)=>{const s=globalThis.__prepBatch;s.researches.push(leadId);
      if(s.researchError)throw new Error(s.researchError);return {reportId:"r-"+leadId,status:"queued",reused:false};};`,
};
const bundle = await build({ stdin: { contents: "export * from './src/lib/server/cowork/prepare-batch'; export * from './src/lib/server/cowork/prepare-batch-run';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-services', setup(b) {
    b.onResolve({ filter: /.*/ }, args => sources[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: sources[args.path] }));
  } }] });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const api = loaded.exports;
const scope = { userId: USER, organizationId: ORG };
const auth = { user: { id: USER }, organizationId: ORG };
const refuse = (input, pattern) => assert.rejects(api.stageCoworkPrepareBatch(scope, RUN, input), pattern);
const approve = hash => { state.proposal = { status: 'executing', kind: 'lead_prepare_batch', target_id: `preparebatch:${hash}` }; state.runStatus = 'waiting_approval'; };

try {
  // 1. Only people the conversation saw, and only own saved contacts.
  reset();
  await refuse({ goal: 'save', people: [{ providerId: 'apollo:nadie' }] }, /haberse visto antes en esta conversación/);
  await refuse({ goal: 'research', people: [{ leadId: L(9) }] }, /haberse visto antes/);
  await refuse({ goal: 'research', people: [{ leadId: L(3) }] }, /contactos tuyos/);
  state.runStatus = 'completed';
  await refuse({ goal: 'save', people: [{ providerId: 'apollo:rafael' }] }, /ya no admite propuestas/);
  assert.equal(state.batch, null, 'nothing is staged by a refusal');

  // 2. The user's case: two people of the search, looked up and researched. Susana was already saved (from the panel, with her
  //    provider id), so she is not saved again; Ana already has an email and only needs the research.
  reset();
  const staged = await api.stageCoworkPrepareBatch(scope, RUN,
    { goal: 'research', people: [{ providerId: 'apollo:rafael' }, { providerId: 'apollo:susana' }, { leadId: L(2) }] });
  assert.equal(staged.label, 'Preparar a 3 personas: guardar, buscar su correo e investigar');
  assert.deepEqual(staged.cost, { saves: 1, lookups: 2, research: 3 });
  assert.equal(state.batch.kind, 'lead_prepare_batch');
  assert.deepEqual(state.batch.items.map(item => [item.name, item.steps, item.done]), [
    ['Rafael Du***n', ['save', 'enrich', 'research'], []],
    ['Susana Cáceres', ['enrich', 'research'], ['save']],
    ['Ana Pérez', ['research'], ['save', 'enrich']],
  ]);
  assert.equal(state.batch.items[0].providerId, 'apollo:rafael');
  assert.equal(state.batch.items[0].contact.companyWebsite, 'https://rdmontajes.cl', 'the search result travels to be saved as it was seen');
  assert.equal(state.batch.items[1].id, L(1), 'a search result already saved goes by its saved contact');
  assert.equal(state.saves.length + state.lookups.length + state.researches.length, 0, 'staging runs nothing');

  // 3. What is done is skipped: with everyone done, nothing is proposed and the model is told to move on.
  reset();
  state.research.push({ lead_id: L(2), status: 'partial', user_id: USER, organization_id: ORG });
  await refuse({ goal: 'research', people: [{ leadId: L(2) }] }, /No queda nada por hacer con esa persona \(Ana Pérez\).*No hace falta aprobar nada/);
  // A lookup already done (by any path) counts; a failed research can be asked again.
  reset();
  state.enriched.push({ user_id: USER, organization_id: ORG, email: null, enrichment_status: 'completed', data: { sourceSavedLeadId: L(1) } });
  state.research.push({ lead_id: L(1), status: 'failed', user_id: USER, organization_id: ORG });
  await api.stageCoworkPrepareBatch(scope, RUN, { goal: 'research', people: [{ leadId: L(1) }] });
  assert.deepEqual(state.batch.items[0].steps, ['research']);
  assert.deepEqual(state.batch.items[0].done, ['save', 'enrich']);

  // 4. The single actions say when something is already done, so no card asks for it.
  reset();
  assert.match(await api.coworkEffectAlreadyDone(scope, 'save_contact', 'apollo:susana'), /Susana Cáceres ya está en tus contactos/);
  assert.equal(await api.coworkEffectAlreadyDone(scope, 'save_contact', 'apollo:rafael'), null);
  assert.match(await api.coworkEffectAlreadyDone(scope, 'enrich_contact', L(2)), /Ana Pérez ya tiene correo \(ana@acme\.cl\)/);
  assert.equal(await api.coworkEffectAlreadyDone(scope, 'enrich_contact', L(1)), null);
  state.research.push({ lead_id: L(1), status: 'queued', user_id: USER, organization_id: ORG });
  assert.match(await api.coworkEffectAlreadyDone(scope, 'start_research', L(1)), /ya tiene una investigación hecha o en curso/);
  assert.equal(await api.coworkEffectAlreadyDone(scope, 'send_email', 'x'), null, 'other actions are not checked here');

  // 5. The card: who goes with what, who was ready, the cost and the balance; people come off only before the decision.
  reset();
  const card = await api.stageCoworkPrepareBatch(scope, RUN,
    { goal: 'research', people: [{ providerId: 'apollo:rafael' }, { providerId: 'apollo:susana' }, { leadId: L(2) }] });
  state.proposal = { status: 'proposed' };
  const preview = await api.readCoworkPrepareBatchPreview(auth, RUN, `preparebatch:${card.hash}`);
  assert.equal(preview.matches, true);
  assert.equal(preview.open, true);
  assert.deepEqual(preview.balance, { remaining: 120, stale: false });
  assert.ok(preview.items.every(item => !('contact' in item)), 'the card does not carry what saving needs');
  assert.equal((await api.readCoworkPrepareBatchPreview(auth, RUN, 'preparebatch:' + 'f'.repeat(64))).matches, false);
  await assert.rejects(api.setCoworkPrepareBatchExclusions(auth, RUN, [L(9)]), /Solo se puede quitar a personas del lote/);
  await assert.rejects(api.setCoworkPrepareBatchExclusions(auth, RUN, state.batch.items.map(item => item.id)), /Quitaste a todas/);
  await api.setCoworkPrepareBatchExclusions(auth, RUN, [L(2)]);
  assert.deepEqual(state.batch.excluded, [L(2)]);

  // 6. The approved run, person by person: Rafael is saved, gets his real name, email and LinkedIn, and his research; Susana has no
  //    email at the provider (the lookup ran, so she is researched); Ana was taken off and nothing is done for her.
  approve(card.hash);
  const ran = await api.executeCoworkPrepareBatch(auth, RUN, `preparebatch:${card.hash}`);
  assert.deepEqual(state.saves.map(save => save.providerId), ['apollo:rafael']);
  assert.equal(state.saves[0].observed.company_website, 'https://rdmontajes.cl');
  const [rafael, susana, ana] = ran.result.items;
  assert.deepEqual([rafael.name, rafael.email, rafael.linkedinUrl, rafael.research, rafael.status],
    ['Rafael Durán', 'rduran@rdmontajes.cl', 'https://www.linkedin.com/in/rafael-duran', 'queued', 'ready']);
  assert.equal(rafael.id, '00000000-0000-4000-8000-0000000000c1', 'the result points at the contact saved now');
  assert.deepEqual(susana.steps.map(step => [step.step, step.status]), [['enrich', 'done'], ['research', 'done']]);
  assert.equal(susana.steps[0].detail, 'El proveedor no encontró su correo.');
  assert.equal(ana.status, 'removed');
  assert.deepEqual(state.researches, ['00000000-0000-4000-8000-0000000000c1', L(1)], 'nobody taken off is researched');
  assert.match(ran.reply, /^Listo con 2 de 2 personas: 1 quedó guardada, 1 de 2 con correo y 2 investigaciones en curso o listas\./);
  assert.match(ran.reply, /Susana Cáceres: El proveedor no encontró su correo\./);
  assert.match(ran.reply, /Quitaste a 1 persona de la lista\./);

  // 7. A quota that runs out stops that step for the rest, with the reason; a research without its lookup is not asked.
  reset();
  const quota = await api.stageCoworkPrepareBatch(scope, RUN, { goal: 'research', people: [{ providerId: 'apollo:rafael' }, { leadId: L(1) }] });
  approve(quota.hash);
  state.lookupError = { after: 1, message: 'Se alcanzó el cupo diario de enriquecimiento. Se renueva mañana.' };
  const capped = await api.executeCoworkPrepareBatch(auth, RUN, `preparebatch:${quota.hash}`);
  assert.equal(state.lookups.length, 1, 'no lookup is tried after the quota ran out');
  assert.deepEqual(capped.result.items.map(item => item.status), ['partial', 'failed']);
  assert.match(capped.result.items[1].steps[0].detail, /cupo diario de búsquedas de correo/);
  assert.match(capped.result.items[0].steps[2].detail, /primero hay que buscar su correo/);
  assert.deepEqual(state.researches, [], 'nothing is researched without its email looked up');

  // 8. Nobody could be prepared: the effect fails and says why; a list that changed or an approval no longer valid runs nothing.
  reset();
  const none = await api.stageCoworkPrepareBatch(scope, RUN, { goal: 'research', people: [{ leadId: L(2) }] });
  approve(none.hash);
  state.researchError = 'Se alcanzó el cupo diario de investigaciones.';
  await assert.rejects(api.executeCoworkPrepareBatch(auth, RUN, `preparebatch:${none.hash}`), /No se pudo preparar a nadie del lote\. Se alcanzó el cupo diario de investigaciones/);
  reset();
  const pinned = await api.stageCoworkPrepareBatch(scope, RUN, { goal: 'save', people: [{ providerId: 'apollo:rafael' }] });
  approve(pinned.hash);
  await assert.rejects(api.executeCoworkPrepareBatch(auth, RUN, 'preparebatch:' + 'e'.repeat(64)), /La autorización del lote ya no está vigente/);
  state.batch.items[0].steps = ['save', 'enrich'];
  await assert.rejects(api.executeCoworkPrepareBatch(auth, RUN, `preparebatch:${pinned.hash}`), /El lote cambió desde tu revisión/);
  assert.equal(state.saves.length, 0);
  process.env.COWORK_PREPARE_BATCH_ENABLED = 'false';
  await assert.rejects(api.executeCoworkPrepareBatch(auth, RUN, `preparebatch:${pinned.hash}`), /desactivado por ahora/);
  delete process.env.COWORK_PREPARE_BATCH_ENABLED;

  console.log('PASS: prepare batch stages only observed own people with what is missing, says when all is done, single actions skip what is done, card removals, run person by person with real identity, quotas and pinned approval.');
} finally {
  delete globalThis.__prepBatch;
}
