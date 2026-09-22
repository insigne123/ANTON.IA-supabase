// Fase 3: messaging context staging/execution and draft checks. No providers, secrets or env files.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const RUN = '00000000-0000-4000-8000-000000000010';
const DRAFT = '00000000-0000-4000-8000-000000000011';
const SNAP = '00000000-0000-4000-8000-000000000012';
const state = {
  context: null, staged: null, applied: null, runStatus: 'completed',
  styleResolvable: true, draftText: 'Hacemos 1000 personas en 30 minutos con antecedentes penales.',
  snapshot: { claims: [{ statement: 'Caso A documentado', supportingEvidenceIds: ['e1'] }] },
};
globalThis.__coworkMessageContext = state;

function tableHandler(table) {
  const s = globalThis.__coworkMessageContext;
  const chain = { _eq: [] };
  chain.select = () => chain;
  chain.eq = (column, value) => { chain._eq.push([column, value]); return chain; };
  chain.in = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.insert = values => {
    if (table === 'organization_messaging_context') {
      if (s.context) return { ...chain, select: () => ({ ...chain, maybeSingle: async () => ({ data: null, error: { message: 'duplicate' } }) }) };
      s.context = { ...values };
    }
    return { ...chain, select: () => ({ ...chain, maybeSingle: async () => ({ data: { updated_at: values.updated_at || '2026-09-22T00:00:00Z' }, error: null }) }) };
  };
  chain.update = values => {
    if (table === 'organization_messaging_context') s.pendingUpdate = { values, filters: [...chain._eq] };
    return chain;
  };
  chain.upsert = values => {
    if (table === 'cowork_message_context_proposals') s.staged = values;
    if (table === 'organization_messaging_context') s.applied = values;
    return { ...chain, select: () => ({ ...chain, maybeSingle: async () => table === 'organization_messaging_context'
      ? { data: { updated_at: '2026-09-22T00:00:00Z' }, error: null }
      : { data: null, error: null } }) };
  };
  chain.maybeSingle = async () => {
    if (table === 'organization_messaging_context') {
      if (s.pendingUpdate) {
        const pending = s.pendingUpdate; s.pendingUpdate = null;
        const version = pending.filters.find(([column]) => column === 'updated_at')?.[1];
        if (!s.context || (s.context.updated_at || null) !== (version ?? null)) return { data: null, error: null };
        s.context = { ...s.context, ...pending.values };
        return { data: { updated_at: pending.values.updated_at }, error: null };
      }
      return { data: s.context, error: null };
    }
    if (table === 'cowork_message_context_proposals') return { data: s.staged, error: null };
    if (table === 'messaging_drafts') return { data: { research_snapshot_id: SNAP }, error: null };
    if (table === 'research_snapshots') return { data: { payload: s.snapshot }, error: null };
    return { data: null, error: null };
  };
  return chain;
}
const sources = {
  '@/lib/server/supabase-admin': 'export const getSupabaseAdminClient=()=>({from:t=>globalThis.__coworkMessageContext.table(t)});',
  './runs': 'export const getCoworkRun=async()=>({run:{status:globalThis.__coworkMessageContext.runStatus},events:[]});',
  './access': 'export const requireCoworkWorkerAccess=async()=>{};',
  '@/lib/server/email-style-profiles': 'export const resolveEmailStyleProfile=async input=>{if(!globalThis.__coworkMessageContext.styleResolvable)throw new Error("STYLE_UNKNOWN");return{style:{id:input.styleProfileId}};};',
  '@/lib/server/native-drafts': 'export const getCurrentNativeDraft=async()=>({draftId:"d",versionId:"v",content:{subject:"Propuesta",text:globalThis.__coworkMessageContext.draftText}});',
  '@/lib/messaging-contracts': 'export const canonicalSha256=o=>{const c=require("node:crypto").createHash("sha256").update(JSON.stringify(o)).digest("hex");return c;};',
};
globalThis.__coworkMessageContext.table = tableHandler;
for (const entry of ['src/lib/server/cowork/message-context.ts', 'src/lib/server/cowork/message-checks.ts']) {
  const bundle = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'isolated-services', setup(b) {
      b.onResolve({ filter: /.*/ }, args => sources[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: sources[args.path] }));
    } }],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  globalThis.__coworkMessageContextModule = globalThis.__coworkMessageContextModule || {};
  Object.assign(globalThis.__coworkMessageContextModule, module.exports);
}
const api = globalThis.__coworkMessageContextModule;
const scope = { userId: 'owner', organizationId: 'org' };
const fakeClient = { from: tableHandler };
try {
  // 1. Unconfigured context reads explicitly; context update requires observed message.context (checked in loop).
  const empty = await api.readCoworkMessageContext(fakeClient, scope);
  assert.equal(empty.configured, false);
  // 2. Empty patch and unknown style fail before staging.
  await assert.rejects(api.stageCoworkMessageContextUpdate(scope, RUN, {}), /no cambia ningún campo|No changes|La propuesta/);
  state.styleResolvable = false;
  await assert.rejects(api.stageCoworkMessageContextUpdate(scope, RUN, { defaultStyleProfileId: 'missing' }), /STYLE_UNKNOWN/);
  state.styleResolvable = true;
  // 3. Valid patch stages with hash target; second different patch conflicts.
  const patch = { prohibitedTerms: ['antecedentes penales'], roleCta: { decisionMaker: 'Reunión de 15 minutos' } };
  const staged = await api.stageCoworkMessageContextUpdate(scope, RUN, patch);
  assert.match(staged.hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(staged.changed, ['prohibited_terms', 'role_cta']);
  api.parseCoworkMessageContextTarget(`msgctx:${staged.hash}`);
  assert.throws(() => api.parseCoworkMessageContextTarget('profile:abc'), /no es válida/);
  // 4. Atomic execution: concurrent insert refuses, version-checked update applies.
  state.context = { updated_at: '2026-09-22T00:00:01Z' };
  await assert.rejects(api.executeCoworkMessageContextUpdate({ user: { id: 'owner' }, organizationId: 'org' }, RUN, `msgctx:${staged.hash}`), /cambió desde/);
  state.context = null;
  const done = await api.executeCoworkMessageContextUpdate({ user: { id: 'owner' }, organizationId: 'org' }, RUN, `msgctx:${staged.hash}`);
  assert.match(done.reply, /actualizado/);
  assert.equal(done.result.draftsNeedRecheck, true);
  assert.deepEqual(state.context.prohibited_terms, ['antecedentes penales']);
  // 4b. Tampered staged values never match the reviewed hash.
  state.staged = { ...state.staged, patch: { ...state.staged.patch, prohibited_terms: ['otro término'] } };
  await assert.rejects(api.executeCoworkMessageContextUpdate({ user: { id: 'owner' }, organizationId: 'org' }, RUN, `msgctx:${staged.hash}`), /no coincide/);
  // 4c. Clear operations reset fields instead of ignoring them.
  state.staged = null;
  await assert.rejects(api.stageCoworkMessageContextUpdate(scope, RUN, { clear: ['trialOffer'], trialOffer: 'x' }), /a la vez/);
  const cleared = await api.stageCoworkMessageContextUpdate(scope, RUN, { clear: ['trialOffer', 'prohibitedTerms'] });
  assert.ok(cleared.changed.includes('trial_offer'));
  state.context = { updated_at: '2026-09-22T00:00:00Z', prohibited_terms: ['antecedentes penales'], required_terms: [] };
  // 5. Terms verdicts: blocked, fail on missing required, unconfigured without rules.
  const terms = await api.checkCoworkDraftTerms(fakeClient, scope, DRAFT);
  assert.equal(terms.verdict, 'blocked');
  assert.deepEqual(terms.prohibitedFound, ['antecedentes penales']);
  assert.equal(terms.sendAuthorized, false);
  state.draftText = 'Due diligence con trazabilidad.';
  state.context = { updated_at: '2026-09-22T00:00:00Z', prohibited_terms: [], required_terms: ['evidencia auditable'] };
  const missing = await api.checkCoworkDraftTerms(fakeClient, scope, DRAFT);
  assert.equal(missing.verdict, 'fail');
  assert.deepEqual(missing.requiredMissing, ['evidencia auditable']);
  state.context = { updated_at: '2026-09-22T00:00:00Z', prohibited_terms: [], required_terms: [] };
  const unconfigured = await api.checkCoworkDraftTerms(fakeClient, scope, DRAFT);
  assert.equal(unconfigured.verdict, 'unconfigured');
  state.draftText = 'Hacemos 1000 personas en 30 minutos con antecedentes penales.';
  state.context = { updated_at: '2026-09-22T00:00:00Z', prohibited_terms: ['antecedentes penales'], required_terms: [] };
  // 6. Evidence check pairs assertions with observed research claims.
  const evidence = await api.checkCoworkDraftEvidence(fakeClient, scope, DRAFT);
  assert.equal(evidence.snapshotObserved, true);
  assert.ok(evidence.assertions.some(item => item.id === 'quantity' && item.status === 'needs_human_judgment'));
  assert.ok(evidence.assertions.every(item => typeof item.excerpt === 'string' && item.excerpt.length > 0));
  assert.equal(evidence.researchClaims.length, 1);
  assert.equal(evidence.sendAuthorized, false);
  console.log('PASS: staged messaging context, atomic drift refusal, clear ops, terms verdicts and evidence pairing without writes.');
} finally {
  delete globalThis.__coworkMessageContext;
  delete globalThis.__coworkMessageContextModule;
}
