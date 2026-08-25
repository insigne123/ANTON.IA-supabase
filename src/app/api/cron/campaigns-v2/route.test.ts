import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/app/api/cron/campaigns-v2/route.ts', 'utf8');
const cronModule = readFileSync('src/lib/server/campaigns-v2/cron.ts', 'utf8');

test('Campaign V2 cron is Firebase-authenticated and only promotes due state', () => {
  assert.match(source, /isFirebaseSchedulerRequest/);
  assert.match(source, /promoteDueCampaignV2Steps/);
  assert.match(cronModule, /promote_due_campaign_recipient_steps_v2/);
  assert.doesNotMatch(`${source}\n${cronModule}`, /sendGmail|sendOutlook|dispatchOutboundMessage|createNativeDraft|providers\/send/);
});
