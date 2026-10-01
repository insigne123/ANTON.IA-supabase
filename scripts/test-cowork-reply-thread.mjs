// Answering inside the thread: staging, the approval card and the approved send, over in-memory stand-ins of the tables, the providers and the
// dispatch ledger. No database, mailbox, provider, secret or env file: nothing is ever sent.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const RUN = '00000000-0000-4000-8000-000000000041';
const USER = '00000000-0000-4000-8000-0000000000aa';
const ORG = '00000000-0000-4000-8000-0000000000bb';
const GMAIL_ID = '00000000-0000-4000-8000-0000000000c1';
const OUTLOOK_ID = '00000000-0000-4000-8000-0000000000c2';
const DAY = 86_400_000;
const iso = days => new Date(Date.now() - days * DAY).toISOString();

const conversation = (overrides = {}) => ({
  id: GMAIL_ID, user_id: USER, organization_id: ORG, lead_id: null, name: 'Marcela Rojas', email: 'mrojas@sernorte.cl', company: 'Servicios Norte', role: 'Gerente',
  provider: 'gmail', subject: 'Antecedentes laborales en minutos', sent_at: iso(6), status: 'sent', delivery_status: 'delivered',
  message_id: 'm-1', thread_id: 't-1', conversation_id: null, replied_at: iso(2), reply_intent: 'positive', reply_sentiment: 'positive',
  reply_summary: 'Le interesa', reply_subject: 'Re: Antecedentes laborales en minutos', reply_preview: null, reply_snippet: null,
  last_reply_text: 'Hola, me interesó. ¿Cuánto cuesta por persona?', reply_confidence: 0.9, conversation_outbound_at: null, conversation_resolved_at: null,
  ...overrides,
});

const state = {
  workStatus: 'running', runStatus: 'waiting_approval', proposal: { status: 'executing', kind: 'reply_thread', target_id: '' }, access: true,
  conversations: [], staged: null, excludedDomains: [], suppressed: false, suppressedThrows: false, language: { verdict: 'pass' },
  token: { refresh_token: 'fake-refresh' }, quota: { allowed: true }, replyTargetError: false, dispatchStatus: 'sent',
  sent: [], dispatches: [], projected: [], updates: 0,
  userContext: { fullName: 'Nicolás Yarur', jobTitle: 'Gerente comercial', companyName: 'Yago', companyDomain: 'yago.cl', offer: 'Revisión de antecedentes laborales en minutos', offerSource: 'profile' },
};
globalThis.__replyTest = state;
const flag = process.env.COWORK_REPLY_THREAD_ENABLED;
process.env.COWORK_REPLY_THREAD_ENABLED = 'true';

/** A PostgREST-like builder over the in-memory tables: only what the module uses. */
function table(name) {
  const s = globalThis.__replyTest;
  const query = { filters: [], pending: null, patch: null };
  const matching = rows => rows.filter(row => query.filters.every(([column, value]) => row[column] === value));
  const result = () => {
    if (query.pending) return query.pending();
    if (name === 'contacted_leads') return { data: matching(s.conversations), error: null };
    if (name === 'excluded_domains') return { data: s.excludedDomains.map(domain => ({ domain })), error: null };
    return { data: [], error: null };
  };
  const builder = {
    select: () => builder,
    eq: (column, value) => { query.filters.push([column, value]); return builder; },
    maybeSingle: async () => {
      if (query.pending) return query.pending(true);
      if (name === 'cowork_runs') return { data: { status: s.workStatus }, error: null };
      if (name === 'cowork_effect_proposals') return { data: s.proposal, error: null };
      if (name === 'cowork_reply_proposals') return { data: s.staged, error: null };
      return { data: matching(s.conversations)[0] ?? null, error: null };
    },
    upsert: (values, options) => {
      if (name === 'cowork_reply_proposals') {
        query.pending = () => {
          if (s.staged && options.ignoreDuplicates) return { data: null, error: null };
          s.staged = JSON.parse(JSON.stringify(values));
          return { data: { run_id: values.run_id }, error: null };
        };
      }
      return builder;
    },
    update: patch => {
      if (name === 'contacted_leads') {
        query.pending = () => {
          s.updates++;
          for (const row of matching(s.conversations)) Object.assign(row, patch);
          s.projected.push(patch);
          return { data: null, error: null };
        };
      }
      return builder;
    },
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return builder;
}
state.table = table;

const sources = {
  '@/lib/server/supabase-admin': 'export const getSupabaseAdminClient=()=>({from:t=>globalThis.__replyTest.table(t)});',
  './access': 'export const requireCoworkWorkerAccess=async()=>{if(!globalThis.__replyTest.access)throw new Error("denied");};',
  './runs': 'export const getCoworkRun=async()=>({run:{status:globalThis.__replyTest.runStatus},events:[]});',
  '@/lib/messaging-contracts': 'export const createLegacyReadyEmailDraftV1=x=>({content:{...x},versionId:"v"});export const createMessagingSendMetadataV1=(draft,m)=>({...m,draft:draft.versionId});',
  '@/lib/email-outbound': 'export const prepareOutboundEmail=({text,unsubscribeUrl})=>({text:text+"\\n\\nBaja: "+unsubscribeUrl,html:"<p>"+text+"</p><a href=\\""+unsubscribeUrl+"\\">baja</a>"});export const validateOutboundEmail=()=>({ok:true,errors:[]});',
  '@/lib/unsubscribe-helpers': 'export const generateUnsubscribeLink=(to)=>"https://app.test/unsubscribe/"+encodeURIComponent(to);',
  '@/lib/server/privacy-subject-data': 'export const isEmailSuppressedForScope=async()=>{const s=globalThis.__replyTest;if(s.suppressedThrows)throw new Error("down");return s.suppressed;};',
  '@/lib/services/token-service': 'export const tokenService={getToken:async()=>globalThis.__replyTest.token};',
  '@/lib/server-auth-helpers': 'export const refreshGoogleToken=async()=>({access_token:"fake-access"});export const refreshMicrosoftToken=async()=>({access_token:"fake-access",refresh_token:null});',
  '@/lib/server-email-sender': `export const sendGmail=async(token,to,subject,html,options)=>{globalThis.__replyTest.sent.push({provider:"gmail",token,to,subject,html,options});return{id:"gmail-message-1"};};
    export const sendOutlook=async(token,to,subject,html,options)=>{globalThis.__replyTest.sent.push({provider:"outlook",token,to,subject,html,options});return{id:"outlook-message-1"};};`,
  '@/lib/server/token-crypto': 'export const encryptStoredToken=x=>"enc:"+x;',
  '@/lib/server/daily-quota-store': 'export const getEffectiveDailyQuotaLimits=async()=>({contact:50});export const reserveOutboundContactQuota=async()=>globalThis.__replyTest.quota;',
  '@/lib/server/messaging-drafts': 'export const ensureMessagingDraftV1=async()=>undefined;',
  '@/lib/server/reply-target': `export class ReplyTargetError extends Error{};
    export const resolveContactedReplyTarget=async(client,input)=>{if(globalThis.__replyTest.replyTargetError)throw new ReplyTargetError("No pudimos verificar el mensaje original.");
      return input.provider==="gmail"?{provider:"gmail",threadId:"t-1",messageId:"m-1"}:{provider:"outlook",conversationId:"c-1",messageId:"m-1"};};`,
  './user-context': 'export const loadCoworkUserContext=async()=>globalThis.__replyTest.userContext;',
  './message-context': 'export const readCoworkMessageContext=async()=>({context:{prohibitedTerms:["garantizado"],requiredTerms:[]}});',
  '@/lib/cowork/message-checks': 'export const checkMessageTerms=(text,{prohibitedTerms})=>{const found=prohibitedTerms.filter(t=>text.toLowerCase().includes(t));return{verdict:found.length?"blocked":"pass",prohibitedFound:found,requiredMissing:[]};};',
  '@/lib/server/outbound-dispatch': `export class OutboundPreProviderDeferredError extends Error{constructor(message,options){super(message);this.code=options&&options.code;}}
    export const dispatchOutboundMessage=async({draft,metadata,provider})=>{
      const s=globalThis.__replyTest;
      const replay=s.dispatches.find(item=>item.key===metadata.idempotencyKey&&item.status==="sent");
      if(replay)return{dispatch:{status:"sent",providerMessageId:replay.providerMessageId,completedAt:replay.completedAt},replayed:true};
      const record={key:metadata.idempotencyKey,status:"pending",leadRef:draft.content.leadRef,to:draft.content.to};
      s.dispatches.push(record);
      try{
        const outcome=await provider.send({dispatchId:"dispatch-"+s.dispatches.length});
        if(outcome.outcome==="accepted"){record.status="sent";record.providerMessageId=outcome.providerMessageId;record.completedAt=new Date().toISOString();
          return{dispatch:{status:s.dispatchStatus==="sent"?"sent":s.dispatchStatus,providerMessageId:record.providerMessageId,completedAt:record.completedAt}};}
        record.status=outcome.outcome;
        return{dispatch:{status:outcome.outcome==="deferred"?"deferred":"failed",errorCode:outcome.code,errorMessage:outcome.message}};
      }catch(error){record.status="deferred";return{dispatch:{status:"deferred",errorCode:error.code,errorMessage:error.message}};}
    };`,
};
const externals = new RegExp(`^(${Object.keys(sources).map(key => key.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
const result = await build({
  entryPoints: ['src/lib/server/cowork/reply-thread-effect.ts'],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-reply-dependencies', setup(build) {
    build.onResolve({ filter: externals }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: sources[args.path], loader: 'js' }));
  } }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, loaded, loaded.exports);
const { stageCoworkReplyThread, readCoworkReplyThreadPreview, executeCoworkReplyThread, hashCoworkReplyThread, coworkReplyIdempotencyKey } = loaded.exports;
const scope = { userId: USER, organizationId: ORG };
const auth = { user: { id: USER }, organizationId: ORG };
const proposal = (overrides = {}) => ({ contactedId: GMAIL_ID, subject: 'Antecedentes laborales en minutos', body: 'Hola Marcela,\n\nGracias por responder. ¿Cuántas personas necesitas revisar?\n\nSaludos,\nNicolás', ...overrides });
const refuse = (input, pattern) => assert.rejects(stageCoworkReplyThread(scope, RUN, input), pattern);
const reset = () => { state.staged = null; state.sent.length = 0; state.dispatches.length = 0; state.projected.length = 0; state.updates = 0; state.conversations = [conversation()];
  state.suppressed = false; state.suppressedThrows = false; state.excludedDomains = []; state.quota = { allowed: true }; state.replyTargetError = false; state.dispatchStatus = 'sent'; state.workStatus = 'waiting_approval'; state.runStatus = 'waiting_approval'; };

try {
  // 1. Staging: the recipient is the person of the conversation, the subject carries «Re: » once, the text is kept as it will be sent.
  reset();
  const staged = await stageCoworkReplyThread(scope, RUN, proposal({ subject: 'RE: Re: Antecedentes laborales en minutos', body: '  Hola Marcela,  \r\n\r\n\r\n\r\nGracias.  ' }));
  assert.equal(staged.to, 'mrojas@sernorte.cl');
  assert.equal(staged.subject, 'Re: Antecedentes laborales en minutos');
  assert.equal(staged.body, 'Hola Marcela,\n\nGracias.');
  assert.equal(staged.label, 'Responder a Marcela Rojas (Servicios Norte) en su hilo');
  assert.match(staged.hash, /^[a-f0-9]{64}$/);
  assert.deepEqual([state.staged.run_id, state.staged.user_id, state.staged.organization_id, state.staged.contacted_id, state.staged.to_email, state.staged.patch_hash],
    [RUN, USER, ORG, GMAIL_ID, 'mrojas@sernorte.cl', staged.hash]);
  assert.equal(state.sent.length, 0, 'staging sends nothing');
  // The same proposal again keeps it; a different reply in the same work is refused.
  assert.equal((await stageCoworkReplyThread(scope, RUN, proposal({ subject: 'RE: Re: Antecedentes laborales en minutos', body: '  Hola Marcela,  \r\n\r\n\r\n\r\nGracias.  ' }))).hash, staged.hash);
  await refuse(proposal({ body: 'Otro texto' }), /otra respuesta propuesta/);

  // 2. Refusals say why, in words the model can pass on.
  reset();
  await refuse(proposal({ contactedId: '00000000-0000-4000-8000-0000000000ff' }), /no es tuya o ya no existe/);
  state.conversations = [conversation({ user_id: '00000000-0000-4000-8000-0000000000dd' })];
  await refuse(proposal(), /no es tuya o ya no existe/);
  for (const [overrides, pattern] of [
    [{ conversation_outbound_at: iso(1) }, /ya tiene una respuesta/],
    [{ conversation_resolved_at: iso(1) }, /ya tiene una respuesta/],
    [{ reply_intent: 'unsubscribe' }, /pidió no recibir más mensajes/],
    [{ reply_intent: 'negative' }, /dijo que no/],
    [{ reply_intent: 'auto_reply' }, /aviso automático/],
    [{ reply_intent: 'delivery_failure' }, /aviso automático/],
    [{ replied_at: null }, /todavía no ha respondido/],
    [{ thread_id: null }, /No se puede responder dentro del hilo: falta el hilo de Gmail/],
    [{ provider: 'smtp' }, /ni Outlook/],
    [{ email: null }, /no tiene un correo/],
  ]) {
    state.conversations = [conversation(overrides)];
    await refuse(proposal(), pattern);
    assert.equal(state.staged, null, 'nothing is staged for a conversation that takes no reply');
  }
  reset();
  state.suppressed = true;
  await refuse(proposal(), /se dio de baja/);
  state.suppressed = false; state.suppressedThrows = true;
  await refuse(proposal(), /no se pudo verificar|se dio de baja o no se pudo verificar/);
  reset();
  state.workStatus = 'completed';
  await refuse(proposal(), /ya no admite propuestas/);
  reset();
  await refuse(proposal({ body: 'x'.repeat(8001) }), /too_big|8000|Too big/i);
  await refuse(proposal({ subject: '   ' }), /too_small|String must contain|Too small/i);
  await refuse({ ...proposal(), to: 'otra@empresa.cl' }, /Unrecognized key|unrecognized_keys/i);
  assert.equal(state.staged, null);

  // 3. The card: to whom, what they wrote and the exact reply, pinned by the target; and whether the conversation still takes it.
  reset();
  const pinned = await stageCoworkReplyThread(scope, RUN, proposal());
  const target = `replythread:${pinned.hash}`;
  const preview = await readCoworkReplyThreadPreview(auth, RUN, target);
  assert.equal(preview.to, 'mrojas@sernorte.cl');
  assert.deepEqual([preview.name, preview.company, preview.matches, preview.unavailable], ['Marcela Rojas', 'Servicios Norte', true, null]);
  assert.match(preview.theirs.text, /Cuánto cuesta/);
  assert.equal(preview.body, pinned.body);
  assert.equal((await readCoworkReplyThreadPreview(auth, RUN, `replythread:${'f'.repeat(64)}`)).matches, false, 'another target does not match');
  // 3b. The automatic read of the exact reply (COWORK_EMAIL_REVIEW): off asks nobody, on shows what Jev found, and a Jev that does not answer is no review.
  assert.equal(preview.review, null, 'off by default: the card has no review');
  const realFetch = globalThis.fetch; const keyBefore = process.env.TYPESAFE_API_KEY; const modeBefore = process.env.COWORK_EMAIL_REVIEW;
  process.env.TYPESAFE_API_KEY = 'tsk-fake-key-never-recorded';
  const jevCalls = [];
  const jev = probabilities => async (url, init) => {
    jevCalls.push({ url: String(url), auth: init.headers.authorization, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ model: 'jev-latest', usage: { input_tokens: 300 }, answers: Object.fromEntries(Object.keys(JSON.parse(init.body).questions).map(id => [id, { type: 'noul', noul: probabilities[id] ?? 0.05 }])) }) };
  };
  try {
    globalThis.fetch = jev({ contradicts_thread: 0.97 });
    assert.equal((await readCoworkReplyThreadPreview(auth, RUN, target)).review, null, 'off: Jev is not asked even with a key');
    assert.equal(jevCalls.length, 0);
    process.env.COWORK_EMAIL_REVIEW = 'on';
    const flagged = (await readCoworkReplyThreadPreview(auth, RUN, target)).review;
    assert.equal(flagged.checked, true);
    assert.deepEqual(flagged.issues.map(item => item.id), ['contradicts_thread']);
    assert.equal(jevCalls.length, 1);
    assert.equal(jevCalls[0].auth, 'Bearer tsk-fake-key-never-recorded');
    assert.match(jevCalls[0].body.state.conversation.theirLastMessage, /Cuánto cuesta/, 'Jev reads what they wrote');
    assert.equal(jevCalls[0].body.state.draftReply.body, pinned.body, 'and the exact reply that would go out');
    assert.equal(jevCalls[0].body.state.seller.offer, 'Revisión de antecedentes laborales en minutos', 'and what the seller offers');
    assert.deepEqual(Object.keys(jevCalls[0].body.questions), ['contradicts_thread', 'invents_commitment', 'ignores_question']);
    globalThis.fetch = jev({});
    assert.deepEqual((await readCoworkReplyThreadPreview(auth, RUN, target)).review, { checked: true, issues: [] }, 'nothing found');
    globalThis.fetch = async () => { throw new Error('network down'); };
    assert.deepEqual((await readCoworkReplyThreadPreview(auth, RUN, target)).review, { checked: false, issues: [] }, 'a Jev that does not answer fails open');
    const before = jevCalls.length;
    globalThis.fetch = jev({ contradicts_thread: 0.97 });
    assert.equal((await readCoworkReplyThreadPreview(auth, RUN, `replythread:${'f'.repeat(64)}`)).review, null, 'a reply that does not match the proposal is not reviewed');
    assert.equal(jevCalls.length, before);
  } finally {
    globalThis.fetch = realFetch;
    if (keyBefore === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = keyBefore;
    if (modeBefore === undefined) delete process.env.COWORK_EMAIL_REVIEW; else process.env.COWORK_EMAIL_REVIEW = modeBefore;
  }
  state.conversations[0].conversation_outbound_at = iso(0);
  assert.match((await readCoworkReplyThreadPreview(auth, RUN, target)).unavailable, /ya tiene una respuesta/, 'someone answered after the proposal: the card says so before approving');
  state.conversations[0].conversation_outbound_at = null;
  state.staged = null;
  assert.equal(await readCoworkReplyThreadPreview(auth, RUN, target), null);
  state.staged = { run_id: RUN, user_id: USER, organization_id: ORG, contacted_id: GMAIL_ID, to_email: 'mrojas@sernorte.cl', subject: pinned.subject, body: pinned.body, patch_hash: pinned.hash };

  // 4. Execution. The flag is the switch that stops a reply already approved; another target and a changed text are refused.
  state.proposal = { status: 'executing', kind: 'reply_thread', target_id: target };
  delete process.env.COWORK_REPLY_THREAD_ENABLED;
  await assert.rejects(executeCoworkReplyThread(auth, RUN, target), /desactivado por ahora: no se envió nada/);
  assert.equal(state.sent.length + state.dispatches.length, 0);
  process.env.COWORK_REPLY_THREAD_ENABLED = 'true';
  await assert.rejects(executeCoworkReplyThread(auth, RUN, 'sendbatch:abc'), /no es válida/);
  await assert.rejects(executeCoworkReplyThread(auth, RUN, `replythread:${'f'.repeat(64)}`), /ya no está vigente/);
  state.staged.body = `${state.staged.body}\n\nP. D. Escríbeme a otra@empresa.cl`;
  await assert.rejects(executeCoworkReplyThread(auth, RUN, target), /cambió desde tu revisión/);
  state.staged.body = pinned.body;
  state.proposal = { ...state.proposal, status: 'proposed' };
  await assert.rejects(executeCoworkReplyThread(auth, RUN, target), /autorización de envío ya no está vigente/);
  state.proposal = { ...state.proposal, status: 'executing' };
  state.runStatus = 'failed';
  await assert.rejects(executeCoworkReplyThread(auth, RUN, target), /ya no está disponible en este trabajo/);
  state.runStatus = 'waiting_approval';
  assert.equal(state.sent.length + state.dispatches.length, 0, 'nothing went out in any refusal so far');

  // The same guards of a Cowork send, each before the provider.
  const blocked = async (mutate, pattern, restore) => {
    const pointed = mutate() || target;
    await assert.rejects(executeCoworkReplyThread(auth, RUN, pointed), pattern);
    assert.equal(state.sent.length, 0, `nothing sent: ${pattern}`);
    restore();
  };
  await blocked(() => { state.suppressed = true; }, /se dio de baja/, () => { state.suppressed = false; });
  await blocked(() => { state.suppressedThrows = true; }, /No se pudo verificar el estado del destinatario/, () => { state.suppressedThrows = false; });
  await blocked(() => { state.excludedDomains = ['@sernorte.cl']; }, /dominio sernorte\.cl está bloqueado/, () => { state.excludedDomains = []; });
  await blocked(() => { state.staged = { ...state.staged, body: 'Te lo dejamos garantizado.', patch_hash: hashCoworkReplyThread(RUN, GMAIL_ID, 'mrojas@sernorte.cl', pinned.subject, 'Te lo dejamos garantizado.') };
    state.proposal.target_id = `replythread:${state.staged.patch_hash}`; return state.proposal.target_id; },
    /reglas de lenguaje aprobadas \(Término prohibido: garantizado\)/, () => { state.staged = { ...state.staged, body: pinned.body, patch_hash: pinned.hash }; state.proposal.target_id = target; });
  await blocked(() => { state.conversations[0].conversation_outbound_at = iso(0); }, /ya tiene una respuesta/, () => { state.conversations[0].conversation_outbound_at = null; });
  await blocked(() => { state.conversations[0].reply_intent = 'unsubscribe'; }, /pidió no recibir más mensajes/, () => { state.conversations[0].reply_intent = 'positive'; });
  await blocked(() => { state.conversations[0].email = 'otra@sernorte.cl'; }, /destinatario de la conversación cambió/, () => { state.conversations[0].email = 'mrojas@sernorte.cl'; });
  await blocked(() => { state.token = null; }, /Reconecta tu cuenta de correo/, () => { state.token = { refresh_token: 'fake-refresh' }; });
  assert.equal(state.dispatches.length, 0, 'the refusals before the dispatch leave no record');

  // After the claim, still before the provider: the reply target, the quota and a last look at the conversation.
  state.replyTargetError = true;
  await assert.rejects(executeCoworkReplyThread(auth, RUN, target), /No se pudo enviar la respuesta: No pudimos verificar el mensaje original/);
  state.replyTargetError = false;
  state.quota = { allowed: false };
  await assert.rejects(executeCoworkReplyThread(auth, RUN, target), /límite diario de contactos/);
  state.quota = { allowed: true };
  assert.equal(state.sent.length, 0, 'no provider call in any of them');
  state.dispatches.length = 0;

  // 5. The approved reply goes out once, in the thread, exactly as staged; the conversation is marked as answered.
  const done = await executeCoworkReplyThread(auth, RUN, target);
  assert.equal(state.sent.length, 1);
  const [sent] = state.sent;
  assert.equal(sent.provider, 'gmail');
  assert.equal(sent.to, 'mrojas@sernorte.cl');
  assert.equal(sent.subject, 'Re: Antecedentes laborales en minutos');
  assert.match(sent.options.textBody, /^Hola Marcela,\n\nGracias por responder\. ¿Cuántas personas necesitas revisar\?\n\nSaludos,\nNicolás\n\nBaja: /);
  assert.deepEqual(sent.options.replyTarget, { provider: 'gmail', threadId: 't-1', messageId: 'm-1' });
  assert.equal(sent.options.idempotencyKey, coworkReplyIdempotencyKey(pinned.hash));
  assert.match(sent.options.oneClickUnsubscribeUrl, /^https:\/\/app\.test\/api\/tracking\/unsubscribe/);
  assert.deepEqual(state.dispatches.map(item => [item.leadRef, item.to, item.status]), [[`contacted:${GMAIL_ID}`, 'mrojas@sernorte.cl', 'sent']]);
  assert.equal(done.result.status, 'sent');
  assert.equal(done.result.providerMessageId, 'gmail-message-1');
  assert.match(done.reply, /La respuesta salió en el hilo con el texto aprobado a Marcela Rojas/);
  assert.equal(state.updates, 1);
  assert.ok(state.conversations[0].conversation_outbound_at, 'the conversation now has an answer of ours');
  assert.ok(!('to_email' in (state.projected[0] || {})));

  // Approving the same reply again sends nothing more: the conversation is answered, and the receipt of the first is replayed.
  await assert.rejects(executeCoworkReplyThread(auth, RUN, target), /ya tiene una respuesta/);
  assert.equal(state.sent.length, 1);

  // 6. Outlook: the conversation of the original message, through Microsoft.
  reset();
  state.conversations = [conversation({ id: OUTLOOK_ID, provider: 'outlook', thread_id: null, conversation_id: 'c-1', email: 'hvidal@casinocentral.cl', name: 'Héctor Vidal', company: 'Casino Central' })];
  const outlook = await stageCoworkReplyThread(scope, RUN, proposal({ contactedId: OUTLOOK_ID, body: 'Hola Héctor, el martes en la mañana nos acomoda.' }));
  state.proposal = { status: 'executing', kind: 'reply_thread', target_id: `replythread:${outlook.hash}` };
  const outlookDone = await executeCoworkReplyThread(auth, RUN, `replythread:${outlook.hash}`);
  assert.equal(state.sent[0].provider, 'outlook');
  assert.deepEqual(state.sent[0].options.replyTarget, { provider: 'outlook', conversationId: 'c-1', messageId: 'm-1' });
  assert.equal(outlookDone.result.providerMessageId, 'outlook-message-1');

  // 7. A send that is not confirmed never reads as sent and is never repeated by itself.
  reset();
  state.dispatchStatus = 'unknown';
  const unknown = await stageCoworkReplyThread(scope, RUN, proposal());
  state.proposal = { status: 'executing', kind: 'reply_thread', target_id: `replythread:${unknown.hash}` };
  await assert.rejects(executeCoworkReplyThread(auth, RUN, `replythread:${unknown.hash}`), /No pudimos confirmar si la respuesta salió/);
  assert.equal(state.updates, 0, 'the conversation is not marked as answered');
  console.log('PASS: the recipient is the person of the conversation, refusals say why, the card is pinned to the proposal, every guard runs before the provider, the approved reply goes out once in the thread and marks it answered, and an unconfirmed send never reads as sent.');
} finally {
  delete globalThis.__replyTest;
  if (flag === undefined) delete process.env.COWORK_REPLY_THREAD_ENABLED; else process.env.COWORK_REPLY_THREAD_ENABLED = flag;
}
