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

test('a plan whose first email never went out stops after 14 days, with «Detener» and never by sending (audit K1)', () => {
  const expiry = readFileSync('src/lib/server/campaigns-v2/initial-send-expiry.ts', 'utf8');
  assert.match(source, /expireStaleInitialSends\(\)\.catch\(\(\) => null\)/, 'a failure never fails the tick');
  assert.match(expiry, /INITIAL_SEND_EXPIRY_DAYS = 14/);
  assert.match(expiry, /\.eq\('status', 'pending_initial_send'\)\.lt\('created_at', cutoff\)/);
  assert.match(expiry, /stopCampaignV2Enrollment\(/);
  assert.doesNotMatch(expiry, /sendGmail|sendOutlook|dispatchOutboundMessage/);
});
