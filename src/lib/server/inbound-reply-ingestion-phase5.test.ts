import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createStableInboundMessageId,
  ingestInboundReply,
  normalizeInboundProvider,
} from './inbound-reply-ingestion';

const migration = readFileSync('supabase/migrations/20260822150000_campaign_deliveries_and_reply_ingestion.sql', 'utf8');
const campaignMigration = readFileSync('supabase/migrations/20260825120000_campaign_outreach_v2.sql', 'utf8');
const replySync = readFileSync('src/lib/server/reply-sync.ts', 'utf8');
const webhook = readFileSync('src/app/api/tracking/webhook/route.ts', 'utf8');
const classifyRoute = readFileSync('src/app/api/replies/classify/route.ts', 'utf8');
const schedulerRoute = readFileSync('src/app/api/scheduler/reply/route.ts', 'utf8');

function functionBody(name: string, source = migration) {
  const start = source.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = source.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} must have a complete body`);
  return source.slice(start, end);
}

test('non-email adapters use a stable internal message identity and nullable recipient email', async () => {
  const first = createStableInboundMessageId({
    provider: 'linkedin',
    contactedId: 'contact-1',
    content: 'https://linkedin.example/thread/1\u001fInterested, lets talk.',
  });
  const repeated = createStableInboundMessageId({
    provider: 'linkedin',
    contactedId: 'contact-1',
    content: 'https://linkedin.example/thread/1\u001fInterested, lets talk.',
  });
  assert.equal(first, repeated);
  assert.match(first, /^internal:[a-f0-9]{64}$/);
  assert.equal(normalizeInboundProvider('microsoft'), 'outlook');

  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await ingestInboundReply({
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: { inserted: true, reason: 'inserted', eventKey: 'linked-event' }, error: null };
    },
  }, {
    contactedId: 'contact-1',
    recipientEmail: null,
    provider: 'linkedin',
    messageId: first,
    eventType: 'reply',
    eventSource: 'scheduler_reply',
    eventAt: '2026-08-22T12:00:00.000Z',
    content: 'Interested, lets talk.',
    classification: {
      intent: 'positive',
      sentiment: 'positive',
      confidence: 0.9,
      shouldContinue: false,
      evaluationStatus: 'action_required',
    },
  });

  assert.equal(result.inserted, true);
  assert.deepEqual(calls, [
    {
      name: 'ingest_inbound_reply_v1',
      args: {
        p_contacted_id: 'contact-1',
        p_recipient_email: null,
        p_provider: 'linkedin',
        p_message_id: first,
        p_internet_message_id: null,
        p_event_type: 'reply',
        p_event_source: 'scheduler_reply',
        p_event_at: '2026-08-22T12:00:00.000Z',
        p_thread_key: null,
        p_thread_id: null,
        p_conversation_id: null,
        p_subject: null,
        p_content: 'Interested, lets talk.',
        p_preview: null,
        p_classification: {
          intent: 'positive',
          sentiment: 'positive',
          confidence: 0.9,
          shouldContinue: false,
          evaluationStatus: 'action_required',
        },
      },
    },
  ]);
});

test('the client delegates bounced and duplicate safety handling to the shared transaction', async () => {
  for (const ingestionResult of [
    { inserted: true, reason: 'inserted', eventKey: 'bounce-event' },
    { inserted: false, reason: 'duplicate', eventKey: 'bounce-event' },
  ]) {
    const calls: string[] = [];
    await ingestInboundReply({
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push(name);
        assert.equal(name, 'ingest_inbound_reply_v1');
        assert.equal(args.p_event_type, 'bounce');
        return { data: ingestionResult, error: null };
      },
    }, {
      contactedId: 'contact-1',
      recipientEmail: 'person@example.com',
      provider: 'gmail',
      messageId: 'bounce-message',
      eventType: 'bounce',
      eventSource: 'test',
      eventAt: '2026-08-25T12:00:00.000Z',
      classification: {},
    });
    assert.deepEqual(calls, ['ingest_inbound_reply_v1']);
  }

  const invalidCalls: string[] = [];
  await ingestInboundReply({
    async rpc(name: string) {
      invalidCalls.push(name);
      return {
        data: { inserted: false, reason: 'contact_context_mismatch', eventKey: 'invalid-event' },
        error: null,
      };
    },
  }, {
    contactedId: 'contact-1',
    recipientEmail: 'wrong@example.com',
    provider: 'gmail',
    messageId: 'invalid-message',
    eventType: 'reply',
    eventSource: 'test',
    eventAt: '2026-08-25T12:00:00.000Z',
    classification: {},
  });
  assert.deepEqual(invalidCalls, ['ingest_inbound_reply_v1']);

  const wrapper = functionBody('ingest_inbound_reply_v1', campaignMigration);
  assert.match(wrapper, /case when lower\(trim\(coalesce\(p_event_type, ''\)\)\) = 'bounce'[\s\S]+then 'recipient_bounced'/);
  assert.match(wrapper, /v_result ->> 'reason' = 'duplicate'[\s\S]+safety_stop_campaign_recipient_from_contacted_v2/);
});

test('latest inbound RPC retains email aliases and adds generic provider-safe idempotency', () => {
  const ingestion = functionBody('ingest_inbound_reply_v1');

  assert.match(ingestion, /v_supplied_email text := lower\(trim\(coalesce\(p_recipient_email, ''\)\)\)/);
  assert.match(ingestion, /if v_supplied_email <> '' and v_supplied_email !~ /);
  assert.match(ingestion, /if v_email is not null then[\s\S]*pg_advisory_xact_lock/);
  assert.match(ingestion, /chr\(31\), v_provider, v_identity_value, v_email, trim\(p_contacted_id\)/);
  assert.match(ingestion, /chr\(31\), v_provider, v_identity_value, trim\(p_contacted_id\)/);
  assert.match(ingestion, /where alias\.identity_key = any\(v_identity_keys\)/);
  assert.match(ingestion, /linkedin_message_status = case/);
  assert.match(ingestion, /insert into public\.lead_responses/);
  assert.match(ingestion, /insert into public\.email_events/);
  assert.match(ingestion, /update public\.contacted_leads/);
});

test('all inbound provider adapters invoke the shared contract before downstream effects', () => {
  for (const [name, source] of [
    ['Gmail/Outlook sync', replySync],
    ['tracking webhook', webhook],
    ['manual classify route', classifyRoute],
    ['LinkedIn scheduler route', schedulerRoute],
  ] as const) {
    const ingest = source.indexOf('await ingestInboundReply(');
    const inserted = source.indexOf('if (!ingestion.inserted)', ingest);

    assert.ok(ingest >= 0, `${name} must call the shared ingestion contract`);
    assert.ok(inserted > ingest, `${name} must gate follow-up work on a new event`);
    assert.doesNotMatch(source, /recordInboundUnsubscribe|shouldGloballySuppressReply/);
  }

  assert.match(schedulerRoute, /createStableInboundMessageId/);
  assert.match(classifyRoute, /createStableInboundMessageId/);
  assert.match(webhook, /server\/inbound-reply-ingestion/);
});
