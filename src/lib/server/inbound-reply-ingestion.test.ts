import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ingestInboundReply } from '@/lib/server/reply-sync';

const migrationPath = 'supabase/migrations/20260813113000_inbound_reply_idempotency_privacy.sql';
const migration = readFileSync(migrationPath, 'utf8');
const campaignMigration = readFileSync('supabase/migrations/20260825120000_campaign_outreach_v2.sql', 'utf8');
const deletionMigration = readFileSync('supabase/migrations/20260813093000_research_messaging_v1.sql', 'utf8');
const webhook = readFileSync('src/app/api/tracking/webhook/route.ts', 'utf8');
const replySync = readFileSync('src/lib/server/reply-sync.ts', 'utf8');
const classifyRoute = readFileSync('src/app/api/replies/classify/route.ts', 'utf8');
const schedulerRoute = readFileSync('src/app/api/scheduler/reply/route.ts', 'utf8');

function functionBody(sql: string, name: string) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = sql.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} must have a complete body`);
  return sql.slice(start, end);
}

test('shared inbound RPC preserves stable provider, message, recipient, and contact context', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let committed = false;
  let lock = Promise.resolve();
  const supabase = {
    rpc(name: string, args: Record<string, unknown>) {
      const run = lock.then(async () => {
        calls.push({ name, args });
        if (committed) {
          return { data: { inserted: false, reason: 'duplicate', eventKey: 'stable-key' }, error: null };
        }
        committed = true;
        return { data: { inserted: true, reason: 'inserted', eventKey: 'stable-key' }, error: null };
      });
      lock = run.then(() => undefined);
      return run;
    },
  };
  const input = {
    contactedId: 'contact-1',
    recipientEmail: 'person@example.com',
    provider: 'gmail',
    messageId: 'provider-message-1',
    internetMessageId: 'internet-message-1@example.com',
    eventType: 'reply' as const,
    eventSource: 'test',
    eventAt: '2026-08-13T12:00:00.000Z',
    classification: {
      intent: 'positive',
      sentiment: 'positive',
      confidence: 0.9,
      shouldContinue: false,
      evaluationStatus: 'action_required',
    },
  };

  const results = await Promise.all([
    ingestInboundReply(supabase, input),
    ingestInboundReply(supabase, { ...input, eventSource: 'overlapping_sync' }),
  ]);

  assert.equal(results.filter((result) => result.inserted).length, 1);
  assert.equal(results.filter((result) => result.reason === 'duplicate').length, 1);
  const ingestionCalls = calls.filter((call) => call.name === 'ingest_inbound_reply_v1');
  assert.equal(ingestionCalls.length, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    ingestionCalls.map((call) => [
      call.args.p_provider,
      call.args.p_message_id,
      call.args.p_internet_message_id,
      call.args.p_recipient_email,
      call.args.p_contacted_id,
    ]),
    [
      ['gmail', 'provider-message-1', 'internet-message-1@example.com', 'person@example.com', 'contact-1'],
      ['gmail', 'provider-message-1', 'internet-message-1@example.com', 'person@example.com', 'contact-1'],
    ],
  );
});

test('inbound ingestion RPC is service-role-only and atomically owns all durable reply writes', () => {
  const core = functionBody(migration, 'ingest_inbound_reply_v1');
  const wrapper = functionBody(campaignMigration, 'ingest_inbound_reply_v1');

  assert.match(core, /security definer/);
  assert.match(core, /auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(wrapper, /security definer/);
  assert.match(wrapper, /ingest_inbound_reply_core_v1/);
  assert.match(wrapper, /record_inbound_unsubscribe_v1/);
  assert.match(wrapper, /safety_stop_campaign_recipient_from_contacted_v2/);
  assert.match(campaignMigration, /revoke all on function public\.ingest_inbound_reply_core_v1[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(campaignMigration, /grant execute on function public\.ingest_inbound_reply_v1[\s\S]*to service_role/);
  assert.match(core, /insert into public\.lead_responses/);
  assert.match(core, /insert into public\.email_events/);
  assert.match(core, /update public\.contacted_leads/);
  assert.match(core, /engagement_score = coalesce\(engagement_score, 0\) \+ case when v_is_failure then 0 else 10 end/);
  assert.match(core, /reply_intent = v_intent/);
  assert.match(migration, /lead_responses_inbound_event_key_uidx/);
  assert.match(migration, /email_events_inbound_event_key_uidx/);
  assert.match(migration, /create table if not exists public\.inbound_reply_event_aliases/);
  assert.match(migration, /revoke all on table public\.inbound_reply_event_aliases from public, anon, authenticated/);
});

test('privacy deletion and inbound ingestion serialize on the same normalized-email lock', () => {
  const ingestion = functionBody(migration, 'ingest_inbound_reply_v1');
  const wrapper = functionBody(campaignMigration, 'ingest_inbound_reply_v1');
  const deletion = functionBody(deletionMigration, 'delete_research_messaging_subject_v1');
  const lock = /pg_advisory_xact_lock\(hashtextextended\(concat\('privacy-delete:', v_email\), 0\)\)/;

  assert.match(ingestion, lock);
  assert.match(deletion, lock);
  assert.ok(ingestion.indexOf('pg_advisory_xact_lock') < ingestion.indexOf('from public.unsubscribed_emails ue'));
  assert.ok(ingestion.indexOf('from public.unsubscribed_emails ue') < ingestion.indexOf('insert into public.lead_responses'));
  assert.ok(ingestion.indexOf('for update') < ingestion.indexOf('insert into public.lead_responses'));
  assert.match(ingestion, /lower\(trim\(coalesce\(v_contact\.email, ''\)\)\) <> v_email/);
  assert.match(ingestion, /when 'google' then 'gmail'[\s\S]*when 'microsoft' then 'outlook'[\s\S]*end\) <> v_provider/);
  assert.match(ingestion, /'reason', 'globally_suppressed'/);
  assert.match(ingestion, /'reason', 'contact_missing'/);
  assert.match(ingestion, /'reason', 'contact_context_mismatch'/);
  assert.match(wrapper, /v_result := public\.ingest_inbound_reply_core_v1/);
});

test('unsubscribe persistence rechecks deletion under the same privacy lock', () => {
  const suppression = functionBody(migration, 'record_inbound_unsubscribe_v1');
  const wrapper = functionBody(campaignMigration, 'ingest_inbound_reply_v1');
  const lock = /pg_advisory_xact_lock\(hashtextextended\(concat\('privacy-delete:', v_email\), 0\)\)/;

  assert.match(suppression, /security definer/);
  assert.match(suppression, /auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(suppression, lock);
  assert.ok(suppression.indexOf('pg_advisory_xact_lock') < suppression.indexOf('insert into public.unsubscribed_emails'));
  assert.match(suppression, /lr\.inbound_event_key = trim\(p_event_key\)/);
  assert.match(suppression, /'reason', 'globally_suppressed'/);
  assert.match(migration, /grant execute on function public\.record_inbound_unsubscribe_v1\(text, text, text\) to service_role/);
  assert.match(wrapper, /jsonb_typeof\(p_classification\) = 'object'[\s\S]+p_classification ->> 'intent'.*= 'unsubscribe'/);
  assert.ok(wrapper.indexOf('record_inbound_unsubscribe_v1') < wrapper.indexOf('safety_stop_campaign_recipient_from_contacted_v2'));
});

test('duplicate retries return the existing durable rows before content or counters are written', () => {
  const body = functionBody(migration, 'ingest_inbound_reply_v1');
  const wrapper = functionBody(campaignMigration, 'ingest_inbound_reply_v1');
  const duplicate = body.indexOf("'reason', 'duplicate'");
  const responseInsert = body.indexOf('insert into public.lead_responses');
  const eventInsert = body.indexOf('insert into public.email_events');
  const counterUpdate = body.indexOf('update public.contacted_leads');

  assert.ok(duplicate > -1);
  assert.ok(duplicate < responseInsert);
  assert.ok(responseInsert < eventInsert);
  assert.ok(eventInsert < counterUpdate);
  assert.match(body, /where lr\.inbound_event_key = v_event_key/);
  assert.match(body, /'leadResponseId', v_response_id/);
  assert.match(body, /'emailEventId', v_email_event_id/);
  assert.match(body, /v_internet_identity_key := encode\(digest\(concat_ws\([\s\S]*v_internet_message_id[\s\S]*v_email[\s\S]*trim\(p_contacted_id\)/);
  assert.match(body, /v_message_identity_key := encode\(digest\(concat_ws\([\s\S]*v_message_id[\s\S]*v_email[\s\S]*trim\(p_contacted_id\)/);
  assert.match(body, /where alias\.identity_key = any\(v_identity_keys\)/);
  assert.ok(body.indexOf('on conflict (identity_key) do nothing') < duplicate);
  assert.ok(wrapper.indexOf("v_result ->> 'reason' = 'duplicate'") < wrapper.indexOf('record_inbound_unsubscribe_v1'));
  assert.ok(wrapper.indexOf("v_result ->> 'reason' = 'duplicate'") < wrapper.indexOf('safety_stop_campaign_recipient_from_contacted_v2'));
});

test('orphan responses are cleaned before adding the cascading contacted foreign key', () => {
  const cleanup = migration.indexOf('delete from public.lead_responses lr');
  const constraint = migration.indexOf('add constraint lead_responses_contacted_id_fkey');

  assert.ok(cleanup > -1 && cleanup < constraint);
  assert.match(migration, /foreign key \(contacted_id\)[\s\S]*references public\.contacted_leads\(id\)[\s\S]*on delete cascade/);
});

test('inbound adapters delegate suppression and Campaign V2 safety stops to the atomic RPC', () => {
  for (const [name, source] of [
    ['tracking webhook', webhook],
    ['reply sync', replySync],
    ['manual classify route', classifyRoute],
    ['scheduler reply route', schedulerRoute],
  ] as const) {
    const rpc = source.indexOf('await ingestInboundReply(');
    const insertedGuard = source.indexOf('if (!ingestion.inserted)', rpc);

    assert.ok(rpc > -1, `${name} must call the shared RPC`);
    assert.ok(insertedGuard > rpc, `${name} must inspect inserted`);
    assert.doesNotMatch(source, /recordInboundUnsubscribe|shouldGloballySuppressReply|record_inbound_unsubscribe_v1/);
  }

  assert.doesNotMatch(replySync, /\.from\('lead_responses'\)|\.from\('email_events'\)/);
  assert.doesNotMatch(webhook, /\.from\('lead_responses'\)/);
});
