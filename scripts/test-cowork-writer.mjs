// The Writer and the Reviewer inside the worker (plan 2, G1): the coordinator hands a brief,
// the Writer streams into the live draft, the Reviewer asks for one fix, and the page gets
// each agent's step. No app environment, credentials or providers: everything is mocked.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const keys = ['COWORK_ENABLED', 'COWORK_STREAMING_ENABLED', 'COWORK_WRITER_ENABLED', 'COWORK_MODEL_BUDGET_ENABLED', 'COWORK_WRITER_MODEL', 'COWORK_REVIEWER_MODEL', 'COWORK_MODEL'];
const environment = Object.fromEntries(keys.map(key => [key, process.env[key]]));
Object.assign(process.env, { COWORK_ENABLED: 'true', COWORK_STREAMING_ENABLED: 'true', COWORK_MODEL_BUDGET_ENABLED: 'true', COWORK_MODEL: 'coordinator-model',
  COWORK_WRITER_MODEL: 'writer-model', COWORK_REVIEWER_MODEL: 'reviewer-model' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const findings = 'Felipe y Camila tienen correo y nunca recibieron nada; Marcela queda fuera porque ya le escribiste.';
const brief = { kind: 'sequence', recipients: ['Felipe Muñoz', 'Camila Fuentes'], objective: 'Una conversación sobre AXIS', angle: null, tone: 'cercano', steps: 3, notes: null, findings };
const handOff = { action: 'draft.write', query: null, leadId: null, answer: null, write: brief };
const answer = { action: 'answer', query: null, leadId: null, answer: { reply: 'Te dejo la secuencia que escribí yo.', document: null, question: '¿Creo la campaña pausada?', blocks: null,
  suggestions: [{ label: 'Sí, créala', message: 'Sí, crea la campaña pausada' }] } };
const signed = body => `Hola,\n${body}\n¿Te sirve verlo 15 minutos esta semana?\nNicolás Yarur`;
const sequence = bodies => ({ reply: `${findings} Usé el tiempo que pierde RR. HH. revisando antecedentes a mano.`,
  blocks: [{ type: 'sequence', title: 'Secuencia AXIS', steps: bodies.map((body, index) => ({ day: [1, 3, 7][index], subject: `Asunto ${index + 1}`, body: signed(body) })) }],
  question: '¿Creo la campaña pausada para Felipe y Camila?', suggestions: [{ label: 'Sí, créala', message: 'Sí, crea la campaña pausada' }] });
const first = sequence(['AXIS atiende a 500 empresas.', 'Revisas antecedentes en minutos.', 'Sin trámites en el PJUD.']);
const fixed = sequence(['Revisas antecedentes en el día.', 'Revisas antecedentes en minutos.', 'Sin trámites en el PJUD.']);
const review = { verdict: 'fix', issues: [{ where: '«Secuencia AXIS», correo 1', problem: 'Dice que AXIS atiende a 500 empresas, dato que no está en los datos.', fix: 'Quita la cifra.', short: 'sin cifras inventadas' }] };

const state = { calls: [], generations: [], script: [], ledger: 'roles' };
globalThis.__coworkWriter = state;
state.generate = async opts => {
  const who = opts.systemPrompt.startsWith('Eres la Redactora') ? 'writer' : opts.systemPrompt.startsWith('Eres la Revisora') ? 'reviewer' : 'coordinator';
  const data = state.script.shift();
  state.generations.push({ who, model: opts.openAiModel, streamed: typeof opts.onPartial === 'function' });
  if (opts.onPartial) {
    // The Writer takes a moment before its first words, as the model does.
    if (who === 'writer') await pause(500);
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
  '@/ai/openai-json': 'export const generateStructuredWithTelemetry=opts=>globalThis.__coworkWriter.generate(opts);export const generateStructured=async()=>{throw new Error("unused")};',
  '@/lib/server/supabase-admin': `export const getSupabaseAdminClient=()=>{const chain={table:'',select:()=>chain,eq:()=>chain,gt:()=>chain,limit:()=>chain,in:()=>chain,order:()=>chain,
  maybeSingle:async()=>({data:chain.table==='cowork_runs'?{id:'run',parent_run_id:null,depth:0}:null,error:null}),
  single:async()=>({data:{status:'running',lease_token:'token'},error:null}),
  then(resolve){resolve({data:[],error:null});}};
  return{rpc:async(name,args)=>{const state=globalThis.__coworkWriter;state.calls.push({name,args});
    if(name==='cowork_claim_run')return {data:[{id:'run',user_id:'owner',organization_id:'org',lease_token:'token',mode:'approval',message:'Armame una secuencia para RR. HH.'}]};
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
  './operations': 'export const coworkOperationHash=()=>"hash";export const createCoworkOperationGateway=()=>({invoke:async()=>{throw new Error("unused gateway")}});export const createCoworkOperationDependencies=()=>{throw new Error("unused dependencies")};',
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
  state.calls = []; state.generations = []; state.script = script;
  await bundled.exports.processCoworkQueue();
  const named = name => state.calls.filter(call => call.name === name).map(call => call.args);
  return {
    drafts: named('cowork_write_run_draft'),
    roles: named('cowork_reserve_model_call').map(args => args.p_role),
    steps: named('cowork_record_tool_result').filter(args => args.p_payload.action === 'assistant.agent').map(args => args.p_payload.result),
    finished: named('cowork_finish_run')[0],
  };
};
try {
  // On: the Writer writes the turn's emails, streamed, and the Reviewer's fix is applied once.
  process.env.COWORK_WRITER_ENABLED = 'true';
  const on = await run([handOff, first, review, fixed]);
  assert.deepEqual(state.generations, [
    { who: 'coordinator', model: 'coordinator-model', streamed: true }, { who: 'writer', model: 'writer-model', streamed: true },
    { who: 'reviewer', model: 'reviewer-model', streamed: false }, { who: 'writer', model: 'writer-model', streamed: false },
  ]);
  assert.deepEqual(on.roles, ['coordinator', 'writer', 'reviewer', 'writer']);
  assert.deepEqual(on.steps.map(step => `${step.agent}:${step.state}:${step.label}`), [
    'writer:working:Escribiendo 3 correos', 'writer:done:Escribió 3 correos', 'reviewer:working:Revisando 3 correos',
    'reviewer:working:Aplicando 1 ajuste', 'reviewer:done:1 ajuste',
  ]);
  assert.deepEqual(on.steps.at(-1), { agent: 'reviewer', state: 'done', label: '1 ajuste', outcome: 'fixed', changes: ['sin cifras inventadas'] });
  // The page shows the Writer's words as they come, with the cards.
  const shown = on.drafts.filter(draft => !draft.p_progress.reviewing);
  assert.ok(shown.length >= 2, `drafts: ${shown.length}`);
  assert.equal(shown.at(-1).p_text, first.reply);
  assert.deepEqual(shown.at(-1).p_progress.cards, [{ type: 'sequence', title: 'Secuencia AXIS', parts: 3 }]);
  const texts = shown.map(draft => draft.p_text);
  assert.ok(texts.every((text, index) => index === 0 || text.startsWith(texts[index - 1])), 'the text only grows');
  // While it is reviewed the page says so and keeps the text.
  assert.equal(on.drafts.at(-1).p_progress.reviewing, true);
  // The answer that counts: the Writer's corrected reply and sequence.
  assert.equal(on.finished.p_status, 'completed');
  assert.ok(on.finished.p_payload.reply.startsWith(fixed.reply), on.finished.p_payload.reply);
  assert.equal(on.finished.p_payload.blocks[0].steps[0].body, fixed.blocks[0].steps[0].body);
  assert.equal(on.finished.p_payload.question, fixed.question);
  assert.deepEqual(on.finished.p_payload.telemetry.map(call => call.model), ['coordinator-model', 'writer-model', 'reviewer-model', 'writer-model']);

  // Before the ledger knows the in-turn agents, their calls count as the coordinator's.
  state.ledger = 'coordinator-only';
  const before = await run([handOff, first, review, fixed]);
  assert.deepEqual(before.roles, ['coordinator', 'writer', 'coordinator', 'reviewer', 'coordinator', 'writer', 'coordinator']);
  assert.ok(before.finished.p_payload.reply.startsWith(fixed.reply));
  state.ledger = 'roles';

  // Off (the default): a brief is refused and the coordinator writes the emails itself.
  delete process.env.COWORK_WRITER_ENABLED;
  const off = await run([handOff, answer]);
  assert.deepEqual(state.generations.map(call => call.who), ['coordinator', 'coordinator']);
  assert.deepEqual(off.steps, []);
  assert.ok(off.finished.p_payload.reply.startsWith(answer.answer.reply));
  console.log('PASS: the Writer streams the turn\'s emails, the Reviewer\'s fix is applied once, each agent\'s step is recorded, the ledger falls back to the coordinator\'s role, and off it is refused.');
} finally {
  delete globalThis.__coworkWriter;
  for (const [key, value] of Object.entries(environment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
