import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Same isolated PostgreSQL/WASM installation as native-draft-sql.test.mjs; no env files or remote database.
const { PGlite } = await import(pathToFileURL(path.join(process.env.LOCALAPPDATA, 'Temp/opencode/public-company-sql/node_modules/@electric-sql/pglite/dist/index.js')).href);
test('bulk review is atomic, scoped, immutable and enforced at dispatch insertion and claim', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role', true) $$;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table auth.users(id uuid primary key);
      create table public.organizations(id uuid primary key);
      create table public.organization_members(organization_id uuid, user_id uuid);
      create function public.research_messaging_row_access(uuid,uuid) returns boolean language sql as $$ select false $$;
      create table public.research_snapshots(id uuid,organization_id uuid,user_id uuid);
      create table public.messaging_drafts(id uuid primary key,organization_id uuid,user_id uuid,research_snapshot_id uuid,channel text,lifecycle text,current_revision integer,current_version_id uuid,created_at timestamptz,updated_at timestamptz);
      create table public.messaging_draft_versions(id uuid primary key,draft_id uuid,organization_id uuid,user_id uuid,research_snapshot_id uuid,revision integer,parent_version_id uuid,lifecycle text,channel text,recipient jsonb,content jsonb,approval jsonb,preflight jsonb,payload jsonb,content_hash text,created_at timestamptz);
      create table public.outbound_dispatches(id uuid primary key default gen_random_uuid(),draft_id uuid,version_id uuid,organization_id uuid,user_id uuid,provider text,idempotency_key text,content_hash text,status text,metadata jsonb,completed_at timestamptz);
      create table public.unsubscribed_emails(email text,organization_id uuid,user_id uuid);
      create table public.excluded_domains(domain text,organization_id uuid);
      create table public.leads(email text,organization_id uuid,status text);
      create table public.enriched_leads(email text,organization_id uuid);
      create table public.contacted_leads(email text,organization_id uuid,status text,campaign_followup_allowed boolean,evaluation_status text,bounced_at timestamptz,delivery_status text,replied_at timestamptz,last_reply_text text,sent_at timestamptz,last_follow_up_at timestamptz);
      grant usage on schema auth to authenticated,service_role;
      grant select on public.organization_members to authenticated;
      grant all on all tables in schema public to service_role;
    `);
    const original = readFileSync('supabase/migrations/20260813093000_research_messaging_v1.sql', 'utf8');
    const start = original.indexOf('create or replace function public.create_messaging_draft_v1(');
    await db.exec(original.slice(start, original.indexOf('$$;', start) + 3));
    await db.exec(readFileSync('supabase/migrations/20260910100000_bulk_campaign_review.sql', 'utf8'));
    try { await db.exec(readFileSync('supabase/migrations/20260910110000_bulk_campaign_dispatch_guard.sql', 'utf8')); }
    catch (error) { throw new Error(`Dispatch migration: ${error.message}, position ${error.position}, internal ${error.internalQuery}, context ${error.where}`); }
    await db.exec(readFileSync('supabase/migrations/20260910120000_bulk_campaign_attempts.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/20260910160000_bulk_campaign_guard_retention.sql', 'utf8'));
    const org = randomUUID(), user = randomUUID(), other = randomUUID(), id = randomUUID();
    await db.query('insert into auth.users values($1),($2)', [user, other]);
    await db.query('insert into public.organizations values($1)', [org]);
    await db.query('insert into public.organization_members values($1,$2)', [org, user]);
    const messages = [0, 3].map(delayDays => ({ draftId: randomUUID(), versionId: randomUUID(), subject: 'Hola', body: 'Un mensaje real de prueba.', delayDays }));
    const person = { email: 'ana@example.com', messages };
    const definition = { provider: 'google', criteria: { relationship: 'never_contacted', excludeReplied: true, minimumDaysSinceSent: 0 } };
    const hash = 'a'.repeat(64);
    const mutate = (action, extras = {}) => db.query('select public.mutate_bulk_campaign_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) campaign',
      [id, org, extras.user || user, action, extras.revision ?? 1, extras.hash || hash, definition, [person], extras.drafts ?? null]);
    await db.exec("set role service_role; set request.jwt.claim.role='service_role';");
    await mutate('save', { revision: 0 });
    await assert.rejects(mutate('save', { user: other }), /not authorized/);
    await assert.rejects(mutate('reject', { hash: 'b'.repeat(64) }), /VERSION_CONFLICT/);
    const drafts = messages.map(message => ({ hash, payload: {
      schemaVersion: 1, draftId: message.draftId, versionId: message.versionId, organizationId: org, userId: user,
      researchSnapshotId: null, revision: 1, parentVersionId: null, lifecycle: 'ready', channel: 'email',
      recipient: { email: person.email }, content: { subject: message.subject, text: message.body, html: null },
      approval: { status: 'approved', decidedBy: user }, preflight: { status: 'passed' }, createdAt: new Date().toISOString(),
    } }));
    const invalid = structuredClone(drafts); invalid[1].payload.content.text = 'Changed after preview';
    await assert.rejects(mutate('approve', { drafts: invalid }), /INVALID_APPROVAL/);
    assert.equal((await db.query('select count(*)::int n from public.messaging_drafts')).rows[0].n, 0);
    await mutate('approve', { drafts });
    await mutate('approve', { drafts }); // Idempotent confirmation.
    assert.equal((await db.query('select count(*)::int n from public.messaging_drafts')).rows[0].n, 2);
    const recordAttempt = (draftId, state, retryAt = null) => db.query('select public.record_bulk_campaign_attempt_v1($1,$2,$3,$4,$5,$6)',
      [id, draftId, state, 'test-code', 'Estado de prueba', retryAt]);
    await assert.rejects(recordAttempt(randomUUID(), 'attention'), /SCOPE_MISMATCH/);
    await recordAttempt(messages[0].draftId, 'retry_wait', new Date(Date.now() + 3600000).toISOString());
    for (let index = 0; index < 5; index++) await recordAttempt(messages[1].draftId, 'retry_wait', new Date(Date.now() + 3600000).toISOString());
    const stopped = (await db.query('select state,retry_at,attempt_count from public.bulk_campaign_attempts where draft_id=$1', [messages[1].draftId])).rows[0];
    assert.deepEqual(stopped, { state: 'attention', retry_at: null, attempt_count: 5 });
    const retryAttempt = (draftId, owner = user) => db.query('select public.retry_bulk_campaign_attempt_v1($1,$2,$3,$4)', [id,draftId,owner,org]);
    await assert.rejects(retryAttempt(messages[1].draftId, other), /not authorized/);
    await retryAttempt(messages[1].draftId);
    assert.equal((await db.query('select * from public.bulk_campaign_attempts where draft_id=$1', [messages[1].draftId])).rows.length, 0);
    await recordAttempt(messages[1].draftId, 'attention');
    await assert.rejects(mutate('save'), /FROZEN/);
    const insert = (index, key = `bulk:${id}:${messages[index].draftId}`, version = messages[index].versionId) => db.query(
      `insert into public.outbound_dispatches(draft_id,version_id,organization_id,user_id,provider,idempotency_key,content_hash,status,metadata)
       values($1,$2,$3,$4,'gmail',$5,$6,'pending',$7) returning id`,
      [messages[index].draftId, version, org, user, key, hash, { recipient: { email: person.email } }]);
    await assert.rejects(insert(0, 'bypass-generic-send'), /NOT_APPROVED/);
    await assert.rejects(insert(0, undefined, randomUUID()), /REVIEW_CHANGED/);
    await assert.rejects(insert(1), /NOT_DUE/);
    await mutate('pause');
    await assert.rejects(insert(0), /NOT_APPROVED/);
    await mutate('resume');
    const dispatch = (await insert(0)).rows[0].id;
    await mutate('pause');
    await assert.rejects(db.query("update public.outbound_dispatches set status='sending' where id=$1", [dispatch]), /NOT_APPROVED/);
    await mutate('resume');
    await db.query("update public.outbound_dispatches set status='sending' where id=$1", [dispatch]);
    await assert.rejects(retryAttempt(messages[0].draftId), /NOT_RETRYABLE/);
    await db.query("update public.outbound_dispatches set status='sent',completed_at=now()-interval '4 days' where id=$1", [dispatch]);
    await db.query("insert into public.contacted_leads(email,organization_id,status,replied_at) values($1,$2,'replied',now())", [person.email, org]);
    await assert.rejects(insert(1), /CONTACT_BLOCKED/);
    await db.query('update public.contacted_leads set replied_at=null,status=null');
    await insert(1);
    // Retention removes the old dispatch row; the sent marker still blocks any repeat.
    await assert.rejects(insert(1, undefined, randomUUID()), /REVIEW_CHANGED/);
    await recordAttempt(messages[1].draftId, 'sent');
    // A slow failed contender must never overwrite a confirmed success.
    await recordAttempt(messages[1].draftId, 'attention');
    assert.equal((await db.query('select state from public.bulk_campaign_attempts where draft_id=$1', [messages[1].draftId])).rows[0].state, 'sent');
    await db.query('delete from public.outbound_dispatches where draft_id=$1', [messages[1].draftId]);
    await assert.rejects(insert(1), /ALREADY_SENT/);
    await db.exec(`reset role; set role authenticated; set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='${other}';`);
    assert.equal((await db.query('select * from public.bulk_campaigns')).rows.length, 0);
    assert.equal((await db.query('select * from public.bulk_campaign_attempts')).rows.length, 0);
    await db.exec(`set request.jwt.claim.sub='${user}';`);
    assert.equal((await db.query('select * from public.bulk_campaigns')).rows.length, 1);
    assert.equal((await db.query('select * from public.bulk_campaign_attempts')).rows.length, 2);
    await assert.rejects(db.query("update public.bulk_campaigns set status='approved'"), /permission denied/);
    await assert.rejects(mutate('pause'), /permission denied/);
    await assert.rejects(recordAttempt(messages[0].draftId, 'attention'), /permission denied/);
    await assert.rejects(retryAttempt(messages[1].draftId), /permission denied/);
    await db.exec("reset role; set role service_role; set request.jwt.claim.role='service_role';");
    await db.query('delete from public.contacted_leads');
    assert.equal((await db.query('select * from public.bulk_campaigns')).rows.length, 0);
    assert.equal((await db.query('select * from public.bulk_campaign_attempts')).rows.length, 0);
    await assert.rejects(insert(1, 'standalone-after-deletion'), /NOT_FOUND/);
  } finally { await db.close(); }
});
