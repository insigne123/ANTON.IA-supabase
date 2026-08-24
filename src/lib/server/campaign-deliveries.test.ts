import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  campaignDeliveryProgressByRecipient,
  isCampaignDispatchKey,
} from './campaign-deliveries';

const migration = readFileSync('supabase/migrations/20260822150000_campaign_deliveries_and_reply_ingestion.sql', 'utf8');
const dispatchSource = readFileSync('src/lib/server/outbound-dispatch.ts', 'utf8');
const campaignCron = readFileSync('src/app/api/cron/process-campaigns/route.ts', 'utf8');
const historyRepair = readFileSync('src/lib/server/outbound-reconciliation-history.ts', 'utf8');

function functionBody(name: string) {
  const start = migration.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = migration.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} must have a complete body`);
  return migration.slice(start, end);
}

test('campaign delivery progress only advances from the latest sent step', () => {
  const progress = campaignDeliveryProgressByRecipient([
    { recipient_key: 'lead-a', step_index: 0, delivery_state: 'sent', sent_at: '2026-08-22T10:00:00.000Z' },
    { recipient_key: 'lead-a', step_index: 1, delivery_state: 'deferred', completed_at: '2026-08-22T11:00:00.000Z' },
    { recipient_key: 'lead-a', step_index: 2, delivery_state: 'sent', completed_at: '2026-08-22T12:00:00.000Z' },
    { recipient_key: 'lead-b', step_index: 0, delivery_state: 'failed' },
  ]);

  assert.deepEqual(progress.get('lead-a'), {
    stepIndex: 2,
    sentAt: '2026-08-22T12:00:00.000Z',
  });
  assert.equal(progress.has('lead-b'), false);
  assert.equal(isCampaignDispatchKey('campaign:50000000-0000-4000-8000-000000000001:contact-1:step:0'), true);
  assert.equal(isCampaignDispatchKey('campaign:missing-step'), false);
});

test('campaign deliveries have durable identity, service-only finalization, and a constrained dispatch backfill', () => {
  const finalizer = functionBody('finalize_campaign_delivery_outcome_v1');

  assert.match(migration, /create table if not exists public\.campaign_deliveries/);
  assert.match(migration, /dispatch_id uuid not null unique references public\.outbound_dispatches\(id\) on delete cascade/);
  assert.match(migration, /unique \(organization_id, campaign_id, recipient_key, step_index\)/);
  assert.match(migration, /delivery_state in \('pending', 'sending', 'sent', 'failed', 'deferred', 'unknown'\)/);
  assert.match(migration, /insert into public\.campaign_deliveries[\s\S]*from public\.outbound_dispatches od/);
  assert.match(migration, /sent_records without a dispatch remain a legacy fallback/);
  assert.match(migration, /alter table public\.campaign_deliveries enable row level security/);
  assert.match(migration, /grant select on table public\.campaign_deliveries to authenticated/);
  assert.match(finalizer, /security definer/);
  assert.match(finalizer, /auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(finalizer, /from public\.outbound_dispatches od[\s\S]*for update/);
  assert.match(finalizer, /from public\.contacted_leads cl[\s\S]*for update/);
  assert.match(finalizer, /recipient_step_already_claimed/);
  assert.match(finalizer, /update public\.campaigns[\s\S]*sent_records = jsonb_set/);
});

test('direct, replayed, reconciled, and history-repair paths finalize the same campaign delivery projection', () => {
  assert.match(dispatchSource, /await finalizeCampaignDelivery\(\{ status: claim\.dispatch\.status/);
  assert.match(dispatchSource, /await finalizeCampaignDelivery\(\{ status: dispatch\.status, dispatch/);
  assert.match(dispatchSource, /const finish = async[\s\S]*await finalizeCampaignDelivery\(result, dependencies\)[\s\S]*finalizeConfirmedSentHistory/);
  assert.match(dispatchSource, /await finalizeCampaignDelivery\(\{ status: updated\.status, dispatch: updated/);
  assert.match(historyRepair, /finalizeCampaignDeliveryOutcome\(dispatch\.id, admin\)/);
  assert.match(campaignCron, /campaignDeliveryProgressByRecipient\(deliveryRows \|\| \[\]\)/);
  assert.match(campaignCron, /durableRecord\.stepIndex >= legacyStepIdx/);
  assert.match(campaignCron, /deliveryProgress\.set\(leadKey/);
  assert.doesNotMatch(campaignCron, /safeInsertEmailEvent\(/);
});
