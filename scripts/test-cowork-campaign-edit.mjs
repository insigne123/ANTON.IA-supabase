// Isolated test of editCoworkCampaignMessages and editCoworkCampaignPerson: with M4 applied, the edit is one call
// to cowork_edit_campaign_definition (atomic with the approval); without it, the two steps of before. Also the
// staging of a proposal with a first email per person. In-memory client, no environment, database or provider access.
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
const state = { rpc: null, calls: [], writes: [], definition: structuredClone(stored) };
globalThis.__campaignEdit = state;
globalThis.__campaignEditAdmin = {
  rpc: async (name, args) => { state.calls.push([name, args]); return state.rpc; },
  from: table => {
    const query = { table, op: 'select', values: null };
    const builder = {
      select: () => builder, eq: () => builder,
      update: values => { query.op = 'update'; query.values = values; return builder; },
      upsert: values => { query.op = 'upsert'; query.values = values; return builder; },
      insert: async values => { state.writes.push({ table, op: 'insert', values }); return { error: null }; },
      maybeSingle: async () => {
        if (query.op === 'update' || query.op === 'upsert') { state.writes.push({ table, op: query.op, values: query.values }); return { data: { run_id: RUN }, error: null }; }
        return { data: { definition: structuredClone(state.definition) }, error: null };
      },
    };
    return builder;
  },
};
const result = await build({
  stdin: { contents: 'export { editCoworkCampaignMessages, editCoworkCampaignPerson, stageCoworkCampaignDefinition } from "./src/lib/server/cowork/campaign-ops"; export { canonicalSha256 } from "./src/lib/messaging-contracts";',
    resolveDir: process.cwd(), sourcefile: 'campaign-edit-test.ts', loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-dependencies', setup(build) {
    build.onResolve({ filter: /^(\.\/runs|\.\/access|@\/lib\/server\/supabase-admin|@\/lib\/server\/bulk-campaign-audience|@\/lib\/server\/bulk-campaigns)$/ },
      args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
      if (args.path === './runs') return { contents: `export async function getCoworkRun(){ return { run: { id: "${RUN}", status: "waiting_approval" }, events: [
        { sequence: 1, kind: "approval.requested", payload: { action: "cowork.effect", kind: "campaign_create", targetId: "new-campaign", label: "Crear campaña pausada" } }] }; }` };
      if (args.path === './access') return { contents: 'export async function requireCoworkWorkerAccess(){}' };
      if (args.path.endsWith('supabase-admin')) return { contents: 'export function getSupabaseAdminClient(){ return globalThis.__campaignEditAdmin; }' };
      return { contents: 'export async function loadAudience(){ return globalThis.__campaignEditAudience || []; } export async function saveBulkCampaign(){} export async function reviewBulkCampaign(){}' };
    });
  } }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, loaded, loaded.exports);
const { editCoworkCampaignMessages, editCoworkCampaignPerson, stageCoworkCampaignDefinition, canonicalSha256 } = loaded.exports;
const expectedHash = canonicalSha256(stored);
const auth = { user: { id: USER }, organizationId: ORG };
const edits = [{ subject: 'AXIS: antecedentes en minutos', body: stored.messages[0].body }, { subject: stored.messages[1].subject, body: stored.messages[1].body }];
const reset = rpc => { state.rpc = rpc; state.calls.length = 0; state.writes.length = 0; state.definition = structuredClone(stored); };
const refused = async () => { try { await editCoworkCampaignMessages(auth, RUN, edits, expectedHash); return null; } catch (error) { return { name: error.constructor.name, status: error.status, message: error.message }; } };
process.env.BULK_CAMPAIGNS_ENABLED = 'true';
try {
  // With M4 applied: one call, with the version read and only the changed email; the page writes nothing itself.
  reset({ data: 'edited', error: null });
  assert.deepEqual(await editCoworkCampaignMessages(auth, RUN, edits, expectedHash), { changed: [0] });
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

  // A tab that saw the original version cannot overwrite an edit saved before its request starts.
  reset({ data: 'edited', error: null });
  state.definition.messages[1].subject = 'Guardado desde otra pestaña';
  assert.equal((await refused())?.status, 409);
  assert.equal(state.calls.length, 0, 'a stale browser preview is refused before calling the RPC');
  assert.equal(state.writes.length, 0);
  await assert.rejects(editCoworkCampaignMessages(auth, RUN, edits), error => error.status === 409);

  // Without M4 applied: the two steps of before, with the event.
  reset({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
  assert.deepEqual(await editCoworkCampaignMessages(auth, RUN, edits, expectedHash), { changed: [0] });
  assert.deepEqual(state.writes.map(write => [write.table, write.op]), [['cowork_campaign_definitions', 'update'], ['cowork_run_events', 'insert']]);
  assert.deepEqual(state.writes[1].values.payload, { kind: 'campaign_create', emails: [1] });

  // Any other failure of the function is not a reason to write around it.
  reset({ data: null, error: { code: '22023', message: 'Only the subjects and bodies of the emails can change' } });
  assert.equal((await refused())?.message, 'No se pudo guardar la edición de la campaña.');
  assert.equal(state.writes.length, 0);

  // Nothing changed: no call at all.
  reset({ data: 'edited', error: null });
  assert.deepEqual(await editCoworkCampaignMessages(auth, RUN, stored.messages.map(({ subject, body }) => ({ subject, body })), expectedHash), { changed: [] });
  assert.equal(state.calls.length, 0);
  console.log('PASS: a campaign edit is one atomic call with the version read (stale or no longer pending: refused, nothing written); without M4, the two steps of before; any other failure writes nothing.');

  // The first email of one person: the same call, with that person's own version and the rest as it was.
  reset({ data: 'edited', error: null });
  const felipe = { email: 'felipe@securitas.cl', subject: 'Felipe, AXIS para Securitas', body: 'Hola Felipe,\nvi que Securitas abrió turnos en Antofagasta.' };
  assert.deepEqual(await editCoworkCampaignPerson(auth, RUN, felipe, expectedHash), { changed: [0] });
  const [personCall, personArgs] = state.calls[0];
  assert.equal(personCall, 'cowork_edit_campaign_definition');
  assert.deepEqual(personArgs.p_changed, [1]);
  assert.deepEqual(personArgs.p_definition.overrides, [{ ...felipe, messageIndex: 0 }]);
  assert.deepEqual({ ...personArgs.p_definition, overrides: null }, { ...stored, overrides: null }, 'the template and the recipients stay');
  reset({ data: 'edited', error: null });
  await assert.rejects(editCoworkCampaignPerson(auth, RUN, { ...felipe, email: 'otra@x.cl' }, expectedHash), error => error.status === 400);
  assert.equal(state.calls.length, 0);
  console.log('PASS: editing one person\'s first email is the same atomic call, with only that person\'s version; someone outside the campaign is refused.');

  // Staging a proposal: each person's first email becomes their own version, and every email is built before the card.
  const scope = { userId: USER, organizationId: ORG };
  const person = (email, name) => ({ email, name, company: 'Securitas', title: 'Jefe de Personas', blockedReason: null });
  const proposal = { name: 'AXIS', objective: 'Reuniones', criteria: stored.criteria, emails: stored.emails, provider: 'google',
    messages: [{ subject: 'AXIS', body: 'Hola {{nombre}},\nte escribo por AXIS.', delayDays: 0 }, { subject: 'Seguimiento', body: 'Hola {{nombre}},\n¿lo pudiste ver?', delayDays: 3 }],
    firstEmails: [felipe] };
  reset(null);
  globalThis.__campaignEditAudience = [person('marcela@sodexo.cl', 'Marcela Soto'), person('felipe@securitas.cl', 'Felipe Muñoz')];
  assert.deepEqual(await stageCoworkCampaignDefinition(scope, RUN, proposal), { recipients: 2 });
  const staged = state.writes.find(write => write.op === 'upsert').values.definition;
  assert.deepEqual(staged.overrides, [{ ...felipe, messageIndex: 0 }]);
  assert.deepEqual(staged.messages.map(message => message.body.split('\n')[0]), ['Hola {{nombre}},', 'Hola {{nombre}},']);
  // Someone without a first name never gets «Hola ,»: the proposal goes back to the model and nothing is staged.
  reset(null);
  globalThis.__campaignEditAudience = [person('marcela@sodexo.cl', 'Ma***a Soto'), person('felipe@securitas.cl', 'Felipe Muñoz')];
  await assert.rejects(stageCoworkCampaignDefinition(scope, RUN, proposal), /marcela@sodexo\.cl no tiene un nombre de pila guardado/);
  assert.equal(state.writes.length, 0);
  console.log('PASS: staging keeps each person\'s first email as their own version and refuses, before the card, someone without a first name.');
} finally {
  delete globalThis.__campaignEdit;
  delete globalThis.__campaignEditAdmin;
  delete globalThis.__campaignEditAudience;
}
