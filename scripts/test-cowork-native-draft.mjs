// Exercise durable draft boundaries with the native generator mocked. No providers or DB writes.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const id = '00000000-0000-4000-8000-000000000001';
const envBefore = {
  enabled: process.env.COWORK_ENABLED,
  drafts: process.env.COWORK_NATIVE_DRAFTS_ENABLED,
  owner: process.env.COWORK_OWNER_USER_ID,
};
process.env.COWORK_ENABLED = 'true';
process.env.COWORK_NATIVE_DRAFTS_ENABLED = 'true';
process.env.COWORK_OWNER_USER_ID = 'owner-id';

const state = {
  observed: true,
  revoked: false,
  take: null, // job row returned by cowork_take_draft
  draftResult: 'drafted', // 'drafted' | 'blocked' | 'crash'
  rpc: [],
  finishes: [],
  nativeCalls: [],
};
globalThis.__coworkDraftFixture = state;

const mocks = {
  './runs': `export const getCoworkRun=async()=>({run:{status:'completed'},events:globalThis.__coworkDraftFixture.observed?[{kind:'tool.completed',payload:{action:'research.get_existing',result:{availability:'available',research:{snapshotId:'${id}'}}}},{kind:'draft.completed',payload:{snapshotId:'${id}',draftId:'draft-id',subject:'Asunto',text:'Texto'}}]:[]});`,
  '@/lib/server/native-drafts': `export async function createNativeDraft(input){globalThis.__coworkDraftFixture.nativeCalls.push(input);const mode=globalThis.__coworkDraftFixture.draftResult;if(mode==='crash')throw new Error('provider timeout');if(mode==='blocked')return {status:'blocked',code:'MISSING_EMAIL',message:'Falta correo'};return {status:'drafted',draft:{draftId:'draft-id',content:{subject:'Asunto',text:'Texto'},recipient:{email:'test@example.com'}}};}`,
  '@/lib/server/supabase-admin': `export const getSupabaseAdminClient=()=>globalThis.__coworkDraftFixture.admin;`,
  './access': 'export const requireCoworkWorkerAccess=async()=>{if(globalThis.__coworkDraftFixture.revoked)throw new Error("revoked")};',
  '@/lib/research-contracts': 'export const ResearchSnapshotV1Schema={parse:value=>value};',
};

function makeAdmin(rows) {
  return {
    rpc: async (name, args) => {
      state.rpc.push(name);
      if (name === 'cowork_request_draft') return { data: { status: 'pending', reused: false }, error: null };
      if (name === 'cowork_take_draft') return { data: state.take ? [state.take] : [], error: null };
      if (name === 'cowork_finish_draft') { state.finishes.push(args); return { data: true, error: null }; }
      throw new Error(`unexpected rpc ${name}`);
    },
    from(table) {
      const where = {};
      const q = {
        select: () => q,
        eq: (k, v) => { where[k] = v; return q; },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        single: async () => ({ data: rows[table] ?? null, error: null }),
      };
      return q;
    },
  };
}

const snapshotPayload = { id, scope: { ownerUserId: 'owner', organizationId: 'org' }, subject: { leadId: id } };
const authRows = {
  research_snapshots: { payload: snapshotPayload },
  leads: { id },
};
const auth = {
  user: { id: 'owner' }, organizationId: 'org',
  supabase: {
    from(table) {
      const where = {};
      const q = {
        select: () => q,
        eq: (k, v) => { where[k] = v; return q; },
        maybeSingle: async () => {
          assert.equal(where.user_id, 'owner');
          assert.equal(where.organization_id, 'org');
          if (table === 'research_snapshots') return { data: { payload: snapshotPayload }, error: null };
          if (table === 'leads') return { data: { id }, error: null };
          if (table === 'cowork_draft_requests') return { data: null, error: null };
          throw new Error(`unexpected table ${table}`);
        },
      };
      return q;
    },
  },
};

const bundle = await build({ entryPoints: ['src/lib/server/cowork/draft-from-research.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'isolated', setup(build) {
  build.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
  build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path] }));
} }] });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { requestCoworkDraft, getCoworkDraftStatus, processCoworkDraftQueue, coworkDraftIdempotencyKey } = module.exports;

try {
  state.admin = makeAdmin({});
  // Request is validated before any queue write.
  state.observed = false;
  await assert.rejects(requestCoworkDraft(auth, 'work', { snapshotId: id }), /NOT_OBSERVED/);
  assert.ok(!state.rpc.includes('cowork_request_draft'));
  state.observed = true;
  state.revoked = true;
  await assert.rejects(requestCoworkDraft(auth, 'work', { snapshotId: id }), /revoked/);
  assert.ok(!state.rpc.includes('cowork_request_draft'));
  state.revoked = false;
  const queued = await requestCoworkDraft(auth, 'work', { snapshotId: id });
  assert.equal(queued.queued === undefined ? queued.status : 'pending', 'pending');
  // Stable native key across retries.
  assert.equal(
    coworkDraftIdempotencyKey('work', id),
    coworkDraftIdempotencyKey('work', id),
  );
  assert.match(coworkDraftIdempotencyKey('work', id), /work/);

  // Worker: no job -> idle.
  state.take = null;
  assert.deepEqual(await processCoworkDraftQueue(), { processed: 0, claimed: false });

  // Worker: happy path generates with the stable key and finishes exactly once.
  state.take = { run_id: 'work', snapshot_id: id, user_id: 'owner', organization_id: 'org' };
  state.admin = makeAdmin({
    research_snapshots: { payload: snapshotPayload },
    leads: { id },
    cowork_runs: { status: 'completed' },
  });
  const done = await processCoworkDraftQueue();
  assert.equal(done.claimed, true);
  assert.equal(done.processed, 1);
  assert.equal(state.nativeCalls.length, 1);
  assert.equal(state.nativeCalls[0].idempotencyKey, coworkDraftIdempotencyKey('work', id));
  assert.equal(state.finishes.length, 1);
  assert.equal(state.finishes[0].p_success, true);
  assert.equal(state.finishes[0].p_draft_id, 'draft-id');

  // Worker: blocked generation finishes as failed without a draft.
  state.nativeCalls = []; state.finishes = []; state.draftResult = 'blocked';
  const blocked = await processCoworkDraftQueue();
  assert.equal(blocked.claimed, true);
  assert.equal(blocked.processed, 0);
  assert.equal(state.finishes[0].p_success, false);

  // Worker: crash leaves the job executing for the stale path (no premature failure event).
  state.nativeCalls = []; state.finishes = []; state.draftResult = 'crash';
  const crashed = await processCoworkDraftQueue();
  assert.equal(crashed.claimed, true);
  assert.equal(crashed.processed, 0);
  assert.equal(state.finishes.length, 0);
  state.draftResult = 'drafted';

  // Status recovery reads the persisted completion event.
  const status = await getCoworkDraftStatus(
    { ...auth, supabase: { from(table) {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { status: 'completed', draft_id: 'draft-id' }, error: null }) };
      return q;
    } } }, 'work', id);
  assert.equal(status.status, 'completed');
  assert.equal(status.draft.subject, 'Asunto');

  console.log('PASS: observed enqueue, stable key, background generation, blocked/crash handling and status recovery.');
} finally {
  delete globalThis.__coworkDraftFixture;
  for (const [key, value] of Object.entries(envBefore)) {
    const name = { enabled: 'COWORK_ENABLED', drafts: 'COWORK_NATIVE_DRAFTS_ENABLED', owner: 'COWORK_OWNER_USER_ID' }[key];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}
