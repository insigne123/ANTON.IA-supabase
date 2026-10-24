import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { coworkEffectCanAutoApprove } from './execution-policy';

test('automatic effects require the user mode, live flag and explicit allowlist', () => {
  for (const kind of ['save_contact','start_research','request_draft','enrich_contact','campaign_create']) {
    assert.equal(coworkEffectCanAutoApprove('autonomous',true,kind),true);
    assert.equal(coworkEffectCanAutoApprove('approval',true,kind),false);
    assert.equal(coworkEffectCanAutoApprove('autonomous',false,kind),false);
  }
  for (const kind of ['send_email','code_execute','profile_update','campaign_activate','campaign_pause',
    'campaign_stop_v2','saved_search_create','saved_search_update','saved_search_delete',
    'crm_update_record','campaign_prepare_draft_v2',
    'crm_assign_lead','exception_resolve','mission_control','reply_thread','linkedin_invite_batch','linkedin_message_batch','new_future_write','']) {
    assert.equal(coworkEffectCanAutoApprove('autonomous',true,kind),false,kind);
  }
});

test('a turn that read the open web never approves by itself, in the mode that would, and the worker asks for it in both paths', () => {
  for (const kind of ['save_contact', 'start_research', 'request_draft', 'enrich_contact', 'campaign_create']) {
    assert.equal(coworkEffectCanAutoApprove('autonomous', true, kind, { fromWeb: true }), false, kind);
    assert.equal(coworkEffectCanAutoApprove('autonomous', true, kind, { fromWeb: false }), true, kind);
    assert.equal(coworkEffectCanAutoApprove('autonomous', true, kind, {}), true, kind);
  }
  // The worker passes what the proposal says: the effects through the policy, the automatic search through its own condition.
  const worker = readFileSync('src/lib/server/cowork/worker.ts', 'utf8');
  assert.match(worker, /coworkEffectCanAutoApprove\(run\.mode, process\.env\.COWORK_AUTONOMY_ENABLED === 'true', proposal\.kind, \{ fromWeb: proposal\.fromWeb \}\)/);
  assert.match(worker, /const autonomous = executionPolicy\.automaticExternalSearch && process\.env\.COWORK_AUTONOMY_ENABLED === 'true' && !context\?\.fromWeb;/);
});
