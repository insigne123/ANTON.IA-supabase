import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/lib/server/privacy-subject-data.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260825120000_campaign_outreach_v2.sql', 'utf8');

test('privacy exports include matching Campaign V2 plans, sequence copy, enrollments, and recipient steps', () => {
  assert.match(source, /admin\.rpc\('lookup_research_messaging_subject_v1', \{ p_email: email \}\)/);
  assert.doesNotMatch(source, /admin\.rpc\('lookup_campaign_v2_subject_v2'/);
  assert.doesNotMatch(source, /fetchAllPrivacyRows|\.range\(from, to\)/);
  assert.match(migration, /create or replace function public\.lookup_campaign_v2_subject_v2\(p_email text\)/);
  assert.match(migration, /jsonb_agg\(to_jsonb\(ce\) order by ce\.id\)/);
  assert.match(migration, /jsonb_agg\(to_jsonb\(c\) order by c\.id\)/);
  assert.match(migration, /jsonb_agg\(to_jsonb\(css\) order by css\.id\)/);
  assert.match(migration, /jsonb_agg\(to_jsonb\(crs\) order by crs\.id\)/);
  assert.match(migration, /grant execute on function public\.lookup_campaign_v2_subject_v2\(text\) to service_role/);
  assert.match(migration, /rename to lookup_research_messaging_subject_core_v1/);
  assert.match(migration, /alter function public\.lookup_research_messaging_subject_core_v1\(text\) stable/);
  assert.match(migration, /lookup_campaign_v2_subject_v2\(p_email text\)[\s\S]+language plpgsql[\s\S]+stable/);
  assert.match(migration, /create or replace function public\.lookup_research_messaging_subject_v1\(p_email text\)[\s\S]+language sql[\s\S]+stable[\s\S]+lookup_research_messaging_subject_core_v1\(p_email\)[\s\S]+lookup_campaign_v2_subject_v2\(p_email\)/);
  assert.match(source, /campaignV2Campaigns: campaignV2Campaigns\.length/);
  assert.match(source, /campaignV2Enrollments: campaignV2Enrollments\.length/);
  assert.match(source, /campaignV2SequenceSteps: campaignV2SequenceSteps\.length/);
  assert.match(source, /campaignV2RecipientSteps: campaignV2RecipientSteps\.length/);
  assert.match(migration, /campaigns_initial_native_draft_fkey[\s\S]+on delete cascade/);
  assert.match(migration, /delete_campaign_v2_for_retained_native_draft/);
});

test('privacy blocking delegates all durable writes to the atomic service-role suppression RPC', () => {
  const applyBlock = source.slice(
    source.indexOf('export async function applyPrivacyBlock'),
    source.indexOf('export async function deletePrivacySubjectData'),
  );
  assert.match(applyBlock, /admin\.rpc\('apply_privacy_suppression_v2', \{[\s\S]+p_email: email,[\s\S]+p_reason: reason/);
  assert.doesNotMatch(applyBlock, /\.from\('contacted_leads'\)|\.from\('leads'\)|\.from\('unsubscribed_emails'\)/);
  assert.match(applyBlock, /campaignSafetyStop: result\.campaignSafetyStop \|\| null/);
});
