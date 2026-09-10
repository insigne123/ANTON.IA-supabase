import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Isolated PostgreSQL/WASM; no env files or remote database.
const { PGlite } = await import(pathToFileURL(path.join(process.env.LOCALAPPDATA, 'Temp/opencode/public-company-sql/node_modules/@electric-sql/pglite/dist/index.js')).href);
test('audience search, budgets, profiles and pending revision are scoped and consistent', async () => {
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
      create table public.outbound_dispatches(id uuid primary key default gen_random_uuid(),draft_id uuid,version_id uuid,organization_id uuid,user_id uuid,provider text,idempotency_key text,content_hash text,status text,metadata jsonb,completed_at timestamptz,channel text);
      create table public.unsubscribed_emails(email text,organization_id uuid,user_id uuid);
      create table public.excluded_domains(domain text,organization_id uuid);
      create table public.leads(id uuid primary key default gen_random_uuid(),email text,organization_id uuid,name text,title text,company text,industry text,country text,status text);
      create table public.enriched_leads(id uuid primary key default gen_random_uuid(),email text,organization_id uuid,full_name text,title text,company_name text,organization_industry text,country text,organization_size text,seniority text);
      create table public.contacted_leads(id uuid primary key default gen_random_uuid(),email text,organization_id uuid,name text,role text,company text,industry text,country text,status text,sent_at timestamptz,last_follow_up_at timestamptz,replied_at timestamptz,last_reply_text text,campaign_followup_allowed boolean,evaluation_status text,bounced_at timestamptz,delivery_status text);
      grant usage on schema auth to authenticated,service_role;
      grant select on public.organization_members to authenticated;
      grant all on all tables in schema public to service_role;
    `);
    const original = readFileSync('supabase/migrations/20260813093000_research_messaging_v1.sql', 'utf8');
    const start = original.indexOf('create or replace function public.create_messaging_draft_v1(');
    await db.exec(original.slice(start, original.indexOf('$$;', start) + 3));
    for (const file of ['20260910100000_bulk_campaign_review.sql', '20260910110000_bulk_campaign_dispatch_guard.sql',
      '20260910120000_bulk_campaign_attempts.sql', '20260910130000_bulk_audience_profiles_budgets.sql',
      '20260910140000_bulk_audience_search.sql', '20260910150000_bulk_campaign_revise_pending.sql',
      '20260910170000_bulk_revision_binding.sql', '20260910180000_bulk_audience_enriched_only.sql']) {
      try { await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8')); }
      catch (error) { throw new Error(`${file}: ${error.message}`); }
    }
    const org = randomUUID(), user = randomUUID(), other = randomUUID();
    await db.query('insert into auth.users values($1),($2)', [user, other]);
    await db.query('insert into public.organizations values($1)', [org]);
    await db.query('insert into public.organization_members values($1,$2)', [org, user]);
    await db.exec("set role service_role; set request.jwt.claim.role='service_role';");
    await db.query(`insert into public.leads(email,organization_id,name,title,company,industry,country,status) values
      ('ana@example.com',$1,'Ana Pérez','Jefa de Operaciones','Empresa','Logística','Chile',null),
      ('beto@retail.mx',$1,'Beto','Vendedor','Tienda','Retail','México',null),
      ('dnc@example.com',$1,'DNC','Gerente','Firma','Servicios','Chile','do_not_contact')`, [org]);
    await db.query(`insert into public.enriched_leads(email,organization_id,full_name,title,company_name,organization_industry,country,organization_size,seniority) values
      ('ana@example.com',$1,'Ana Pérez','Jefa de Operaciones','Empresa','Logística','Chile','11-50','Manager'),
      ('diego@example.com',$1,'Diego','CTO','Startup','Software','Chile','1000+','C-Level')`, [org]);
    await db.query(`insert into public.contacted_leads(email,organization_id,name,role,company,status,sent_at,replied_at) values
      ('elena@example.com',$1,'Elena','Directora','Corp','sent',now()-interval '10 days',now()-interval '2 days'),
      ('franco@example.com',$1,'Franco','Jefe','Pyme','sent',now()-interval '100 days',null)`, [org]);
    await db.query(`insert into public.outbound_dispatches(draft_id,organization_id,user_id,provider,idempotency_key,content_hash,status,metadata,channel)
      values($1,$2,$3,'gmail','inflight','${'c'.repeat(64)}','pending',$4,'email')`,
      [randomUUID(), org, user, { recipient: { email: 'diego@example.com' } }]);

    const search = (overrides = {}) => db.query('select public.search_bulk_audience_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) result', [
      org, user, overrides.relationship || 'never_contacted',
      overrides.titles || [], overrides.industries || [], overrides.countries || [],
      overrides.sizes || [], overrides.seniorities || [],
      overrides.minDays || 0, overrides.excludeReplied !== false,
      overrides.search || '', overrides.limit || 100, overrides.offset || 0,
      overrides.enrichedOnly === true,
    ]);
    const emails = (result) => result.rows[0].result.people.map(person => person.email);

    let result = await search();
    assert.deepEqual(emails(result), ['ana@example.com', 'beto@retail.mx', 'dnc@example.com']);
    assert.equal(result.rows[0].result.total, 3);
    const dnc = result.rows[0].result.people.find(person => person.email === 'dnc@example.com');
    assert.equal(dnc.blockedReason, 'No contactar o correo rebotado');
    const ana = result.rows[0].result.people.find(person => person.email === 'ana@example.com');
    assert.equal(ana.size, '11-50'); assert.equal(ana.seniority, 'Manager'); assert.equal(ana.blockedReason, null);

    result = await search({ titles: ['OPERACIONES'] });
    assert.deepEqual(emails(result), ['ana@example.com']);
    result = await search({ industries: ['logistica'] });
    assert.deepEqual(emails(result), ['ana@example.com']);
    result = await search({ sizes: ['11-50'], seniorities: ['manager'] });
    assert.deepEqual(emails(result), ['ana@example.com']);
    result = await search({ search: 'BETO' });
    assert.deepEqual(emails(result), ['beto@retail.mx']); assert.equal(result.rows[0].result.total, 1);
    result = await search({ limit: 1, offset: 1 });
    assert.deepEqual(emails(result), ['beto@retail.mx']); assert.equal(result.rows[0].result.total, 3);

    result = await search({ enrichedOnly: true });
    assert.deepEqual(emails(result), ['ana@example.com']);
    assert.equal(result.rows[0].result.people[0].enriched, true);
    result = await search({ enrichedOnly: true, relationship: 'previously_contacted', minDays: 90 });
    assert.deepEqual(emails(result), []);

    result = await search({ relationship: 'previously_contacted', minDays: 90 });
    assert.deepEqual(emails(result), ['franco@example.com']);
    result = await search({ relationship: 'previously_contacted', minDays: 90, excludeReplied: true });
    assert.deepEqual(emails(result), ['franco@example.com']);

    await db.query(`insert into public.unsubscribed_emails(email,organization_id,user_id) values('ana@example.com',null,null)`);
    result = await search();
    assert.equal(result.rows[0].result.people.find(person => person.email === 'ana@example.com').blockedReason, 'El contacto se dio de baja');
    await db.query(`insert into public.excluded_domains(domain,organization_id) values('retail.mx',$1)`, [org]);
    result = await search();
    assert.equal(result.rows[0].result.people.find(person => person.email === 'beto@retail.mx').blockedReason, 'El dominio está excluido');
    await db.query('delete from public.unsubscribed_emails');
    await db.query('delete from public.excluded_domains');

    await assert.rejects(search({ relationship: 'everyone' }), /INVALID_AUDIENCE/);
    await assert.rejects(search({ limit: 101 }), /INVALID_AUDIENCE_PAGE/);
    await assert.rejects(db.query('select public.search_bulk_audience_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
      [org, other, 'never_contacted', [], [], [], [], [], 0, true, '', 10, 0, false]), /not authorized/);

    const consume = (limit, owner = user) => db.query('select public.consume_bulk_ai_assist_v1($1,$2,CURRENT_DATE,$3) remaining', [org, owner, limit]);
    assert.equal((await consume(2)).rows[0].remaining, 1);
    assert.equal((await consume(2)).rows[0].remaining, 0);
    assert.equal((await consume(2)).rows[0].remaining, -1);
    await assert.rejects(consume(2, other), /not authorized/);

    await db.exec(`reset role; set role authenticated; set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='${user}';`);
    await db.query(`insert into public.bulk_audience_profiles(organization_id,user_id,name,criteria) values($1,$2,'Logística',${"'{}'"}::jsonb)`, [org, user]);
    assert.equal((await db.query('select * from public.bulk_audience_profiles')).rows.length, 1);
    await db.exec(`set request.jwt.claim.sub='${other}';`);
    assert.equal((await db.query('select * from public.bulk_audience_profiles')).rows.length, 0);
    await assert.rejects(db.query(`insert into public.bulk_audience_profiles(organization_id,user_id,name,criteria) values($1,$2,'X',${"'{}'"}::jsonb)`, [org, other]), /violates row-level security|permission denied|policy/);
    await db.exec(`set request.jwt.claim.sub='${user}';`);
    await db.query('delete from public.bulk_audience_profiles');
    assert.equal((await db.query('select * from public.bulk_audience_profiles')).rows.length, 0);
    await db.exec("reset role; set role service_role; set request.jwt.claim.role='service_role';");

    // Pending revision keeps locked content frozen and reuses it on re-approval.
    const id = randomUUID(), hash = 'a'.repeat(64);
    const messages = [0, 3].map(delayDays => ({ draftId: randomUUID(), versionId: randomUUID(), subject: 'Hola', body: 'Un mensaje real de prueba.', delayDays }));
    const definition = { provider: 'google', criteria: { relationship: 'never_contacted', excludeReplied: true, minimumDaysSinceSent: 0 } };
    const recipient = { email: 'ana@example.com', messages };
    const mutate = (action, extras = {}) => db.query('select public.mutate_bulk_campaign_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) campaign',
      [id, org, user, action, extras.revision ?? 1, extras.hash || hash, definition, [recipient], extras.drafts ?? null]);
    const draftPayload = (message) => ({ hash, payload: {
      schemaVersion: 1, draftId: message.draftId, versionId: message.versionId, organizationId: org, userId: user,
      researchSnapshotId: null, revision: 1, parentVersionId: null, lifecycle: 'ready', channel: 'email',
      recipient: { email: recipient.email }, content: { subject: message.subject, text: message.body, html: null },
      approval: { status: 'approved', decidedBy: user }, preflight: { status: 'passed' }, createdAt: new Date().toISOString(),
    } });
    await mutate('save', { revision: 0 });
    await mutate('approve', { drafts: messages.map(draftPayload) });
    await db.query(`insert into public.outbound_dispatches(draft_id,version_id,organization_id,user_id,provider,idempotency_key,content_hash,status,metadata,completed_at,channel)
      values($1,$2,$3,$4,'gmail',$5,$6,'sent',$7,now(),'email')`,
      [messages[0].draftId, messages[0].versionId, org, user, `bulk:${id}:${messages[0].draftId}`, hash, { recipient: { email: recipient.email } }]);
    const revised = structuredClone(messages); revised[1] = { ...revised[1], draftId: randomUUID(), versionId: randomUUID(), subject: 'Hola de nuevo', body: 'Otro mensaje real de prueba.' };
    const newRecipient = { email: recipient.email, messages: revised };
    const revise = (rev, reviewHash, people, newDrafts, newHash = 'b'.repeat(64)) =>
      db.query('select public.revise_bulk_campaign_pending_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) campaign',
        [id, org, user, rev, reviewHash, newHash, definition, people, newDrafts]);
    const tampered = structuredClone(revised); tampered[0] = { ...tampered[0], subject: 'Cambiado' };
    await assert.rejects(revise(1, hash, [{ email: recipient.email, messages: tampered }], [draftPayload(revised[1])]), /INVALID_REVISE_LOCKED/);
    await assert.rejects(revise(1, hash, [{ email: 'other@example.com', messages: revised }], [draftPayload(revised[1])]), /INVALID_REVISE_AUDIENCE/);
    await assert.rejects(revise(9, hash, [newRecipient], [draftPayload(revised[1])]), /VERSION_CONFLICT/);
    await revise(1, hash, [newRecipient], [draftPayload(revised[1])]);
    assert.equal((await db.query('select bulk_campaign_id from public.messaging_drafts where id=$1', [revised[1].draftId])).rows[0].bulk_campaign_id, id);
    const campaign = (await db.query('select * from public.bulk_campaigns where id=$1', [id])).rows[0];
    assert.equal(campaign.status, 'draft'); assert.equal(campaign.revision, 2); assert.equal(campaign.approved_at, null);
    await assert.rejects(db.query('update public.bulk_campaigns set recipients=$1 where id=$2', [[{ ...newRecipient, messages: [tampered[0], revised[1]] }], id]), /INVALID_REVISE_LOCKED/);
    await assert.rejects(revise(2, 'b'.repeat(64), [newRecipient], []), /FROZEN/);
    await assert.rejects(db.query(`insert into public.outbound_dispatches(draft_id,version_id,organization_id,user_id,provider,idempotency_key,content_hash,status,metadata,channel)
      values($1,$2,$3,$4,'gmail',$5,$6,'pending',$7,'email')`,
      [messages[1].draftId, messages[1].versionId, org, user, `bulk:${id}:${messages[1].draftId}`, hash, { recipient: { email: recipient.email } }]), /NOT_FOUND/);
    await mutate('approve', { revision: 2, hash: 'b'.repeat(64), drafts: [...messages.slice(0, 1).map(draftPayload), draftPayload(revised[1])] });
    assert.equal((await db.query('select status from public.bulk_campaigns where id=$1', [id])).rows[0].status, 'approved');
  } finally { await db.close(); }
});
