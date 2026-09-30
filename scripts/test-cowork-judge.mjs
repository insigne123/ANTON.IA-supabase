// The judge inside the worker (plan 2, G2): it reads the coordinator's final answer, asks for one
// correction that may make one read, and the page gets its steps; the judged answer stands when
// the correction fails, and the Writer's answers are never judged. No app environment,
// credentials or providers: everything is mocked.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const keys = ['COWORK_ENABLED', 'COWORK_STREAMING_ENABLED', 'COWORK_JUDGE_ENABLED', 'COWORK_WRITER_ENABLED', 'COWORK_CONTACTS_IMPORT_ENABLED', 'COWORK_MODEL_BUDGET_ENABLED', 'COWORK_JUDGE_MODEL', 'COWORK_MODEL',
  'COWORK_ANSWER_HOLD_ENABLED'];
const environment = Object.fromEntries(keys.map(key => [key, process.env[key]]));
Object.assign(process.env, { COWORK_ENABLED: 'true', COWORK_STREAMING_ENABLED: 'true', COWORK_MODEL_BUDGET_ENABLED: 'true', COWORK_MODEL: 'coordinator-model',
  COWORK_JUDGE_MODEL: 'judge-model' });
delete process.env.COWORK_WRITER_ENABLED;
delete process.env.COWORK_CONTACTS_IMPORT_ENABLED;
delete process.env.COWORK_ANSWER_HOLD_ENABLED;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const chips = message => [{ label: 'Sí', message }];
const answer = (reply, question) => ({ action: 'answer', query: null, leadId: null, answer: { reply, document: null, question, blocks: null, suggestions: chips(question) } });
// Offers a free read instead of doing it: what the judge is there to catch.
const offered = answer('Esta semana abrieron el 42 % de tus correos y respondió el 3 %.', '¿Quieres que revise qué campaña rinde menos?');
const complete = answer('Esta semana abrieron el 42 % de tus correos y respondió el 3 %. La que rinde menos es «AXIS RR. HH.»: 1 respuesta de 40 envíos.',
  '¿Ajusto el primer correo de «AXIS RR. HH.»?');
const readCampaigns = { action: 'campaigns.list', query: null, leadId: null, answer: null };
const five = { comprension: 5, veracidad: 5, utilidad: 5, claridad: 5, friccion: 5 };
const clean = { scores: five, problemas: [], veredicto: 'buena' };
const worth = { scores: { ...five, utilidad: 3, friccion: 2 }, veredicto: 'mala',
  problemas: ['Pregunta si revisa qué campaña rinde menos, aunque podía consultar las campañas antes de responder.'] };
// The Writer's turn, with both flags on: its answer went through the Reviewer, not the judge.
const findings = 'Felipe y Camila tienen correo y nunca recibieron nada.';
const handOff = { action: 'draft.write', query: null, leadId: null, answer: null,
  write: { kind: 'email', recipients: ['Felipe Muñoz'], objective: 'Una conversación sobre AXIS', angle: null, tone: null, steps: null, notes: null, findings } };
const written = { reply: findings, question: '¿Creo la campaña pausada para Felipe?', suggestions: chips('Sí, crea la campaña pausada'),
  blocks: [{ type: 'email_draft', title: 'Correo a Felipe', to: ['Felipe Muñoz'], subject: 'Antecedentes en minutos',
    body: 'Hola Felipe,\nRevisas antecedentes laborales en minutos con AXIS.\n¿Te sirve verlo 15 minutos esta semana?\nNicolás Yarur' }] };

const state = { calls: [], generations: [], reads: [], script: [], ledger: 'roles' };
globalThis.__coworkJudge = state;
state.generate = async opts => {
  const who = opts.systemPrompt.startsWith('Eres un evaluador estricto') ? 'judge' : opts.systemPrompt.startsWith('Eres la Redactora') ? 'writer'
    : opts.systemPrompt.startsWith('Eres la Revisora') ? 'reviewer' : 'coordinator';
  const data = state.script.shift();
  state.generations.push({ who, model: opts.openAiModel, streamed: typeof opts.onPartial === 'function', rules: opts.systemPrompt, timeoutMs: opts.timeoutMs });
  if (data instanceof Error) throw data;
  if (opts.onPartial) {
    const json = JSON.stringify(data);
    for (let cut = 12; cut < json.length; cut += 23) { opts.onPartial(json.slice(0, cut)); await pause(2); }
    opts.onPartial(json);
  }
  return { data: opts.schema.parse(data), telemetry: { modelName: opts.openAiModel || 'fixture', durationMs: 1 } };
};
const mocks = {
  './campaign-ops': 'export const stageCoworkCampaignDefinition=async()=>{throw new Error("unexpected campaign")};',
  './code-runner': 'export const stageCoworkCode=async()=>{throw new Error("unexpected code")};',
  './profile-update': 'export const stageCoworkProfileUpdate=async()=>{throw new Error("unexpected profile")};',
  './saved-search-ops': 'export const stageCoworkSavedSearchDelete=async()=>{throw new Error("unexpected search")};export const stageCoworkSavedSearchCreate=async()=>{throw new Error("unexpected search")};export const stageCoworkSavedSearchUpdate=async()=>{throw new Error("unexpected search")};',
  './campaign-stop': 'export const parseCoworkCampaignStopTarget=()=>{throw new Error("unexpected stop")};',
  './crm-record-update': 'export const stageCoworkCrmRecordUpdate=async()=>{throw new Error("unexpected record")};',
  './campaign-prepare': 'export const stageCoworkCampaignPrepare=async()=>{throw new Error("unexpected prepare")};',
  './crm-assign': 'export const stageCoworkCrmAssign=async()=>{throw new Error("unexpected assign")};',
  './exception-resolve': 'export const stageCoworkExceptionResolve=async()=>{throw new Error("unexpected exception")};',
  './mission-control': 'export const stageCoworkMissionControl=async()=>{throw new Error("unexpected mission")};',
  '@/lib/server/bulk-campaigns': 'export const getBulkCampaign=async()=>{throw new Error("unexpected campaign")};',
  '@/lib/server/native-drafts': 'export const getCurrentNativeDraft=async()=>{throw new Error("unexpected draft")};',
  '@/ai/openai-json': 'export const generateStructuredWithTelemetry=opts=>globalThis.__coworkJudge.generate(opts);export const generateStructured=async()=>{throw new Error("unused")};',
  '@/lib/server/supabase-admin': `export const getSupabaseAdminClient=()=>{const chain={table:'',select:()=>chain,eq:()=>chain,gt:()=>chain,limit:()=>chain,in:()=>chain,order:()=>chain,
  maybeSingle:async()=>({data:chain.table==='cowork_runs'?{id:'run',parent_run_id:null,depth:0}:null,error:null}),
  single:async()=>({data:{status:'running',lease_token:'token'},error:null}),
  then(resolve){resolve({data:[],error:null});}};
  return{rpc:async(name,args)=>{const state=globalThis.__coworkJudge;state.calls.push({name,args});
    if(name==='cowork_claim_run')return {data:[{id:'run',user_id:'owner',organization_id:'org',lease_token:'token',mode:'approval',message:'¿Cómo van mis correos esta semana?'}]};
    if(name==='cowork_reserve_model_call'){
      // Before 20260928030000 the ledger only knows the coordinator in the turn.
      if(state.ledger==='coordinator-only'&&args.p_role!=='coordinator')return {data:null,error:{message:'Specialist attempt unavailable'}};
      return {data:'call-'+args.p_role,error:null};
    }
    return {data:true};},from:table=>{chain.table=table;return chain;}};}`,
  '@/lib/server/daily-quota-store': 'export const getEffectiveDailyQuotaLimits=async()=>({leadSearch:50});export const getDailyQuotaStatus=async()=>({allowed:true,count:0,limit:50});export const getEnrichmentQuotaOperation=async()=>null;export const claimEnrichmentQuotaOperation=async()=>{throw new Error("unused")};export const markEnrichmentQuotaOperationSubmitted=async()=>{};export const releaseEnrichmentQuotaOperation=async()=>{};export const completeEnrichmentQuotaOperation=async()=>{};',
  './access': 'export const requireCoworkWorkerAccess=async()=>{};',
  './runs': 'export const coworkWorkerConfigured=()=>true;export const getCoworkRun=async()=>null;',
  './lead-tools': 'export const queryCoworkLeads=async()=>{throw new Error("unexpected read")};',
  './conversation-context': 'export const loadCoworkHistory=async()=>({turns:[]});',
  './user-context': 'export const loadCoworkUserContext=async()=>({fullName:"Nicolás Yarur",companyName:"Yago"});',
  './external-search': 'export const processCoworkSearchQueue=async()=>({claimed:false});',
  './effects': 'export const processCoworkEffectQueue=async()=>({claimed:false});export const resolveCoworkEffect=async()=>true;',
  // The correction's read: the campaigns, with the one that does worst.
  './operations': 'export const coworkOperationHash=()=>"hash";export const createCoworkOperationGateway=()=>({invoke:async(scope,call)=>{globalThis.__coworkJudge.reads.push(call.capability);return {items:[{name:"AXIS RR. HH.",sent:40,replies:1}]};}});export const createCoworkOperationDependencies=()=>{throw new Error("unused dependencies")};',
  './read-capabilities': 'export const coworkReadCapabilities=()=>[];',
  '@/lib/cowork/agent-instructions': 'export const coworkAgentInstructions=()=>({systemPrompt:"fixture",parallelReadCapability:"",researchCapability:"",externalSearchCapability:"",additionalCapability:"",effectCapability:""});',
  './draft-from-research': 'export const processCoworkDraftQueue=async()=>({claimed:false});',
  './research-read': 'export const readCoworkResearch=async()=>{};',
};
const bundle = await build({ entryPoints: ['src/lib/server/cowork/worker.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'fixture', setup(build) {
  build.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
  build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path] }));
} }] });
const bundled = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
const run = async script => {
  state.calls = []; state.generations = []; state.reads = []; state.script = script;
  await bundled.exports.processCoworkQueue();
  const named = name => state.calls.filter(call => call.name === name).map(call => call.args);
  assert.equal(state.script.length, 0, 'every scripted call was made');
  return {
    drafts: named('cowork_write_run_draft'),
    roles: named('cowork_reserve_model_call').map(args => args.p_role),
    steps: named('cowork_record_tool_result').filter(args => args.p_payload.action === 'assistant.agent').map(args => args.p_payload.result),
    who: state.generations.map(call => `${call.who}${call.streamed ? ':streamed' : ''}`),
    timeouts: state.generations.map(call => `${call.who}:${call.timeoutMs}`),
    finished: named('cowork_finish_run')[0],
  };
};
const line = step => `${step.agent}:${step.state}:${step.label}`;
try {
  process.env.COWORK_JUDGE_ENABLED = 'true';
  // An answer that offers a free read: the judge asks for a fix, the correction makes that read
  // and answers with what it found. The page keeps the first text, marked as being reviewed.
  const fixed = await run([offered, worth, readCampaigns, complete]);
  assert.deepEqual(fixed.who, ['coordinator:streamed', 'judge', 'coordinator', 'coordinator']);
  assert.deepEqual(fixed.roles, ['coordinator', 'judge', 'coordinator', 'coordinator']);
  assert.deepEqual(state.reads, ['campaigns.list']);
  assert.deepEqual(fixed.steps.map(line), ['judge:working:Revisando la respuesta', 'judge:working:Ajustando la respuesta', 'judge:done:Ajustó la respuesta']);
  assert.equal(fixed.steps.at(-1).outcome, 'fixed');
  assert.equal(fixed.drafts.filter(draft => !draft.p_progress.reviewing).at(-1).p_text, offered.answer.reply);
  assert.equal(fixed.drafts.at(-1).p_progress.reviewing, true);
  assert.equal(fixed.finished.p_status, 'completed');
  assert.ok(fixed.finished.p_payload.reply.startsWith(complete.answer.reply), fixed.finished.p_payload.reply);
  assert.equal(fixed.finished.p_payload.question, complete.answer.question);
  assert.deepEqual(fixed.finished.p_payload.telemetry.map(call => call.model), ['coordinator-model', 'judge-model', 'coordinator-model', 'coordinator-model']);

  // Nothing to fix: one judge call, and the answer goes out as it was.
  const kept = await run([offered, clean]);
  assert.deepEqual(kept.who, ['coordinator:streamed', 'judge']);
  assert.deepEqual(kept.steps.map(line), ['judge:working:Revisando la respuesta', 'judge:done:Sin ajustes']);
  assert.ok(kept.finished.p_payload.reply.startsWith(offered.answer.reply));
  // The judge reads the rules the coordinator works with: the person imports while contacts.import is off,
  // and Cowork proposes the import once it is on (F4).
  assert.match(state.generations[1].rules, /un correo que no está guardado lo importa el usuario/);
  process.env.COWORK_CONTACTS_IMPORT_ENABLED = 'true';
  await run([offered, clean]);
  assert.match(state.generations[1].rules, /importa a las personas de un archivo subido/);
  assert.doesNotMatch(state.generations[1].rules, /lo importa el usuario/);
  delete process.env.COWORK_CONTACTS_IMPORT_ENABLED;

  // The correction fails: the judged answer stands and the row says it could not fix it.
  const failed = await run([offered, worth, new Error('model timeout')]);
  assert.equal(failed.finished.p_status, 'completed');
  assert.ok(failed.finished.p_payload.reply.startsWith(offered.answer.reply));
  assert.deepEqual(failed.steps.at(-1), { agent: 'judge', state: 'done', label: 'No alcanzó a ajustarla', outcome: 'skipped', changes: [], detail: { kept: 'first', reason: null } });
  // What the judge found stays with its step for whoever reviews the turn later.
  assert.deepEqual(failed.steps[1].detail, { engine: 'llm', model: 'judge-model', durationMs: 1, canRead: true, asked: true,
    scores: worth.scores, problemas: worth.problemas, veredicto: 'mala' });

  // A correction that is not one (a figure neither in the first answer nor in the data): the first answer stands.
  const invented = answer('Esta semana abrieron el 42 % de tus correos y respondió el 3 %. La que rinde menos es «AXIS RR. HH.», con 9 % de apertura.',
    '¿Ajusto el primer correo de «AXIS RR. HH.»?');
  const guarded = await run([offered, worth, readCampaigns, invented]);
  assert.ok(guarded.finished.p_payload.reply.startsWith(offered.answer.reply), guarded.finished.p_payload.reply);
  assert.deepEqual(guarded.steps.at(-1), { agent: 'judge', state: 'done', label: 'Dejó la primera respuesta', outcome: 'skipped', changes: [],
    detail: { kept: 'first', reason: 'new_figures' } });

  // The judge's call fails: the answer goes out, and the row says it could not review it.
  const unjudged = await run([offered, new Error('judge timeout')]);
  assert.ok(unjudged.finished.p_payload.reply.startsWith(offered.answer.reply));
  assert.deepEqual(unjudged.steps.map(line), ['judge:working:Revisando la respuesta', 'judge:done:No alcanzó a revisar']);

  // Held (COWORK_ANSWER_HOLD_ENABLED): the page never gets text, only the phase the answer is in and
  // never backwards; the correction is written held too, the judge gets 8 s, and the corrected answer
  // is the one that goes out: nobody saw the first one.
  process.env.COWORK_ANSWER_HOLD_ENABLED = 'true';
  const held = await run([offered, worth, readCampaigns, complete]);
  assert.deepEqual(held.who, ['coordinator:streamed', 'judge', 'coordinator:streamed', 'coordinator:streamed']);
  assert.ok(held.drafts.length >= 3);
  assert.ok(held.drafts.every(draft => draft.p_text === '' && !draft.p_progress.reviewing), 'no text travels while the answer is held');
  assert.deepEqual(held.drafts.map(draft => draft.p_progress.phase).filter((phase, index, all) => phase !== all[index - 1]), ['writing', 'reviewing', 'adjusting']);
  assert.deepEqual(held.timeouts, ['coordinator:30000', 'judge:8000', 'coordinator:30000', 'coordinator:30000']);
  assert.ok(held.finished.p_payload.reply.startsWith(complete.answer.reply));
  assert.deepEqual(held.steps.at(-1), { agent: 'judge', state: 'done', label: 'Ajustó la respuesta', outcome: 'fixed', changes: [], detail: { kept: 'correction' } });
  // Held with nothing to fix: written, reviewed, and out as it was.
  const heldClean = await run([offered, clean]);
  assert.deepEqual(heldClean.drafts.map(draft => draft.p_progress.phase).filter((phase, index, all) => phase !== all[index - 1]), ['writing', 'reviewing']);
  assert.ok(heldClean.finished.p_payload.reply.startsWith(offered.answer.reply));
  delete process.env.COWORK_ANSWER_HOLD_ENABLED;

  // Before the ledger knows the judge, its call counts as the coordinator's.
  state.ledger = 'coordinator-only';
  const before = await run([offered, worth, readCampaigns, complete]);
  assert.deepEqual(before.roles, ['coordinator', 'judge', 'coordinator', 'coordinator', 'coordinator']);
  assert.ok(before.finished.p_payload.reply.startsWith(complete.answer.reply));
  state.ledger = 'roles';

  // With the Writer on too, the Writer's answer went through the Reviewer: the judge does not read it.
  process.env.COWORK_WRITER_ENABLED = 'true';
  const writer = await run([handOff, written, { verdict: 'ok', issues: [] }]);
  assert.deepEqual(writer.who.map(who => who.replace(':streamed', '')), ['coordinator', 'writer', 'reviewer']);
  assert.ok(!writer.steps.some(step => step.agent === 'judge'));
  delete process.env.COWORK_WRITER_ENABLED;

  // Off (the default): no judge call, no steps.
  delete process.env.COWORK_JUDGE_ENABLED;
  const off = await run([offered]);
  assert.deepEqual(off.who, ['coordinator:streamed']);
  assert.deepEqual(off.steps, []);
  assert.ok(off.finished.p_payload.reply.startsWith(offered.answer.reply));
  console.log('PASS: the judge reads the coordinator\'s answer, its correction may read once and replaces it, a failed correction, a correction with an unsupported figure or a failed call lets the answer stand, each step is recorded with what the judge found, held the page only gets phases, the ledger falls back to the coordinator\'s role, the Writer\'s answers are not judged, it reads whether importing is on, and off nothing changes.');
} finally {
  delete globalThis.__coworkJudge;
  for (const [key, value] of Object.entries(environment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
