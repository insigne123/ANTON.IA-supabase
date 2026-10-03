import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchQuotaStatus, resetQuotaStatusCache } from './quota-status-client';

function countingFetch(responses: Array<() => Response>) {
  let calls = 0;
  const impl = (async () => {
    const respond = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    return respond();
  }) as typeof fetch;
  return { impl, calls: () => calls };
}

test('readers that ask together share one request; «Actualizar» and an old answer ask again', async () => {
  resetQuotaStatusCache();
  const { impl, calls } = countingFetch([() => Response.json({ statuses: [], credits: { a: 1 } })]);
  const [first, second, third] = await Promise.all([
    fetchQuotaStatus({ fetchImpl: impl }),
    fetchQuotaStatus({ fetchImpl: impl }),
    fetchQuotaStatus({ fetchImpl: impl }),
  ]);
  assert.equal(calls(), 1, 'QuotaSync, Uso diario and Créditos on «Hoy»: one request');
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
  await fetchQuotaStatus({ fetchImpl: impl, force: true });
  assert.equal(calls(), 2);
  await fetchQuotaStatus({ fetchImpl: impl, maxAgeMs: 0 });
  assert.equal(calls(), 3);
});

test('a failed answer is reported with its status and is not reused', async () => {
  resetQuotaStatusCache();
  const { impl, calls } = countingFetch([() => new Response(null, { status: 401 }), () => Response.json({ statuses: [] })]);
  await assert.rejects(fetchQuotaStatus({ fetchImpl: impl }), /QUOTA_STATUS_401$/);
  assert.deepEqual(await fetchQuotaStatus({ fetchImpl: impl }), { statuses: [] });
  assert.equal(calls(), 2);
});
