import test from 'node:test';
import assert from 'node:assert/strict';
import { COWORK_CAMPAIGN_RETRY_MAX, coworkCampaignRetryEnabled, coworkCampaignRetryTarget, hashCoworkCampaignRetry, parseCoworkCampaignRetryTarget } from './campaign-retry-target';

const RUN = '00000000-0000-4000-8000-000000000041';
const CAMPAIGN = '00000000-0000-4000-8000-000000000051';
const D1 = '00000000-0000-4000-8000-0000000000d1';
const D2 = '00000000-0000-4000-8000-0000000000d2';

test('the flag is off unless it is exactly «true»', () => {
  assert.equal(coworkCampaignRetryEnabled({}), false);
  assert.equal(coworkCampaignRetryEnabled({ COWORK_CAMPAIGN_RETRY_ENABLED: 'TRUE' }), false);
  assert.equal(coworkCampaignRetryEnabled({ COWORK_CAMPAIGN_RETRY_ENABLED: '1' }), false);
  assert.equal(coworkCampaignRetryEnabled({ COWORK_CAMPAIGN_RETRY_ENABLED: 'true' }), true);
});

test('the hash pins the run, the campaign and exactly the drafts, whatever their order', () => {
  const hash = hashCoworkCampaignRetry(RUN, CAMPAIGN, [D1, D2]);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hashCoworkCampaignRetry(RUN, CAMPAIGN, [D2, D1]), hash, 'the order the drafts were listed in does not matter');
  assert.notEqual(hashCoworkCampaignRetry(RUN, CAMPAIGN, [D1]), hash, 'one draft fewer is another approval');
  assert.notEqual(hashCoworkCampaignRetry(RUN, CAMPAIGN, [D1, D2, '00000000-0000-4000-8000-0000000000d3']), hash, 'one draft more is another approval');
  assert.notEqual(hashCoworkCampaignRetry('00000000-0000-4000-8000-000000000042', CAMPAIGN, [D1, D2]), hash, 'another run');
  assert.notEqual(hashCoworkCampaignRetry(RUN, '00000000-0000-4000-8000-000000000052', [D1, D2]), hash, 'another campaign');
});

test('the target round-trips, and anything else is refused', () => {
  const hash = hashCoworkCampaignRetry(RUN, CAMPAIGN, [D1]);
  assert.deepEqual(parseCoworkCampaignRetryTarget(coworkCampaignRetryTarget(CAMPAIGN, hash)), { campaignId: CAMPAIGN, hash });
  for (const bad of ['', 'campaignretry:', `campaignretry:${CAMPAIGN}`, `campaignretry:not-a-uuid:${hash}`, `campaignretry:${CAMPAIGN}:abc`, `sendbatch:${hash}`, `campaignretry:${CAMPAIGN}:${hash}:extra`]) {
    assert.throws(() => parseCoworkCampaignRetryTarget(bad), /no es válida/, bad);
  }
});

test('a retry is bounded', () => {
  assert.equal(COWORK_CAMPAIGN_RETRY_MAX, 50);
});
