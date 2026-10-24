import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { isBlockedModel } from '@/ai/blocked-models';
import { coworkHarnessEnabled, coworkHarnessSettings } from '@/lib/cowork/harness-config';
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

test('what production says: the draft improvements, the signal harvest, the Cowork harness on Haiku and the scheduled tasks are on for every account', () => {
  const everyone = { signalEvidence: true, hookFilter: true, anchorSpecifics: true };
  for (const id of [SOMEONE, SOMEONE_ELSE, null]) assert.deepEqual(draftFlagsForUser(id, plain), everyone, String(id));
  for (const id of [SOMEONE, SOMEONE_ELSE]) {
    assert.equal(coworkHarnessEnabled(plain, id), true, id);
    const settings = coworkHarnessSettings(plain, id);
    assert.equal(settings?.model, 'claude-haiku-5-5');
    assert.equal(settings?.web, null, 'the web is not part of it');
    assert.equal(settings?.subagents, null, 'the sub-agents are not part of it');
  }
  // The harvest is a Claude too (Haiku unless a variable says otherwise) and needs the key the runtime already has.
  assert.equal(signalHarvestSettings({ ...plain, ANTHROPIC_API_KEY: 'a-key' })?.model, 'claude-haiku-5-5');
  assert.equal(signalHarvestSettings({ ...plain }), null, 'without the key it stays out of the way');
  assert.equal(coworkSchedulesEnabled(plain), true);
});

test('what stays off, because it spends per use on something the ledger does not price yet or needs a server that was not checked', () => {
  for (const name of ['COWORK_WEB_ENABLED', 'COWORK_SUBAGENTS_ENABLED', 'COWORK_DOCUMENT_VISION', 'RESEARCH_CLAUDE_WEB_ENABLED', 'COWORK_AUTONOMY_ENABLED']) {
    assert.notEqual(plain[name], 'true', name);
  }
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
