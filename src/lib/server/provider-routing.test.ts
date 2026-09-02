import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveLeadProvider } from './provider-routing';

test('Apollo-only routing normalizes a legacy provider request', () => {
  const decision = resolveLeadProvider({
    requestedProvider: 'pdl',
    organizationId: 'legacy-pdl-organization',
    defaultProviderEnv: 'LEADS_PROVIDER_DEFAULT',
    fallbackDefaultProvider: 'pdl',
  });

  assert.deepEqual(decision, {
    provider: 'apollo',
    requestedProvider: 'pdl',
    defaultProvider: 'apollo',
    forcedProviderReason: 'apollo_only',
  });
});

test('Apollo-only routing ignores retired provider defaults', () => {
  const original = process.env.LEADS_PROVIDER_DEFAULT;
  process.env.LEADS_PROVIDER_DEFAULT = 'pdl';

  try {
    const decision = resolveLeadProvider({
      defaultProviderEnv: 'LEADS_PROVIDER_DEFAULT',
      fallbackDefaultProvider: 'auto',
    });

    assert.equal(decision.provider, 'apollo');
    assert.equal(decision.defaultProvider, 'apollo');
    assert.equal(decision.requestedProvider, null);
  } finally {
    if (original === undefined) delete process.env.LEADS_PROVIDER_DEFAULT;
    else process.env.LEADS_PROVIDER_DEFAULT = original;
  }
});
