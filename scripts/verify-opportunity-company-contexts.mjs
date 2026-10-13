// Public configuration validation only: no env files, provider calls, DB clients, jobs or filesystem writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const manifest = JSON.parse(readFileSync('docs/oportunidades-contextos-publicos-2026-10-13.json', 'utf8'));
const compiled = await build({ stdin: { contents: `export {companyContextSchema} from './src/lib/commercial-opportunities/workspace';export {criteriaSchema} from './src/lib/server/commercial-opportunities/workspace-sources';`, loader: 'ts', resolveDir: process.cwd() }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external' });
const output = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
const { companyContextSchema, criteriaSchema } = output.exports;
assert.equal(manifest.version, 'public-company-context/2026-10-13');
assert.deepEqual(manifest.companies.map(company => company.workspace), ['GrupoExpro', 'PSOL']);
const summaries = [];
for (const company of manifest.companies) {
  const context = companyContextSchema.parse(company.context);
  criteriaSchema.parse(company.criteria);
  assert.ok(company.research.published.length > 0 && company.research.inferred.length > 0);
  for (const source of company.research.published) {
    const url = new URL(source.url);
    assert.equal(url.protocol, 'https:');
    assert.ok(['grupoexpro.com', 'psol-latam.com'].includes(url.hostname));
    assert.ok(source.quote.length >= 8);
  }
  for (const query of company.criteria.postQueries) {
    assert.ok(query.length <= 400);
    assert.ok((query.match(/\b(?:AND|OR|NOT)\b/g) || []).length <= 5);
    assert.ok(!/site:/i.test(query));
  }
  const hash = createHash('sha256').update(JSON.stringify(company)).digest('hex');
  summaries.push({ workspace: company.workspace, hash, services: context.services.length, sources: company.research.published.length, priority: context.priority, automation: context.automation, inferenceSeparated: true });
}
assert.equal(manifest.companies[0].context.priority, 'hiring');
assert.equal(manifest.companies[1].context.priority, 'posts');
assert.equal(manifest.companies[1].context.automation, false);
console.log(JSON.stringify({ validated: true, companies: summaries, providerCalls: 0, productionWrites: 0 }, null, 2));
