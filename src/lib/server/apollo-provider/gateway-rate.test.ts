import assert from 'node:assert/strict';
import test from 'node:test';

import { consumeEndpointRateLimit, getGatewayConfig, waitForEndpointRateLimit } from './gateway';

const config = { ...getGatewayConfig({}), rateLimitWindowMs: 60_000, leadSearchMaxRequests: 5, leadSearchMaxPerPerson: 3 };

test('the defaults leave room for contacts in many companies at once: 60 a person, 180 for everyone', () => {
  const defaults = getGatewayConfig({});
  assert.deepEqual([defaults.leadSearchMaxPerPerson, defaults.leadSearchMaxRequests], [60, 180]);
  assert.equal(getGatewayConfig({ APOLLO_BACKEND_LEAD_SEARCH_MAX_PER_PERSON: '10' }).leadSearchMaxPerPerson, 10);
});

test('each person has their own share of the minute, inside the ceiling for everyone', () => {
  const now = 1_000_000_000_000;
  for (let i = 0; i < 3; i += 1) assert.equal(consumeEndpointRateLimit('lead-search', config, now + i, 'ana').allowed, true);
  const ana = consumeEndpointRateLimit('lead-search', config, now + 10, 'ana');
  assert.deepEqual([ana.allowed, ana.limit, ana.retryAfterSeconds], [false, 3, 60], 'Ana waits for her next minute');
  // Leo is not blocked by Ana's burst, until the ceiling for everyone (5) is reached.
  assert.equal(consumeEndpointRateLimit('lead-search', config, now + 20, 'leo').allowed, true);
  assert.equal(consumeEndpointRateLimit('lead-search', config, now + 21, 'leo').allowed, true);
  const ceiling = consumeEndpointRateLimit('lead-search', config, now + 22, 'pia');
  assert.deepEqual([ceiling.allowed, ceiling.limit], [false, 5]);
  // A refused request does not use the share: once the minute turns, everyone starts again.
  assert.equal(consumeEndpointRateLimit('lead-search', config, now + 60_001, 'ana').allowed, true);
  // Without a person, only the ceiling counts, as before.
  assert.equal(consumeEndpointRateLimit('lead-search', config, now + 60_002).allowed, true);
});

test('a burst seconds before the minute turns waits for it instead of failing; a long wait is still refused', async () => {
  let clock = 2_000_000_000_000;
  const slept: number[] = [];
  const sleep = async (ms: number) => { slept.push(ms); clock += ms; };
  for (let i = 0; i < 3; i += 1) consumeEndpointRateLimit('lead-search', config, clock, 'eva');
  clock += 55_000; // five seconds before Eva's minute ends
  const waited = await waitForEndpointRateLimit('lead-search', config, 'eva', { sleep, now: () => clock });
  assert.deepEqual([waited.allowed, slept], [true, [5_000]]);

  const fresh = 3_000_000_000_000;
  for (let i = 0; i < 3; i += 1) consumeEndpointRateLimit('lead-search', config, fresh, 'tom');
  const refused = await waitForEndpointRateLimit('lead-search', config, 'tom', { sleep, now: () => fresh + 1_000 });
  assert.equal(refused.allowed, false, 'a whole minute away: it does not wait');
  assert.deepEqual(slept, [5_000]);
});
