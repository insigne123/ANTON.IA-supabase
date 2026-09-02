import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ENRICHMENT_SEARCH_ALLOWED_EMAIL,
  ENRICHMENT_SEARCH_CREDITS_UNAVAILABLE,
  enrichmentSearchCreditsUnavailablePayload,
  hasEnrichmentSearchCreditAccess,
  normalizeEnrichmentSearchEmail,
} from './enrichment-search-access';

const quotaStoreSource = readFileSync(new URL('./daily-quota-store.ts', import.meta.url), 'utf8');
const quotaClientSource = readFileSync(new URL('../quota-client.ts', import.meta.url), 'utf8');
const workerSource = readFileSync(new URL('../../../functions/index.ts', import.meta.url), 'utf8');
const backupWorkerSource = readFileSync(new URL('../../app/api/cron/antonia/route.ts', import.meta.url), 'utf8');
const protectedRouteSources = [
  readFileSync(new URL('../../app/api/opportunities/enrich-apollo/route.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../app/api/opportunities/search/route.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../app/api/opportunities/status/route.ts', import.meta.url), 'utf8'),
];
const freeSearchRouteSources = [
  readFileSync(new URL('../../app/api/leads/search/route.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../app/api/opportunities/leads-apollo/route.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../app/api/opportunities/orgs-apollo/route.ts', import.meta.url), 'utf8'),
];

test('paid enrichment access is allowlisted by normalized auth email', () => {
  assert.equal(normalizeEnrichmentSearchEmail(` ${ENRICHMENT_SEARCH_ALLOWED_EMAIL.toUpperCase()} `), ENRICHMENT_SEARCH_ALLOWED_EMAIL);
  assert.equal(hasEnrichmentSearchCreditAccess(` ${ENRICHMENT_SEARCH_ALLOWED_EMAIL.toUpperCase()} `), true);
  assert.equal(hasEnrichmentSearchCreditAccess('otro@grupoexpro.com'), false);
  assert.equal(hasEnrichmentSearchCreditAccess(null), false);
});

test('denied credit responses are explicitly zero and carry a stable error code', () => {
  assert.deepEqual(enrichmentSearchCreditsUnavailablePayload(), {
    error: ENRICHMENT_SEARCH_CREDITS_UNAVAILABLE,
    message: 'Esta cuenta no tiene créditos disponibles para enriquecimiento.',
    count: 0,
    limit: 0,
  });
});

test('search quota is independent while paid enrichment boundaries retain the allowlist', () => {
  assert.match(quotaStoreSource, /leadSearch: DEFAULT_DAILY_QUOTA_LIMITS\.leadSearch/);
  assert.match(quotaStoreSource, /resource === 'search' \|\| resource === 'leadSearch'/);
  assert.match(quotaClientSource, /params\.limit >= 0/);
  assert.match(workerSource, /hasUserEnrichmentSearchCreditAccess\(supabase, userId\)/);
  assert.match(workerSource, /internal_search_failed:429:[\s\S]*throw e/);
  assert.match(backupWorkerSource, /hasUserEnrichmentSearchCreditAccess\(userId\)/);
  assert.match(backupWorkerSource, /internal_search_failed:429:[\s\S]*throw internalErr/);

  for (const source of protectedRouteSources) {
    const handlerStart = source.indexOf('export async function ');
    const gate = Math.min(
      ...['hasEnrichmentSearchCreditAccess', 'hasUserEnrichmentSearchCreditAccess'].map((needle) => {
        const index = source.indexOf(needle, handlerStart);
        return index < 0 ? Number.POSITIVE_INFINITY : index;
      }),
    );
    const provider = Math.min(
      ...['submitApolloEnrichment', 'client.actor('].map((needle) => {
        const index = source.indexOf(needle, handlerStart);
        return index < 0 ? Number.POSITIVE_INFINITY : index;
      }),
    );
    assert.ok(handlerStart >= 0 && gate > handlerStart, 'provider route must check the allowlist');
    if (Number.isFinite(provider)) assert.ok(gate < provider, 'allowlist must precede the provider call');
  }

  for (const source of freeSearchRouteSources) {
    assert.doesNotMatch(source, /enrichmentSearchCreditsUnavailablePayload|hasEnrichmentSearchCreditAccess/);
  }
});
