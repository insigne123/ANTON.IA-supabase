import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSupliaEnabled } from './access';

test('SUPL.IA is enabled by default only in local development', () => {
  assert.equal(resolveSupliaEnabled({ nodeEnv: 'development' }), true);
  assert.equal(resolveSupliaEnabled({ nodeEnv: 'production' }), false);
  assert.equal(resolveSupliaEnabled({ nodeEnv: 'test' }), false);
});

test('SUPL.IA honors an explicit environment override', () => {
  assert.equal(resolveSupliaEnabled({ configuredValue: 'true', nodeEnv: 'production' }), true);
  assert.equal(resolveSupliaEnabled({ configuredValue: 'false', nodeEnv: 'development' }), false);
  assert.equal(resolveSupliaEnabled({ configuredValue: ' TRUE ', nodeEnv: 'production' }), true);
});
