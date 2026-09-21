import assert from 'node:assert/strict';
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
    'crm_assign_lead','exception_resolve','mission_control','new_future_write','']) {
    assert.equal(coworkEffectCanAutoApprove('autonomous',true,kind),false,kind);
  }
});
