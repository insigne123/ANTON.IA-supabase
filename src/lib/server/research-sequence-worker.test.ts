import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { processResearchSequenceQueue, enqueueResearchSequence, readResearchSequence, researchSequenceView, retryResearchSequence, type SequenceWorkerDependencies } from './research-sequence-worker';
import { buildSharedSequenceBrief } from '@/lib/outreach-sequence-brief';
import { draftContextFixture } from './draft-v2-test-fixtures';

const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const access = { organizationId: uuid(1), userId: uuid(2) };
const context = draftContextFixture();
const prepared = { brief: buildSharedSequenceBrief(context), seller: context.seller, writingStyle: context.style };

// Stateful PostgREST double: updates evaluate predicates at execution, allowing
// overlapping reads to race for the same CAS and preserving partial commits.
function database() {
  const rows: any[] = [];
  const writes: any[] = [];
  let failInitialCheckpoint = false;
  let nextId = 10;
  const client = { from(table: string) {
    assert.equal(table, 'research_sequence_preparations');
    let patch: any = null, insert: any = null, one = false, due = false, max = Infinity;
    const predicates: ((row: any) => boolean)[] = [];
    const builder: any = {
      select() { return builder; }, update(value: any) { patch = value; return builder; },
      upsert(value: any) { insert = value; return builder; },
      eq(key: string, value: any) { predicates.push((row) => row[key] === value); return builder; },
      in(key: string, values: any[]) { predicates.push((row) => values.includes(row[key])); return builder; },
      or() { due = true; return builder; }, order() { return builder; }, limit(n: number) { max = n; return builder; },
      single() { one = true; return builder; }, maybeSingle() { one = true; return builder; },
      then(resolve: any, reject: any) { return Promise.resolve().then(() => {
        if (insert && !rows.some((row) => row.request_key === insert.request_key && row.user_id === insert.user_id && row.organization_id === insert.organization_id)) rows.push({ id: uuid(nextId++), status: 'queued', stage: 'brief', attempt_count: 0, next_retry_at: '2020-01-01T00:00:00.000Z', updated_at: '2020-01-01T00:00:00.000Z', ...insert });
        const selected = rows.filter((row) => predicates.every((predicate) => predicate(row)) && (!due || (['queued', 'retry_scheduled'].includes(row.status) && Date.parse(row.next_retry_at) <= Date.now()) || (due && row.status === 'running' && Date.parse(row.heartbeat_at) < Date.now() - 15 * 60_000))).slice(0, max);
        if (patch?.initial_draft_id && failInitialCheckpoint) { failInitialCheckpoint = false; return { data: null, error: new Error('checkpoint unavailable') }; }
        if (patch) { selected.forEach((row) => Object.assign(row, patch)); writes.push(structuredClone(patch)); }
        return { data: one ? structuredClone(selected[0] || null) : structuredClone(selected), error: null };
      }).then(resolve, reject); },
    };
    return builder;
  } } as any;
  return { rows, writes, client, failInitialCheckpoint: () => { failInitialCheckpoint = true; } };
}

async function harness(followUpCount = 3) {
  const db = database();
  const id = await enqueueResearchSequence(access, { researchSnapshotId: uuid(3), followUpCount }, db.client, async () => true);
  const drafts = new Map<string, any>();
  let draftCalls = 0, reviews = 0;
  const steps: any[] = Array.from({ length: followUpCount }, (_, index) => ({ id: uuid(21 + index), draft: null, nativeDraftId: null, draftGeneration: { status: 'queued', error: null } }));
  const plan = () => ({ steps: structuredClone(steps), autoSend: false, lifecycleState: 'draft' }) as any;
  const makeDraft = (index: number) => ({ draftId: uuid(30 + index), versionId: uuid(40 + index), recipient: { email: 'ada@example.com' }, content: { subject: `Correo ${index}`, text: `Aplicación ${index}` }, approval: { status: 'pending' } });
  const deps: SequenceWorkerDependencies = {
    client: db.client, enabled: async () => true,
    prepareBrief: async () => structuredClone(prepared) as any,
    createDraft: async (input) => {
      assert.equal(db.rows[0].stage, 'initial');
      assert.deepEqual(input.sharedSequenceBrief, prepared.brief);
      assert.deepEqual(input.sellerProfile, prepared.seller);
      draftCalls++;
      if (!drafts.has(uuid(30))) drafts.set(uuid(30), makeDraft(0));
      return { status: 'drafted', draft: drafts.get(uuid(30)) } as any;
    },
    getDraft: async ({ draftId }) => drafts.get(draftId) || null,
    createPlan: async (input) => {
      assert.equal(input.deferGeneration, true);
      assert.equal(input.body.steps.length, followUpCount);
      return { enabled: true, plan: plan() };
    },
    queryPlan: async () => plan(),
    generateFollowUps: async (input) => {
      assert.equal(input.maxDrafts, 1);
      assert.deepEqual(input.sharedSequenceBrief, prepared.brief);
      const index = steps.findIndex((step) => !step.draft);
      const draft = makeDraft(index + 1);
      drafts.set(draft.draftId, draft);
      steps[index] = { ...steps[index], draft: { ...draft, subject: draft.content.subject, body: draft.content.text }, nativeDraftId: draft.draftId, draftGeneration: { status: 'ready', error: null } };
    },
    review: async (brief, messages) => {
      reviews++;
      assert.deepEqual(brief, prepared.brief);
      assert.equal(messages.length, followUpCount + 1);
      assert.ok(messages.every((message) => message.approval.status === 'pending'));
      return { passed: true, issues: [], versionIds: messages.map((message) => message.versionId), model: null, usage: null };
    },
  };
  return { db, id, deps, drafts, steps, counts: () => ({ draftCalls, reviews }), tick: () => processResearchSequenceQueue({}, deps) };
}

test('scheduled worker finishes four persisted slots across independent ticks, with a brief committed before model generation', async () => {
  const h = await harness();
  await h.tick();
  assert.equal(h.db.rows[0].stage, 'initial');
  assert.equal(h.drafts.size, 0);
  for (let turn = 0; turn < 5; turn++) await h.tick();
  assert.equal(h.db.rows[0].status, 'completed');
  assert.equal(h.drafts.size, 4);
  assert.deepEqual(h.counts(), { draftCalls: 1, reviews: 1 });
  assert.equal((await h.tick()).processed, 0);
  const view = await researchSequenceView(h.db.rows[0], h.deps);
  assert.equal(view.slots.length, 4);
  assert.ok(view.slots.every((slot) => slot.status === 'ready'));
  assert.equal(view.researchSnapshotId, h.db.rows[0].request.researchSnapshotId);
  assert.equal(view.styleProfileId, h.db.rows[0].request.styleProfileId);
});

test('zero, one and two follow-ups persist only the selected drafts and never create an empty campaign', async () => {
  for (const count of [0, 1, 2]) {
    const h = await harness(count);
    if (count === 0) h.deps.createPlan = async () => { throw new Error('no plan should be created'); };
    for (let turn = 0; turn < count + 3; turn++) await h.tick();
    assert.equal(h.db.rows[0].status, 'completed');
    assert.equal(h.drafts.size, count + 1);
    const view = await researchSequenceView(h.db.rows[0], h.deps);
    assert.equal(view.followUpCount, count);
    assert.equal(view.slots.length, count + 1);
    assert.equal(view.slots.at(-1)?.name, count ? 'Cierre' : 'Contacto inicial');
    assert.ok(view.slots.every((slot) => slot.status === 'ready'));
  }
});

test('concurrent workers have only one CAS winner and recover an expired lease', async () => {
  const h = await harness();
  const outcomes = await Promise.all([h.tick(), h.tick()]);
  assert.equal(outcomes.reduce((count, result) => count + result.processed, 0), 1);
  Object.assign(h.db.rows[0], { status: 'running', claim_token: uuid(99), heartbeat_at: '2020-01-01T00:00:00.000Z' });
  await h.tick();
  assert.equal(h.counts().draftCalls, 1);
  assert.equal(h.db.rows[0].status, 'queued');
  assert.equal(h.db.rows[0].claim_token, null);
});

test('failed initial checkpoint recovers the deterministic draft rather than creating another initial', async () => {
  const h = await harness();
  await h.tick();
  h.db.failInitialCheckpoint();
  await h.tick();
  assert.equal(h.db.rows[0].status, 'retry_scheduled');
  assert.equal(h.drafts.size, 1);
  assert.equal((await h.tick()).processed, 0, 'backoff must be honored');
  h.db.rows[0].next_retry_at = '2020-01-01T00:00:00.000Z';
  await h.tick();
  assert.equal(h.db.rows[0].initial_draft_id, uuid(30));
  assert.equal(h.drafts.size, 1);
});

test('partial follow-up failure exhausts four retries, retains earlier drafts and resumes only the missing slot', async () => {
  const h = await harness();
  for (let i = 0; i < 3; i++) await h.tick();
  const normal = h.deps.generateFollowUps;
  h.deps.generateFollowUps = async () => { throw new Error('provider unavailable'); };
  for (let i = 0; i < 4; i++) { h.db.rows[0].next_retry_at = '2020-01-01T00:00:00.000Z'; await h.tick(); }
  assert.equal(h.db.rows[0].status, 'failed');
  assert.equal(h.drafts.size, 2);
  assert.equal((await h.tick()).processed, 0);
  await retryResearchSequence(structuredClone(h.db.rows[0]), h.db.client);
  h.deps.generateFollowUps = normal;
  for (let i = 0; i < 3; i++) await h.tick();
  assert.equal(h.db.rows[0].status, 'completed');
  assert.equal(h.drafts.size, 4);
  assert.equal(h.counts().draftCalls, 1);
});

test('editorial issues are durable; changing a reviewed version invalidates its pass and re-review does not regenerate', async () => {
  const h = await harness();
  for (let i = 0; i < 6; i++) await h.tick();
  const changed = h.drafts.get(uuid(30));
  changed.versionId = uuid(89);
  const view = await researchSequenceView(h.db.rows[0], h.deps);
  assert.equal(view.status, 'review_required');
  assert.equal(view.editorial, null);
  await retryResearchSequence(structuredClone(h.db.rows[0]), h.db.client);
  h.deps.review = async (_brief, drafts) => ({ passed: false, issues: ['Correo 2 repite la apertura.'], versionIds: drafts.map((draft) => draft.versionId), model: null, usage: null });
  await h.tick();
  assert.equal(h.db.rows[0].status, 'review_required');
  assert.deepEqual(h.db.rows[0].editorial.issues, ['Correo 2 repite la apertura.']);
  assert.equal(h.drafts.size, 4);
});

test('editorial model usage is recorded as cost telemetry without blocking the save', async () => {
  const h = await harness();
  const recorded: any[] = [];
  h.deps.review = async (_brief, drafts) => ({
    passed: true, issues: [], versionIds: drafts.map((draft) => draft.versionId),
    model: 'gpt-5.6-luna', usage: { inputTokens: 4100, outputTokens: 120, reasoningTokens: 30 },
  });
  h.deps.recordResearchAttempt = async (input) => { recorded.push(input); };
  for (let i = 0; i < 6; i++) await h.tick();
  assert.equal(h.db.rows[0].status, 'completed');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].stage, 'sequence_editorial');
  assert.equal(recorded[0].researchSnapshotId, h.db.rows[0].request.researchSnapshotId);
  assert.equal(recorded[0].model, 'gpt-5.6-luna');
  assert.equal(recorded[0].inputTokens, 4100);
  assert.equal(recorded[0].passed, true);
});

test('job reads require both creator and organization scope', async () => {  const h = await harness();
  assert.equal(await readResearchSequence(h.id, uuid(999), [access.organizationId], h.db.client), null);
  assert.equal(await readResearchSequence(h.id, access.userId, [uuid(999)], h.db.client), null);
  assert.equal((await readResearchSequence(h.id, access.userId, [access.organizationId], h.db.client))?.id, h.id);
});

test('new queue denies direct clients; scheduler and preparation code cannot approve or send', () => {
  const sql = readFileSync('supabase/migrations/20260912120000_research_sequence_preparations.sql', 'utf8');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all .* from public, anon, authenticated/);
  assert.match(sql, /unique \(organization_id, user_id, request_key\)/);
  assert.doesNotMatch(sql, /grant .* to authenticated|create policy/i);
  const worker = readFileSync('src/lib/server/research-sequence-worker.ts', 'utf8');
  assert.doesNotMatch(worker, /runCampaignV2AutoSend|sendGmail|sendOutlook|messaging_dispatches|approval:\s*\{\s*status:\s*'approved'/);
  const route = readFileSync('src/app/api/research-sequences/route.ts', 'utf8');
  assert.match(route, /getNativeSnapshot/);
  assert.match(route, /readResearchSequence\(id, auth.user.id, auth.organizationIds\)/);
  const cron = readFileSync('src/app/api/cron/research-sequences/route.ts', 'utf8');
  assert.match(cron, /if \(!isFirebaseSchedulerRequest\(request\)\)/);
  assert.match(readFileSync('functions/index.ts', 'utf8'), /researchSequencePreparationTick[\s\S]*?\/api\/cron\/research-sequences/);
});
