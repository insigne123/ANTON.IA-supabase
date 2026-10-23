import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { isBlockedModel } from '@/ai/blocked-models';
import { coworkHarnessEnabled, coworkHarnessSettings } from '@/lib/cowork/harness-config';
import { draftFlagsForUser } from '@/lib/server/draft-context-v2';

// The plain values of apphosting.yaml, as the visual audit reads them.
const config = readFileSync('apphosting.yaml', 'utf8');
const plain: Record<string, string> = Object.fromEntries(
  [...config.matchAll(/-\s*variable:\s*(\S+)\s*\n\s*value:\s*("[^"\n]*"|'[^'\n]*'|[^\n]*)/g)].map(([, name, value]) => [name, value.trim().replace(/^["']|["']$/g, '')]),
);
const OUTSIDER = '00000000-0000-4000-8000-000000000001';

test('no model that production names is one the app refuses to call', () => {
  const models = Object.entries(plain).filter(([name]) => /MODEL/.test(name) && !/PRICING/.test(name));
  assert.ok(models.length > 5, 'the models of production are read');
  for (const [name, value] of models) assert.equal(isBlockedModel(value), false, `${name}=${value}`);
});

test('the draft flags and the Cowork harness are never on for everyone by accident: with them on there is a list of people, and it is the same list', () => {
  const draftFlags = ['DRAFT_SIGNAL_EVIDENCE_ENABLED', 'DRAFT_HOOK_FILTER_ENABLED', 'DRAFT_ANCHOR_SPECIFICS_ENABLED'];
  const draftPilot = (plain.DRAFT_PILOT_USER_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  const harnessPilot = (plain.COWORK_HARNESS_USER_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  // Rolling out to everyone is a decision: it takes the list out of this test too.
  if (draftFlags.some((name) => plain[name] === 'true')) assert.ok(draftPilot.length > 0, 'a draft flag is on: DRAFT_PILOT_USER_IDS says for whom');
  if (plain.COWORK_RUNTIME === 'harness') assert.ok(harnessPilot.length > 0, 'the harness is on: COWORK_HARNESS_USER_IDS says for whom');
  for (const id of [...draftPilot, ...harnessPilot]) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'user ids, not emails');
  if (draftPilot.length && harnessPilot.length) assert.deepEqual([...draftPilot].sort(), [...harnessPilot].sort(), 'the pilot is the same people in Drafts and in Cowork');
  assert.notEqual(plain.COWORK_WEB_ENABLED, 'true', 'the web is not part of the pilot');
  assert.notEqual(plain.COWORK_SUBAGENTS_ENABLED, 'true', 'the sub-agents are not part of the pilot');
});

test('what production says makes the pilot the only ones with the new drafts and the harness, on Haiku, without the web', () => {
  const [pilot] = (plain.DRAFT_PILOT_USER_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  if (!pilot) return; // the pilot is over: nothing is on for anyone
  assert.deepEqual(draftFlagsForUser(pilot, plain), { signalEvidence: true, hookFilter: true, anchorSpecifics: true });
  assert.deepEqual(draftFlagsForUser(OUTSIDER, plain), { signalEvidence: false, hookFilter: false, anchorSpecifics: false });
  assert.deepEqual(draftFlagsForUser(null, plain), { signalEvidence: false, hookFilter: false, anchorSpecifics: false });
  assert.equal(coworkHarnessEnabled(plain, pilot), true);
  assert.equal(coworkHarnessEnabled(plain, OUTSIDER), false);
  const settings = coworkHarnessSettings(plain, pilot);
  assert.equal(settings?.model, 'claude-haiku-5-5');
  assert.equal(settings?.web, null);
  assert.equal(settings?.subagents, null);
  assert.equal(coworkHarnessSettings(plain, OUTSIDER), null, 'everyone else keeps the loop');
});
