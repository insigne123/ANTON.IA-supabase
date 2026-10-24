import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { isBlockedModel } from '@/ai/blocked-models';
import { coworkHarnessEnabled, coworkHarnessSettings, coworkWebAvailable } from '@/lib/cowork/harness-config';
import { coworkExecutionPolicy } from '@/lib/cowork/execution-policy';
import { claudeWebSourcesSettings } from '@/lib/server/claude-web-sources';
import { coworkModelUsage } from '@/lib/server/cowork/model-usage';
import { coworkSchedulesEnabled } from '@/lib/server/cowork/schedules';
import { draftFlagsForUser } from '@/lib/server/draft-context-v2';
import { signalHarvestSettings } from '@/lib/server/research-signal-harvest';

// The plain values of apphosting.yaml, as the visual audit reads them.
const config = readFileSync('apphosting.yaml', 'utf8');
const plain: Record<string, string> = Object.fromEntries(
  [...config.matchAll(/-\s*variable:\s*(\S+)\s*\n\s*value:\s*("[^"\n]*"|'[^'\n]*'|[^\n]*)/g)].map(([, name, value]) => [name, value.trim().replace(/^["']|["']$/g, '')]),
);
const SOMEONE = '00000000-0000-4000-8000-000000000001';
const SOMEONE_ELSE = '00000000-0000-4000-8000-000000000002';
const ids = (value: string | undefined) => (value ?? '').split(',').map((id) => id.trim()).filter(Boolean);

test('no model that production names is one the app refuses to call', () => {
  const models = Object.entries(plain).filter(([name]) => /MODEL/.test(name) && !/PRICING/.test(name));
  assert.ok(models.length > 5, 'the models of production are read');
  for (const [name, value] of models) assert.equal(isBlockedModel(value), false, `${name}=${value}`);
});

test('what production says: the draft improvements, the signal harvest, the Cowork harness on Haiku, its web and Investigadoras and the scheduled tasks are on for every account', () => {
  const everyone = { signalEvidence: true, hookFilter: true, anchorSpecifics: true };
  for (const id of [SOMEONE, SOMEONE_ELSE, null]) assert.deepEqual(draftFlagsForUser(id, plain), everyone, String(id));
  for (const id of [SOMEONE, SOMEONE_ELSE]) {
    assert.equal(coworkHarnessEnabled(plain, id), true, id);
    const settings = coworkHarnessSettings(plain, id);
    assert.equal(settings?.model, 'claude-haiku-5-5');
    assert.equal(coworkWebAvailable(plain, id), true, id);
    // The tools of the web that Haiku can use (the dynamic ones answer «invalid_tool_input»), within a small budget per turn.
    assert.deepEqual(settings?.web, { searches: 4, fetches: 3, maxPageTokens: 20_000, basic: true, country: 'CL', timezone: 'America/Santiago' });
    assert.equal(settings?.subagents?.model, 'claude-haiku-5-5');
    assert.equal(isBlockedModel(settings?.subagents?.model), false);
    assert.deepEqual([settings?.subagents?.maxDelegations, settings?.subagents?.searches, settings?.subagents?.fetches], [3, 3, 2]);
  }
  // The harvest is a Claude too (Haiku unless a variable says otherwise) and needs the key the runtime already has.
  assert.equal(signalHarvestSettings({ ...plain, ANTHROPIC_API_KEY: 'a-key' })?.model, 'claude-haiku-5-5');
  assert.equal(signalHarvestSettings({ ...plain }), null, 'without the key it stays out of the way');
  assert.equal(coworkSchedulesEnabled(plain), true);
});

test('the web has a price in the ledger, so a turn that searched has a cost and not an unknown one', () => {
  const usage = { prompt_tokens: 100_000, completion_tokens: 2_000, total_tokens: 102_000, prompt_tokens_details: { cached_tokens: 60_000 }, cache_creation_input_tokens: 0 };
  const searched = coworkModelUsage({ modelName: 'claude-haiku-5-5', durationMs: 20_000, usage: { ...usage, web_search_requests: 3 } }, plain.COWORK_MODEL_PRICING_JSON);
  const plainTurn = coworkModelUsage({ modelName: 'claude-haiku-5-5', durationMs: 5_000, usage }, plain.COWORK_MODEL_PRICING_JSON);
  assert.notEqual(searched.costUsd, null);
  assert.equal(Math.round((searched.costUsd! - plainTurn.costUsd!) * 1e6) / 1e6, 0.03, 'three searches at US$0.01 on top of the tokens');
});

test('the other functions that were off are on: the researcher with Claude\'s web, the document reviewer that looks, and the autonomous mode with its limits', () => {
  assert.equal(plain.COWORK_DOCUMENT_VISION, 'true');
  assert.equal(plain.COWORK_AUTONOMY_ENABLED, 'true');
  // The researcher needs the key of Anthropic the runtime already has, and runs on Haiku within its budget.
  assert.deepEqual(claudeWebSourcesSettings({ ...plain, ANTHROPIC_API_KEY: 'a-key' }), { model: 'claude-haiku-5-5', effort: 'low', searches: 6, fetches: 3, maxSources: 8, deadlineMs: 45_000, basic: true });
  assert.equal(claudeWebSourcesSettings({ ...plain }), null, 'without the key it stays out of the way');
  // The autonomous mode is what the person picks in each conversation; what it approves alone stays inside the list and the caps.
  assert.deepEqual(coworkExecutionPolicy('autonomous', plain.COWORK_AUTONOMY_ENABLED === 'true').automaticEffects, ['save_contact', 'start_research', 'request_draft', 'enrich_contact', 'campaign_create']);
  assert.equal(coworkExecutionPolicy('approval', true).effectiveMode, 'approval');
});

test('if a list of people is put back to limit the improvements, it holds user ids (not emails) and, in Drafts and in Cowork, it is the same people', () => {
  const draftPilot = ids(plain.DRAFT_PILOT_USER_IDS);
  const harnessPilot = ids(plain.COWORK_HARNESS_USER_IDS);
  for (const id of [...draftPilot, ...harnessPilot]) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'user ids, not emails');
  if (draftPilot.length && harnessPilot.length) assert.deepEqual([...draftPilot].sort(), [...harnessPilot].sort(), 'the same people in Drafts and in Cowork');
  // With a list, the ones outside it write and talk as they did before.
  if (draftPilot.length) assert.deepEqual(draftFlagsForUser(SOMEONE, plain), { signalEvidence: false, hookFilter: false, anchorSpecifics: false });
  if (harnessPilot.length) assert.equal(coworkHarnessEnabled(plain, SOMEONE), false);
});
