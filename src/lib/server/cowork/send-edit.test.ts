import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// «Editar correo» in «Aprobar y enviar» (COW-29), with the database and the drafts in memory.
async function load(entry: string, stubs: Record<string, string>) {
  const bundle = await build({
    stdin: { contents: entry, loader: 'ts', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    plugins: [{ name: 'stubs', setup(builder) {
      const filter = new RegExp(`(${Object.keys(stubs).map(name => name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
      builder.onResolve({ filter }, args => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: stubs[Object.keys(stubs).find(name => args.path.endsWith(name))!] }));
    } }],
  });
  const compiled: { exports: any } = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  return compiled.exports;
}

const USER = '00000000-0000-4000-8000-000000000001';
const ORG = '00000000-0000-4000-8000-000000000002';
const RUN = '00000000-0000-4000-8000-000000000003';
const DRAFT = '00000000-0000-4000-8000-000000000004';
const TARGET = `${DRAFT}:v1:h-v1:google:sender`;

type World = { row: any; probe: { data?: string; error?: unknown }; move: { data?: string; error?: unknown }; draft: any; revised: any; reviseError: Error | null; calls: string[]; moved: any };
const world: World = { row: null, probe: {}, move: {}, draft: null, revised: null, reviseError: null, calls: [], moved: null };
(globalThis as any).__send = world;

const loaded = load(`export * from './src/lib/server/cowork/send-edit';`, {
  '/supabase-admin': `export function getSupabaseAdminClient() { const w = globalThis.__send; return {
    from: () => { const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: w.row, error: null }) }; return chain; },
    rpc: async (name, args) => { if (args.p_target === null) { w.calls.push('probe'); return w.probe; } w.calls.push('move'); w.moved = args; return w.move; },
  } }`,
  '/native-drafts': `export async function getCurrentNativeDraft() { return globalThis.__send.draft }
    export async function reviseNativeDraft(input) { const w = globalThis.__send; w.calls.push('revise:' + input.expectedVersionId + ':' + input.subject); if (w.reviseError) throw w.reviseError; return w.revised }`,
  '/messaging-contracts': `export function hashMessagingDraftContent(draft) { return 'h-' + draft.versionId }`,
  './access': `export async function requireCoworkWorkerAccess() {}`,
  './send-email': `export function parseCoworkSendTarget(id) { const [draftId, versionId, contentHash, provider, senderHash] = id.split(':'); return { draftId, versionId, contentHash, provider, senderHash } }`,
});

const auth = { user: { id: USER }, organizationId: ORG } as any;
const edit = { draftId: DRAFT, expectedVersionId: 'v1', subject: 'Una pregunta, Andrea', text: 'Hola Andrea,\n\nCorto y claro.' };
function reset(over: Partial<World> = {}) {
  Object.assign(world, {
    row: { status: 'proposed', kind: 'send_email', target_id: TARGET, label: 'Enviar «Hola» desde nicolas@yago.cl' },
    probe: { data: 'ready', error: null }, move: { data: 'edited', error: null },
    draft: { draftId: DRAFT, versionId: 'v1', channel: 'email', content: { subject: 'Hola' } },
    revised: { draftId: DRAFT, versionId: 'v2', channel: 'email', content: { subject: 'Una pregunta, Andrea' } },
    reviseError: null, calls: [], moved: null, ...over,
  });
}

test('a correction becomes a new revision and the approval moves to it, keeping the draft, the mailbox and the sender (COW-29)', async () => {
  const { editCoworkSendProposal } = await loaded;
  reset();
  assert.deepEqual(await editCoworkSendProposal(auth, RUN, edit), { changed: true });
  assert.deepEqual(world.calls, ['probe', 'revise:v1:Una pregunta, Andrea', 'move'], 'it checks it can move before it writes a revision');
  assert.equal(world.moved.p_expected, TARGET);
  assert.equal(world.moved.p_target, `${DRAFT}:v2:h-v2:google:sender`);
  assert.equal(world.moved.p_label, 'Enviar «Una pregunta, Andrea» desde nicolas@yago.cl');
});

test('nothing is written when the card is not on the version that waits, the proposal was decided or editing is not there yet', async () => {
  const { editCoworkSendProposal, CoworkSendEditRefused } = await loaded;
  const refused = async (status: number, over: Partial<World>, input = edit) => {
    reset(over);
    await assert.rejects(editCoworkSendProposal(auth, RUN, input), (error: any) => error instanceof CoworkSendEditRefused && error.status === status);
    assert.ok(!world.calls.some(call => call.startsWith('revise') || call === 'move'), JSON.stringify(world.calls));
  };
  await refused(409, {}, { ...edit, expectedVersionId: 'v0' });
  await refused(409, { row: { status: 'approved', kind: 'send_email', target_id: TARGET, label: 'x' } });
  await refused(409, { probe: { data: 'stale', error: null } });
  await refused(409, { probe: { data: 'not_pending', error: null } });
  await refused(503, { probe: { data: undefined, error: { code: 'PGRST202' } } });
  await refused(409, { draft: { draftId: DRAFT, versionId: 'v9', channel: 'email', content: {} } });
});

test('the same text is no change; someone who asked not to be written to cannot be written to', async () => {
  const { editCoworkSendProposal, CoworkSendEditRefused } = await loaded;
  reset({ revised: { draftId: DRAFT, versionId: 'v1', channel: 'email', content: { subject: 'Hola' } } });
  assert.deepEqual(await editCoworkSendProposal(auth, RUN, edit), { changed: false });
  assert.ok(!world.calls.includes('move'));
  reset({ reviseError: new Error('NATIVE_DRAFT_PRIVACY_SUPPRESSED') });
  await assert.rejects(editCoworkSendProposal(auth, RUN, edit), (error: any) => error instanceof CoworkSendEditRefused && /pidió no recibir correos/.test(error.message));
  // The proposal moved meanwhile: the revision stays in the history, and the card says the email changed.
  reset({ move: { data: 'stale', error: null } });
  await assert.rejects(editCoworkSendProposal(auth, RUN, edit), (error: any) => error instanceof CoworkSendEditRefused && error.status === 409);
});

test('«Editar correo» is offered only when the proposal waits on what the card shows', async () => {
  const { coworkSendEditable, coworkSendLabel } = await loaded;
  reset();
  assert.equal(await coworkSendEditable(auth, RUN, TARGET), true);
  reset({ probe: { data: undefined, error: { code: 'PGRST202' } } });
  assert.equal(await coworkSendEditable(auth, RUN, TARGET), false, 'before the migration');
  reset({ probe: { data: 'stale', error: null } });
  assert.equal(await coworkSendEditable(auth, RUN, TARGET), false);
  assert.equal(coworkSendLabel('Enviar «Hola» desde a@b.cl', '  Nuevo   asunto '), 'Enviar «Nuevo asunto» desde a@b.cl');
  assert.equal(coworkSendLabel('Otra cosa', 'Nuevo'), 'Otra cosa');
});

test('the function moves only a pending send, only from what was seen, and only its version', () => {
  const sql = readFileSync('supabase/migrations/20261025010000_cowork_send_proposal_edit.sql', 'utf8');
  assert.match(sql, /p\.kind<>'send_email' or p\.status<>'proposed' or r\.status<>'waiting_approval' then return 'not_pending'/);
  assert.match(sql, /if p\.target_id<>p_expected then return 'stale'/);
  assert.match(sql, /split_part\(p_target, ':', 1\)<>split_part\(p_expected, ':', 1\) or split_part\(p_target, ':', 4\)<>split_part\(p_expected, ':', 4\)\s+or split_part\(p_target, ':', 5\)<>split_part\(p_expected, ':', 5\)/);
  assert.match(sql, /revoke all on function public\.cowork_edit_send_proposal\(uuid,uuid,uuid,text,text,text\) from public,anon,authenticated;/);
  assert.match(sql, /grant execute on function public\.cowork_edit_send_proposal\(uuid,uuid,uuid,text,text,text\) to service_role;/);
});
