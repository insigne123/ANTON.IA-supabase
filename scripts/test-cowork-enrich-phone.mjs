// Revealing a phone with the provider: staging, the approval card and the approved request, over in-memory stand-ins of the tables, the quota
// ledger, the callback and the provider. No database, provider, credit, secret or env file: nothing is ever requested or spent for real.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const RUN = '00000000-0000-4000-8000-000000000041';
const USER = '00000000-0000-4000-8000-0000000000aa';
const ORG = '00000000-0000-4000-8000-0000000000bb';
const LEAD = '00000000-0000-4000-8000-000000000061';
const CLAIM = '00000000-0000-4000-8000-000000000002';
const lead = (overrides = {}) => ({ id: LEAD, name: 'Paula Ríos', title: 'Gerenta de personas', company: 'Transportes del Sur', company_website: 'https://transportesdelsur.cl',
  linkedin_url: 'https://www.linkedin.com/in/paula-rios', email: 'paula@transportesdelsur.cl', source_provider: 'apollo', source_provider_id: 'apollo-1', ...overrides });

const state = {
  access: true, runStatus: 'waiting_approval', proposal: { status: 'executing', kind: 'enrich_phone', target_id: '' }, lead: lead(), creditAccess: true,
  balance: { remaining: 1840, used: 660, limit: 2500, cycleEnd: null, capturedAt: new Date().toISOString() }, balanceThrows: false,
  quotaOp: null, claim: { claimed: true, allowed: true, claimToken: CLAIM }, limits: { enrich: 50 },
  submit: async () => ({ success: true, enrichmentStatus: 'pending', providerRequestId: 'pr-phone-1', creditsConsumed: 10, extractedData: {} }),
  calls: [], inserts: [], updates: [], releases: [], settles: [], binds: [],
};
globalThis.__phoneTest = state;

const sources = {
  '@/lib/server/supabase-admin': `export const getSupabaseAdminClient=()=>{const s=globalThis.__phoneTest;
    const table=name=>{const b={select:()=>b,eq:()=>b,
      insert:values=>{s.inserts.push([name,values]);return{select:()=>({maybeSingle:async()=>({data:{id:values.id,enrichment_status:'pending'},error:null})})};},
      update:values=>{s.updates.push([name,values]);const u={eq:()=>u,then:(res)=>res({data:null,error:null})};return u;},
      maybeSingle:async()=>{
        if(name==="leads")return{data:s.lead,error:null};
        if(name==="cowork_runs")return{data:{status:s.runStatus},error:null};
        if(name==="cowork_effect_proposals")return{data:s.proposal,error:null};
        return{data:null,error:null};}};return b;};
    return{from:table};};`,
  './access': 'export const requireCoworkWorkerAccess=async()=>{if(!globalThis.__phoneTest.access)throw new Error("denied");};',
  './runs': 'export const getCoworkRun=async()=>({run:{status:globalThis.__phoneTest.runStatus},events:[]});',
  '@/lib/server/daily-quota-store': `export const getEffectiveDailyQuotaLimits=async()=>globalThis.__phoneTest.limits;
    export const getEnrichmentQuotaOperation=async()=>globalThis.__phoneTest.quotaOp;
    export const claimEnrichmentQuotaOperation=async(args)=>{globalThis.__phoneTest.calls.push(['claim',args]);return globalThis.__phoneTest.claim;};
    export const releaseEnrichmentQuotaOperation=async()=>{globalThis.__phoneTest.releases.push(true);};`,
  '@/lib/server/enrichment-search-access': 'export const hasUserEnrichmentSearchCreditAccess=async()=>globalThis.__phoneTest.creditAccess;',
  '@/lib/server/apollo-enrichment-callbacks': `export const createApolloEnrichmentCallback=async(args)=>{globalThis.__phoneTest.calls.push(['callback',args]);return{callbackId:'00000000-0000-4000-8000-000000000003',tokenHash:'${'a'.repeat(64)}',webhookUrl:'https://app.test/api/apollo-webhook/token'};};
    export const markApolloEnrichmentCallbackSubmitted=async()=>{globalThis.__phoneTest.calls.push(['submitted']);};
    export const bindApolloEnrichmentCallback=async(args)=>{globalThis.__phoneTest.binds.push(args);return 'bound';};
    export const settleApolloEnrichmentCallback=async(args)=>{globalThis.__phoneTest.settles.push(args);};`,
  '@/lib/server/apollo-enrichment': 'export const submitApolloEnrichment=(...args)=>{globalThis.__phoneTest.calls.push(["submit",args[0]]);return globalThis.__phoneTest.submit(...args);};',
  '@/lib/server/apollo-credit-balance': `export const loadLatestApolloCreditBalance=async()=>{const s=globalThis.__phoneTest;if(s.balanceThrows)throw new Error("db down");return s.balance;};
    export const isApolloCreditBalanceStale=(b)=>Date.now()-Date.parse(b.capturedAt)>2*60*60*1000;`,
};
const externals = new RegExp(`^(${Object.keys(sources).map(key => key.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
const bundle = await build({
  entryPoints: ['src/lib/server/cowork/enrich-phone.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-phone-dependencies', setup(b) {
    b.onResolve({ filter: externals }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: sources[args.path], loader: 'js' }));
  } }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { stageCoworkPhoneReveal, readCoworkPhoneRevealPreview, executeCoworkPhoneReveal } = loaded.exports;
const scope = { userId: USER, organizationId: ORG };
const auth = { user: { id: USER }, organizationId: ORG };
const flag = process.env.COWORK_PHONE_REVEAL_ENABLED;
const reset = () => {
  Object.assign(state, { access: true, runStatus: 'waiting_approval', lead: lead(), creditAccess: true, balanceThrows: false, quotaOp: null,
    claim: { claimed: true, allowed: true, claimToken: CLAIM }, calls: [], inserts: [], updates: [], releases: [], settles: [], binds: [],
    balance: { remaining: 1840, used: 660, limit: 2500, cycleEnd: null, capturedAt: new Date().toISOString() },
    submit: async () => ({ success: true, enrichmentStatus: 'pending', providerRequestId: 'pr-phone-1', creditsConsumed: 10, extractedData: {} }) });
  process.env.COWORK_PHONE_REVEAL_ENABLED = 'true';
};
const providerCalls = () => state.calls.filter(call => call[0] === 'submit').length;
const refuse = (promise, pattern) => assert.rejects(promise, pattern);

try {
  // 1. Staging names the person and the cost, pins them, and requests nothing.
  reset();
  state.runStatus = 'running';
  const staged = await stageCoworkPhoneReveal(scope, RUN, LEAD);
  assert.equal(staged.label, 'Revelar el teléfono de Paula Ríos (Transportes del Sur) · 10 créditos');
  assert.match(staged.targetId, new RegExp(`^enrichphone:${LEAD}:[a-f0-9]{64}$`));
  assert.equal(providerCalls() + state.inserts.length, 0, 'staging writes and requests nothing');
  state.lead = lead({ name: 'X', company: null, company_website: null, linkedin_url: null, source_provider: null, source_provider_id: null });
  await refuse(stageCoworkPhoneReveal(scope, RUN, LEAD), /no tiene identidad suficiente/);
  state.lead = null;
  await refuse(stageCoworkPhoneReveal(scope, RUN, LEAD), /no está disponible en tu organización/);
  state.lead = lead();
  state.runStatus = 'completed';
  await refuse(stageCoworkPhoneReveal(scope, RUN, LEAD), /ya no admite propuestas/);
  await refuse(stageCoworkPhoneReveal(scope, RUN, 'no-es-un-uuid'), /uuid|Invalid/i);

  // 2. The card: who, the cost, the balance and whether the contact is still the one proposed.
  reset();
  state.runStatus = 'running';
  const proposed = await stageCoworkPhoneReveal(scope, RUN, LEAD);
  state.runStatus = 'waiting_approval';
  const preview = await readCoworkPhoneRevealPreview(auth, RUN, proposed.targetId);
  assert.deepEqual([preview.name, preview.company, preview.cost, preview.matches, preview.affordable, preview.unavailable], ['Paula Ríos', 'Transportes del Sur', 10, true, true, null]);
  assert.equal(preview.balance.remaining, 1840);
  assert.equal(preview.balance.stale, false);
  state.balance = { ...state.balance, remaining: 4 };
  assert.equal((await readCoworkPhoneRevealPreview(auth, RUN, proposed.targetId)).affordable, false, 'the card says when the credits do not reach');
  state.balanceThrows = true;
  const unknown = await readCoworkPhoneRevealPreview(auth, RUN, proposed.targetId);
  assert.deepEqual([unknown.balance, unknown.affordable, unknown.matches], [null, null, true], 'a balance that cannot be read is not claimed');
  state.balanceThrows = false;
  state.lead = lead({ name: 'Paula Ríos Soto' });
  const changed = await readCoworkPhoneRevealPreview(auth, RUN, proposed.targetId);
  assert.equal(changed.matches, false);
  assert.match(changed.unavailable, /cambió desde la propuesta/);
  state.lead = null;
  assert.equal(await readCoworkPhoneRevealPreview(auth, RUN, proposed.targetId), null, 'a contact that is not the person\'s has no card');
  assert.equal(await readCoworkPhoneRevealPreview(auth, RUN, 'enrichphone:nope'), null);

  // 3. Execution. The flag is the switch that stops a reveal already approved; every refusal asks the provider nothing and spends nothing.
  reset();
  state.runStatus = 'running';
  const approved = await stageCoworkPhoneReveal(scope, RUN, LEAD);
  state.runStatus = 'waiting_approval';
  state.proposal = { status: 'executing', kind: 'enrich_phone', target_id: approved.targetId };
  delete process.env.COWORK_PHONE_REVEAL_ENABLED;
  await refuse(executeCoworkPhoneReveal(auth, RUN, approved.targetId), /desactivado por ahora: no se pidió nada ni se gastó ningún crédito/);
  process.env.COWORK_PHONE_REVEAL_ENABLED = 'true';
  await refuse(executeCoworkPhoneReveal(auth, RUN, 'enrichphone:x'), /no es válida/);
  state.proposal = { status: 'proposed', kind: 'enrich_phone', target_id: approved.targetId };
  await refuse(executeCoworkPhoneReveal(auth, RUN, approved.targetId), /autorización para pedir el teléfono ya no está vigente/);
  state.proposal = { status: 'executing', kind: 'enrich_contact', target_id: approved.targetId };
  await refuse(executeCoworkPhoneReveal(auth, RUN, approved.targetId), /autorización para pedir el teléfono ya no está vigente/);
  state.proposal = { status: 'executing', kind: 'enrich_phone', target_id: approved.targetId };
  state.lead = lead({ company: 'Otra empresa' });
  await refuse(executeCoworkPhoneReveal(auth, RUN, approved.targetId), /cambió desde tu revisión. No se pidió el teléfono/);
  state.lead = lead();
  state.creditAccess = false;
  await refuse(executeCoworkPhoneReveal(auth, RUN, approved.targetId), /no tiene acceso a créditos/);
  state.creditAccess = true;
  state.balance = { ...state.balance, remaining: 9 };
  await refuse(executeCoworkPhoneReveal(auth, RUN, approved.targetId), /Alcanzan 9 créditos y revelar un teléfono cuesta 10/);
  state.balance = { ...state.balance, remaining: 1840 };
  state.quotaOp = { status: 'completed' };
  await refuse(executeCoworkPhoneReveal(auth, RUN, approved.targetId), /Ya se pidió el teléfono de este contacto/);
  state.quotaOp = null;
  state.claim = { claimed: false, allowed: false };
  await refuse(executeCoworkPhoneReveal(auth, RUN, approved.targetId), /cupo diario de enriquecimiento/);
  state.claim = { claimed: true, allowed: true, claimToken: CLAIM };
  assert.equal(providerCalls(), 0, 'no refusal reached the provider');
  assert.equal(state.inserts.length, 0, 'and none left a row behind');

  // The approved request: one phone, no email, the callback's webhook, and what it says it costs.
  state.balanceThrows = true;
  const done = await executeCoworkPhoneReveal(auth, RUN, approved.targetId);
  assert.equal(providerCalls(), 1);
  const sent = state.calls.find(call => call[0] === 'submit')[1];
  assert.deepEqual([sent.revealEmail, sent.revealPhone, sent.webhookUrl], [false, true, 'https://app.test/api/apollo-webhook/token']);
  assert.equal(sent.lead.sourceProviderId, 'apollo-1');
  const callback = state.calls.find(call => call[0] === 'callback')[1];
  assert.deepEqual(callback.requestedFields, ['person.phone_numbers']);
  assert.equal(callback.operationId, `cowork:${RUN}:lead:${LEAD}:phone-v1`);
  const row = state.inserts.find(([table]) => table === 'enriched_leads')[1];
  assert.equal(row.enrichment_status, 'pending');
  assert.equal(row.data.sourceSavedLeadId, LEAD);
  assert.deepEqual(state.binds.map(bind => bind.providerRequestId), ['pr-phone-1']);
  assert.match(done.reply, /Pedí el teléfono de Paula Ríos al proveedor \(cuesta hasta 10 créditos\)/);
  assert.match(done.reply, /en unos minutos y queda en tus contactos enriquecidos/);
  assert.deepEqual([done.result.requested, done.result.creditsConsumed], [true, 10]);
  assert.equal(state.releases.length, 0);
  state.balanceThrows = false;

  // The provider refuses the request itself: the row is marked failed, the callback settled, and the reply says nothing came.
  reset(); state.runStatus = 'running'; const again = await stageCoworkPhoneReveal(scope, RUN, LEAD); state.runStatus = 'waiting_approval';
  state.proposal = { status: 'executing', kind: 'enrich_phone', target_id: again.targetId };
  state.submit = async () => ({ success: false, enrichmentStatus: 'rejected', providerRequestId: 'pr-phone-2', creditsConsumed: 0, extractedData: {} });
  const refused = await executeCoworkPhoneReveal(auth, RUN, again.targetId);
  assert.equal(refused.result.requested, false);
  assert.match(refused.reply, /no aceptó el pedido/);
  assert.equal(state.settles.length, 1);
  assert.ok(state.updates.some(([table, values]) => table === 'enriched_leads' && values.enrichment_status === 'failed'));

  // Before the provider: a failure gives the quota back and says nothing was asked. After it: it stays for the reconciler and warns about repeating.
  reset(); state.runStatus = 'running'; const third = await stageCoworkPhoneReveal(scope, RUN, LEAD); state.runStatus = 'waiting_approval';
  state.proposal = { status: 'executing', kind: 'enrich_phone', target_id: third.targetId };
  state.lead = lead(); state.claim = { claimed: true, allowed: true, claimToken: CLAIM };
  state.submit = async () => { throw new Error('socket hang up'); };
  await refuse(executeCoworkPhoneReveal(auth, RUN, third.targetId), /No pudimos confirmar el pedido al proveedor[\s\S]*otros créditos/);
  assert.equal(state.releases.length, 0, 'an unknown outcome is not given back: it may have been charged');
  console.log('PASS: staging pins who the card names and the cost; the card shows the balance; every refusal asks and spends nothing; the approved request asks for one phone with the webhook; a refusal or an unknown outcome is told as it is.');
} finally {
  if (flag === undefined) delete process.env.COWORK_PHONE_REVEAL_ENABLED; else process.env.COWORK_PHONE_REVEAL_ENABLED = flag;
  delete globalThis.__phoneTest;
}
