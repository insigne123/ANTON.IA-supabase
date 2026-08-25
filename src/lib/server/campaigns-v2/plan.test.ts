import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/lib/server/campaigns-v2/plan.ts', 'utf8');
const routeSource = readFileSync('src/app/api/campaigns/v2/first-contact-plans/route.ts', 'utf8');

test('plan resolution and reads are scoped to the authenticated creator', () => {
  const resolver = source.slice(
    source.indexOf('export async function resolveFirstContactPlanOrganization'),
    source.indexOf('export async function queryFirstContactPlan'),
  );
  const query = source.slice(
    source.indexOf('export async function queryFirstContactPlan'),
    source.indexOf('export async function getFirstContactPlan'),
  );
  assert.ok((resolver.match(/\.eq\('user_id', input\.userId\)/g) || []).length >= 2);
  assert.match(query, /\.eq\('user_id', input\.userId\)/);
  assert.ok((routeSource.match(/userId: auth\.user\.id/g) || []).length >= 4);
});

test('plan reads project current strict draft summaries and per-step generation errors', () => {
  assert.match(source, /select\('id,current_version_id'\)/);
  assert.match(source, /select\('id,draft_id,lifecycle,content,approval'\)/);
  assert.match(source, /currentVersionId !== text\(row\.native_version_id\)/);
  assert.match(source, /draftId: nativeDraftId,[\s\S]+versionId: currentVersionId,[\s\S]+subject:[\s\S]+body:[\s\S]+lifecycle:[\s\S]+approval:/);
  assert.match(source, /status: 'ready' as const, error: null/);
  assert.match(source, /status: 'error' as const,[\s\S]+error: text\(row\.last_error\)/);
});

test('plan creation is idempotent and retries missing pre-generated drafts before returning', () => {
  const existingRead = source.indexOf('const existing = await queryFirstContactPlan');
  const createGuard = source.indexOf('if (!existing &&', existingRead);
  const rpc = source.indexOf("client.rpc('create_first_contact_campaign_plan_v2'", createGuard);
  const pregenerate = source.indexOf('await pregenerateFirstContactPlanDrafts', rpc);
  const finalRead = source.indexOf('const plan = await queryFirstContactPlan', pregenerate);

  assert.ok(existingRead >= 0 && existingRead < createGuard);
  assert.ok(createGuard < rpc && rpc < pregenerate && pregenerate < finalRead);
  assert.match(source, /p_style_profile_id: config\.styleProfileId/);
  assert.match(source, /p_sequence_instruction: config\.sequenceInstruction/);
});
