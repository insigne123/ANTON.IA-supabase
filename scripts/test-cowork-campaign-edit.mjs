// Isolated test of editCoworkCampaignMessages: with M4 applied, the edit is one call to
// cowork_edit_campaign_definition (atomic with the approval); without it, the two steps of before.
// In-memory client, no environment, database or provider access.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const USER = '00000000-0000-4000-8000-0000000000aa';
const ORG = '00000000-0000-4000-8000-0000000000bb';
const RUN = '00000000-0000-4000-8000-0000000000c1';
const stored = {
  name: 'RR. HH. septiembre', description: 'Reuniones', objective: 'Reuniones',
  criteria: { relationship: 'never_contacted', titles: [], industries: [], countries: [], sizes: [], seniorities: [], minimumDaysSinceSent: 0, excludeReplied: true, enrichedOnly: true },
  emails: ['marcela@sodexo.cl', 'felipe@securitas.cl'], provider: 'google', overrides: [],
  messages: [{ subject: 'AXIS en minutos', body: 'Hola,\nte escribo por AXIS.', delayDays: 0 }, { subject: 'Seguimiento', body: 'Hola,\n¿lo pudiste ver?', delayDays: 3 }],
};
const state = { rpc: null, calls: [], writes: [] };
globalThis.__campaignEdit = state;
globalThis.__campaignEditAdmin = {
  rpc: async (name, args) => { state.calls.push([name, args]); return state.rpc; },
  from: table => {
    const query = { table, op: 'select', values: null };
    const builder = {
      select: () => builder, eq: () => builder,
      update: values => { query.op = 'update'; query.values = values; return builder; },
      insert: async values => { state.writes.push({ table, op: 'insert', values }); return { error: null }; },
      maybeSingle: async () => {
        if (query.op === 'update') { state.writes.push({ table, op: 'update', values: query.values }); return { data: { run_id: RUN }, error: null }; }
        return { data: { definition: structuredClone(stored) }, error: null };
      },
    };
    return builder;
  },
};
const result = await build({
  entryPoints: ['src/lib/server/cowork/campaign-ops.ts'],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-dependencies', setup(build) {
    build.onResolve({ filter: /^(\.\/runs|\.\/access|@\/lib\/server\/supabase-admin|@\/lib\/server\/bulk-campaign-audience|@\/lib\/server\/bulk-campaigns)$/ },
      args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
      if (args.path === './runs') return { contents: `export async function getCoworkRun(){ return { run: { id: "${RUN}", status: "waiting_approval" }, events: [
        { sequence: 1, kind: "approval.requested", payload: { action: "cowork.effect", kind: "campaign_create", targetId: "new-campaign", label: "Crear campaña pausada" } }] }; }` };
      if (args.path === './access') return { contents: 'export async function requireCoworkWorkerAccess(){}' };
      if (args.path.endsWith('supabase-admin')) return { contents: 'export function getSupabaseAdminClient(){ return globalThis.__campaignEditAdmin; }' };
      return { contents: 'export async function loadAudience(){ return []; } export async function saveBulkCampaign(){} export async function reviewBulkCampaign(){}' };
    });
  } }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, loaded, loaded.exports);
const { editCoworkCampaignMessages } = loaded.exports;
const auth = { user: { id: USER }, organizationId: ORG };
const edits = [{ subject: 'AXIS: antecedentes en minutos', body: stored.messages[0].body }, { subject: stored.messages[1].subject, body: stored.messages[1].body }];
const reset = rpc => { state.rpc = rpc; state.calls.length = 0; state.writes.length = 0; };
const refused = async () => { try { await editCoworkCampaignMessages(auth, RUN, edits); return null; } catch (error) { return { name: error.constructor.name, status: error.status, message: error.message }; } };
process.env.BULK_CAMPAIGNS_ENABLED = 'true';
try {
  // With M4 applied: one call, with the version read and only the changed email; the page writes nothing itself.
  reset({ data: 'edited', error: null });
  assert.deepEqual(await editCoworkCampaignMessages(auth, RUN, edits), { changed: [0] });
  assert.equal(state.calls.length, 1);
  const [name, args] = state.calls[0];
  assert.equal(name, 'cowork_edit_campaign_definition');
  assert.deepEqual({ run: args.p_run_id, user: args.p_user_id, org: args.p_organization_id, changed: args.p_changed }, { run: RUN, user: USER, org: ORG, changed: [1] });
  assert.deepEqual(args.p_expected, stored, 'the version the person saw');
  assert.equal(args.p_definition.messages[0].subject, 'AXIS: antecedentes en minutos');
  assert.deepEqual({ ...args.p_definition, messages: null }, { ...stored, messages: null }, 'only the emails change');
  assert.equal(state.writes.length, 0, 'the function writes the definition and its event');

  // Another tab changed it, or it was approved or discarded meanwhile: refused, nothing written.
  reset({ data: 'stale', error: null });
  assert.deepEqual(await refused(), { name: 'CoworkCampaignEditRefused', status: 409, message: 'La campaña cambió mientras la editabas: vuelve a abrirla y repite el cambio.' });
  reset({ data: 'not_pending', error: null });
  assert.equal((await refused())?.status, 409);
  assert.equal(state.writes.length, 0);

  // Without M4 applied: the two steps of before, with the event.
  reset({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
  assert.deepEqual(await editCoworkCampaignMessages(auth, RUN, edits), { changed: [0] });
  assert.deepEqual(state.writes.map(write => [write.table, write.op]), [['cowork_campaign_definitions', 'update'], ['cowork_run_events', 'insert']]);
  assert.deepEqual(state.writes[1].values.payload, { kind: 'campaign_create', emails: [1] });

  // Any other failure of the function is not a reason to write around it.
  reset({ data: null, error: { code: '22023', message: 'Only the subjects and bodies of the emails can change' } });
  assert.equal((await refused())?.message, 'No se pudo guardar la edición de la campaña.');
  assert.equal(state.writes.length, 0);

  // Nothing changed: no call at all.
  reset({ data: 'edited', error: null });
  assert.deepEqual(await editCoworkCampaignMessages(auth, RUN, stored.messages.map(({ subject, body }) => ({ subject, body }))), { changed: [] });
  assert.equal(state.calls.length, 0);
  console.log('PASS: a campaign edit is one atomic call with the version read (stale or no longer pending: refused, nothing written); without M4, the two steps of before; any other failure writes nothing.');
} finally {
  delete globalThis.__campaignEdit;
  delete globalThis.__campaignEditAdmin;
}
