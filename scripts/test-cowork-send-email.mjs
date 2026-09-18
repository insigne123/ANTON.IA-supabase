// Fase 2C: version-bound send. No providers, secrets or env files.
// Run with: node --loader ./scripts/ts-test-loader.mjs scripts/test-cowork-send-email.mjs
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { hashMessagingDraftContent } from '@/lib/messaging-contracts';

const USER = '00000000-0000-4000-8000-000000000001';
const ORG = '00000000-0000-4000-8000-000000000002';
const DRAFT = '00000000-0000-4000-8000-000000000003';
const V1 = '00000000-0000-4000-8000-000000000004';
const V2 = '00000000-0000-4000-8000-000000000005';

const baseDraft = (overrides = {}) => ({
  schemaVersion: 1, draftId: DRAFT, versionId: V1, organizationId: ORG, userId: USER,
  researchSnapshotId: null, revision: 1, parentVersionId: null, lifecycle: 'draft', channel: 'email',
  recipient: { leadRef: 'lead-1', displayName: 'Ana', email: 'ana@example.com', linkedinUrl: null },
  content: { subject: 'Propuesta', text: 'Hola Ana, te escribo por…', html: null },
  approval: { status: 'pending', decidedBy: null, decidedAt: null, reason: null },
  preflight: { status: 'pending', checkedAt: null, errors: [], warnings: [] },
  createdAt: new Date().toISOString(), ...overrides,
});
const approvedDraft = () => {
  const draft = baseDraft({ lifecycle: 'ready' });
  draft.approval = { status: 'approved', decidedBy: USER, decidedAt: new Date().toISOString(), reason: null };
  draft.preflight = { status: 'passed', checkedAt: new Date().toISOString(), errors: [], warnings: [] };
  return draft;
};

const state = {
  current: baseDraft(), approved: approvedDraft(),
  approveCalls: 0, dispatches: [], sends: 0,
  suppressed: false, blockedDomains: [], token: { refresh_token: 'rt' }, quota: true,
  gmailFails: false, authorized: true, revokeOnRefresh: false,
};
globalThis.__coworkSend = state;

const sources = {
  './sender': 'export const coworkMailboxIdentity=async()=>({identityHash:globalThis.__coworkSend.senderHash});',
  '@/lib/server/supabase-admin': `export const getSupabaseAdminClient=()=>({from:table=>{const chain={select:()=>chain,eq:()=>chain,
    maybeSingle:async()=>({data:table==='cowork_runs'?{status:'waiting_approval'}:{status:'executing',kind:'send_email',target_id:globalThis.__coworkSend.target},error:null}),
    then:resolve=>resolve({data:globalThis.__coworkSend.blockedDomains.map(domain=>({domain})),error:null})};return chain;}});`,
  './runs': `export const getCoworkRun=async()=>({run:{status:'completed'},events:[]});`,
  './access': 'export const requireCoworkWorkerAccess=async()=>{if(!globalThis.__coworkSend.authorized)throw new Error("revoked")};',
  '@/lib/server/native-drafts': `export const getCurrentNativeDraft=async()=>globalThis.__coworkSend.current;
    export const approveNativeDraft=async()=>{globalThis.__coworkSend.approveCalls++;return globalThis.__coworkSend.approved;};`,
  '@/lib/server/privacy-subject-data': 'export const isEmailSuppressedForScope=async()=>globalThis.__coworkSend.suppressed;',
  '@/lib/services/token-service': 'export const tokenService={getToken:async()=>globalThis.__coworkSend.token};',
  '@/lib/unsubscribe-helpers': 'export const generateUnsubscribeLink=()=>"https://example.com/unsubscribe";',
  '@/lib/server-auth-helpers': 'export const refreshGoogleToken=async()=>{if(globalThis.__coworkSend.revokeOnRefresh)globalThis.__coworkSend.authorized=false;return{access_token:"at"};};export const refreshMicrosoftToken=async()=>({access_token:"at"});',
  '@/lib/server-email-sender': `export const sendGmail=async()=>{globalThis.__coworkSend.sends++;if(globalThis.__coworkSend.gmailFails)throw new Error("provider down");return{id:"pm-1"};};
    export const sendOutlook=async()=>({id:"pm-2"});`,
  '@/lib/server/daily-quota-store': `export const getEffectiveDailyQuotaLimits=async()=>({contact:50});
    export const reserveOutboundContactQuota=async()=>globalThis.__coworkSend.quota?{allowed:true}:{allowed:false};`,
  '@/lib/server/outbound-dispatch': `export class OutboundPreProviderDeferredError extends Error{constructor(message,details){super(message);this.details=details;}}
    export const dispatchOutboundMessage=async({draft,metadata,provider})=>{const s=globalThis.__coworkSend;s.dispatches.push({draft,metadata});
    try{const out=await provider.send({dispatchId:"dispatch-1"});
      if(out.outcome==="accepted")return{dispatch:{status:"sent",providerMessageId:out.providerMessageId}};
      if(out.outcome==="deferred")return{dispatch:{status:"deferred",errorCode:out.code,errorMessage:out.message}};
      return{dispatch:{status:"failed",errorCode:out.code,errorMessage:out.message}};}
    catch(error){if(error instanceof OutboundPreProviderDeferredError)return{dispatch:{status:"deferred",errorCode:error.details?.code,errorMessage:error.message}};
      return{dispatch:{status:"failed",errorCode:"provider_error",errorMessage:error.message}};}};`,
};
const bundle = await build({ entryPoints: ['src/lib/server/cowork/send-email.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-services', setup(b) {
    b.onResolve({ filter: /.*/ }, args => sources[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: sources[args.path] }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const auth = { user: { id: USER }, organizationId: ORG, supabase: {} };
const liveHash = hashMessagingDraftContent(state.current);
const senderSuffix = `:google:${'a'.repeat(64)}`;
state.senderHash = 'a'.repeat(64);
const target = `${DRAFT}:${V1}:${liveHash}${senderSuffix}`;
state.target = target;
try {
  // 1. Drift refuses before approving anything.
  state.target = `${DRAFT}:${V2}:${liveHash}${senderSuffix}`;
  await assert.rejects(
    module.exports.sendCoworkEmail(auth, 'run-1', `${DRAFT}:${V2}:${liveHash}${senderSuffix}`),
    /cambió desde tu revisión/);
  assert.equal(state.approveCalls, 0);
  assert.equal(state.dispatches.length, 0);
  state.target = target;

  // Persisted execution target must match, regardless of model/session claims.
  state.target = `${DRAFT}:${V1}:${'0'.repeat(64)}`;
  await assert.rejects(module.exports.sendCoworkEmail(auth, 'run-1', target), /autorización/);
  assert.equal(state.approveCalls, 0);
  state.target = target;

  // An approval implementation cannot swap content under the same version.
  state.approved = { ...approvedDraft(), content: { ...state.current.content, subject: 'Changed' } };
  await assert.rejects(module.exports.sendCoworkEmail(auth, 'run-1', target), /durante la aprobación/);
  assert.equal(state.dispatches.length, 0);
  state.approved = approvedDraft();

  // 2. Suppressed recipient refuses with no dispatch.
  state.suppressed = true;
  await assert.rejects(module.exports.sendCoworkEmail(auth, 'run-1', target), /dio de baja/);
  assert.equal(state.dispatches.length, 0);
  state.suppressed = false;

  // 3. Blocked domain refuses with no dispatch.
  state.blockedDomains = ['example.com'];
  await assert.rejects(module.exports.sendCoworkEmail(auth, 'run-1', target), /bloqueado/);
  assert.equal(state.dispatches.length, 0);
  state.blockedDomains = [];

  // 4. Missing provider connection refuses before dispatch.
  state.token = null;
  await assert.rejects(module.exports.sendCoworkEmail(auth, 'run-1', target), /Reconecta tu cuenta/);
  assert.equal(state.dispatches.length, 0);
  state.token = { refresh_token: 'rt' };

  state.senderHash = 'b'.repeat(64);
  await assert.rejects(module.exports.sendCoworkEmail(auth, 'run-1', target), /diferido/);
  assert.equal(state.sends, 0, 'switching mailboxes must invalidate review');
  state.senderHash = 'a'.repeat(64);
  state.dispatches = [];

  // 5. Success sends once with a version-bound idempotency key.
  const sent = await module.exports.sendCoworkEmail(auth, 'run-1', target);
  assert.equal(sent.status, 'sent');
  assert.equal(sent.providerMessageId, 'pm-1');
  assert.equal(state.sends, 1);
  assert.equal(state.dispatches.length, 1);

  state.gmailFails = false;
  state.revokeOnRefresh = true;
  const sendsBeforeRevocation = state.sends;
  await assert.rejects(module.exports.sendCoworkEmail(auth, 'run-1', target), /No se pudo enviar/);
  assert.equal(state.sends, sendsBeforeRevocation, 'revocation during refresh prevents provider contact');
  state.authorized = true;
  state.revokeOnRefresh = false;
  assert.equal(state.dispatches[0].metadata.idempotencyKey, `cowork:send:${V1}`);
  assert.equal(state.dispatches[0].draft.versionId, V1);

  // 6. Provider failure stays failed without a second attempt.
  state.gmailFails = true; state.dispatches = [];
  await assert.rejects(module.exports.sendCoworkEmail(auth, 'run-1', target), /No se pudo enviar/);
  assert.equal(state.dispatches.length, 1);

  console.log('PASS: drift refusal, suppression, domain block, connection check, single version-bound send, failure without retry.');
} finally {
  delete globalThis.__coworkSend;
}
