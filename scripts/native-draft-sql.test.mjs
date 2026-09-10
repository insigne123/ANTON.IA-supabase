import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import test from 'node:test';

// Real PostgreSQL in WASM, installed outside the repo. No Supabase or env files.
const enginePath = path.join(process.env.LOCALAPPDATA, 'Temp/opencode/public-company-sql/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(enginePath).href);
const migration = readFileSync('supabase/migrations/20260909160000_atomic_native_draft_revision.sql', 'utf8');
function existingFunction(file, name) {
  const sql = readFileSync(`supabase/migrations/${file}`, 'utf8');
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0);
  return sql.slice(start, sql.indexOf('$$;', start) + 3);
}

test('native revision SQL preserves RLS, scopes, lineage and rolls back metadata failures', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role',true) $$;
      grant usage on schema auth to anon,authenticated,service_role;
      create function public.research_messaging_row_access(uuid,uuid) returns boolean language sql as $$ select false $$;
      create table public.research_snapshots(id uuid, organization_id uuid, user_id uuid);
      create table public.messaging_drafts(id uuid primary key, organization_id uuid, user_id uuid,
        research_snapshot_id uuid, lifecycle text, channel text, current_version_id uuid, current_revision integer, updated_at timestamptz);
      create table public.messaging_draft_versions(id uuid primary key, draft_id uuid, organization_id uuid, user_id uuid,
        research_snapshot_id uuid, revision integer, parent_version_id uuid, lifecycle text, channel text, recipient jsonb,
        content jsonb, approval jsonb, preflight jsonb, payload jsonb, content_hash text, created_at timestamptz);
      create table public.messaging_draft_generation_metadata(version_id uuid primary key references public.messaging_draft_versions(id),
        draft_id uuid, organization_id uuid, user_id uuid, research_snapshot_id uuid, generation_method text,
        provider text, model text, prompt_version text, style_profile_id uuid, claim_ids jsonb,
        report_document_id uuid, report_schema_version text, report_revision integer, report_content_hash text);
      alter table public.messaging_drafts enable row level security;
      alter table public.messaging_draft_versions enable row level security;
      alter table public.messaging_draft_generation_metadata enable row level security;
      grant all on all tables in schema public to service_role;
    `);
    await db.exec(existingFunction('20260813093000_research_messaging_v1.sql', 'append_messaging_draft_revision_v1'));
    await db.exec(existingFunction('20260908173355_report_v2_foundation.sql', 'clone_messaging_draft_generation_metadata_v1'));
    await db.exec(`create trigger clone_messaging_draft_generation_metadata_v1 after insert on public.messaging_draft_versions
      for each row execute function public.clone_messaging_draft_generation_metadata_v1();`);
    await db.exec(migration);
    const draftId = randomUUID(), versionId = randomUUID(), organizationId = randomUUID(), userId = randomUUID(), snapshotId = randomUUID();
    const recipient = { email: 'test@example.com', leadRef: null, linkedinUrl: null };
    await db.query('insert into public.research_snapshots values ($1,$2,$3)', [snapshotId, organizationId, userId]);
    await db.query(`insert into public.messaging_drafts(id,organization_id,user_id,research_snapshot_id,lifecycle,current_version_id,current_revision)
      values ($1,$2,$3,$4,'draft',$5,1)`, [draftId, organizationId, userId, snapshotId, versionId]);
    await db.query(`insert into public.messaging_draft_versions(id,draft_id,organization_id,user_id,recipient)
      values ($1,$2,$3,$4,$5)`, [versionId, draftId, organizationId, userId, recipient]);
    await db.query(`insert into public.messaging_draft_generation_metadata(version_id,draft_id,organization_id,user_id,research_snapshot_id,
      generation_method,provider,model,prompt_version,claim_ids) values ($1,$2,$3,$4,$5,'model','openai','original-model','original-prompt','["claim-1"]')`,
    [versionId, draftId, organizationId, userId, snapshotId]);
    let payload = { schemaVersion: 1, draftId, versionId: randomUUID(), organizationId, userId, researchSnapshotId: snapshotId,
      revision: 2, parentVersionId: versionId, lifecycle: 'draft', channel: 'email', recipient,
      content: { subject: 'Edited', text: 'Body', html: null },
      approval: { status: 'pending', decidedBy: null, decidedAt: null, reason: null },
      preflight: { status: 'pending', checkedAt: null, errors: [], warnings: [] }, createdAt: new Date().toISOString() };
    let metadata = { versionId: payload.versionId, draftId, organizationId, userId, researchSnapshotId: snapshotId,
      generationMethod: 'human', provider: null, model: null, promptVersion: 'native-draft/manual-revision/v1', styleProfileId: null, claimIds: ['claim-1'] };
    const append = (body = payload, meta = metadata) => db.query('select public.append_native_messaging_draft_revision_v1($1,$2,$3,$4,$5) as payload',
      [draftId, body.parentVersionId, body, 'a'.repeat(64), meta]);
    const state = async () => (await db.query(`select
      (select current_version_id from public.messaging_drafts where id='${draftId}') as current,
      (select count(*)::integer from public.messaging_draft_versions) as versions,
      (select count(*)::integer from public.messaging_draft_generation_metadata) as metadata`)).rows[0];
    await db.exec("set role service_role; set request.jwt.claim.role='service_role';");
    const before = await state();
    await assert.rejects(append(payload, { ...metadata, userId: randomUUID() }), /NATIVE_DRAFT_METADATA_CONFLICT/);
    await assert.rejects(append(payload, { ...metadata, styleProfileId: randomUUID() }), /preserve source lineage/);
    await assert.rejects(append(payload, { ...metadata, provider: 'openai' }), /preserve source lineage/);
    await assert.rejects(append(payload, { ...metadata, reportDocumentId: randomUUID() }), /NATIVE_DRAFT_METADATA_CONFLICT/);
    await assert.rejects(append({ ...payload, approval: { ...payload.approval, status: 'approved' } }), /reset lifecycle/);
    assert.deepEqual(await state(), before);

    // Force a failure AFTER the generic RPC has advanced current_version_id.
    await db.exec(`reset role;
      create function public.fail_metadata_update() returns trigger language plpgsql as $$ begin raise exception 'forced metadata failure'; end; $$;
      create trigger fail_metadata_update before update on public.messaging_draft_generation_metadata for each row execute function public.fail_metadata_update();
      set role service_role;`);
    await assert.rejects(append(), /forced metadata failure/);
    assert.deepEqual(await state(), before);
    await db.exec('reset role; drop trigger fail_metadata_update on public.messaging_draft_generation_metadata; alter table public.messaging_draft_versions disable trigger clone_messaging_draft_generation_metadata_v1; set role service_role;');
    await assert.rejects(append(), /NATIVE_DRAFT_METADATA_PERSIST_FAILED/);
    assert.deepEqual(await state(), before);
    await db.exec('reset role; alter table public.messaging_draft_versions enable trigger clone_messaging_draft_generation_metadata_v1; set role service_role;');

    assert.deepEqual((await append()).rows[0].payload, payload);
    const human = (await db.query('select * from public.messaging_draft_generation_metadata where version_id=$1', [payload.versionId])).rows[0];
    assert.equal(human.generation_method, 'human');
    assert.equal(human.provider, null);
    assert.deepEqual(human.claim_ids, ['claim-1']);
    await assert.rejects(append(), /stale messaging draft parent/);
    const humanVersionId = payload.versionId;
    payload = { ...payload, versionId: randomUUID(), parentVersionId: humanVersionId, revision: 3 };
    metadata = { ...metadata, versionId: payload.versionId, generationMethod: 'model', provider: 'openai', model: 'new-model', promptVersion: 'new-prompt', styleProfileId: randomUUID(), claimIds: ['claim-2'] };
    await append();
    const model = (await db.query('select * from public.messaging_draft_generation_metadata where version_id=$1', [payload.versionId])).rows[0];
    assert.equal(model.style_profile_id, metadata.styleProfileId);
    assert.equal(model.model, 'new-model');
    assert.deepEqual(model.claim_ids, ['claim-2']);
    assert.equal((await db.query('select generation_method from public.messaging_draft_generation_metadata where version_id=$1', [humanVersionId])).rows[0].generation_method, 'human');
    await db.query("update public.messaging_drafts set lifecycle='archived' where id=$1", [draftId]);
    await assert.rejects(append(), /NATIVE_DRAFT_ARCHIVED/);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`reset role; set role ${role}; set request.jwt.claim.role='${role}';`);
      await assert.rejects(append(), /permission denied/);
    }
    await db.exec('reset role;');
    assert.ok((await db.query("select relrowsecurity from pg_class where relname in ('messaging_drafts','messaging_draft_versions','messaging_draft_generation_metadata')")).rows.every((row) => row.relrowsecurity));
  } finally { await db.close(); }
});
