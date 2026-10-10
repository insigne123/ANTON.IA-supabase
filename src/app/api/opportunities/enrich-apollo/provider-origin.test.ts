import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as crypto from 'node:crypto';

test('Apollo rejects LF markers and namespaces before quota, callbacks, database mutations or provider work', async t => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('no external request'); });
  let effects = 0;
  const modules: Record<string, unknown> = {
    'node:crypto': crypto,
    'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    '@/lib/server/request-auth': { requireSessionOrTrustedInternalRequest: async () => ({source: 'session', user: {id: 'me'}, organizationId: 'org'}), requestAuthErrorResponse: () => null },
  };
  const noEffects = new Proxy({}, {get: () => () => { effects++; throw Error('Unexpected side effect'); }});
  const code = ts.transpileModule(readFileSync('src/app/api/opportunities/enrich-apollo/route.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const exports: any = {};
  new Function('require', 'exports', code)((name: string) => modules[name] || noEffects, exports);
  for (const lf of [{sourceProvider: 'leads_finder'}, {source_provider: 'leads_finder'}, {sourceProviderId: 'lf_' + 'a'.repeat(24)}, {id: 'lf_invalid'}]) {
    const response = await exports.POST(new Request('https://app.test/api/opportunities/enrich-apollo', {method: 'POST', body: JSON.stringify({leads: [{fullName: 'Other'}, {...lf, fullName: 'Cached contact'}], revealPhone: true, tableName: 'enriched_leads'})}));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'ENRICHMENT_PROVIDER_MISMATCH');
  }
  assert.equal(effects, 0);
});
