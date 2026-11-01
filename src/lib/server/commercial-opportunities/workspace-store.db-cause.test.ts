import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('an Opportunities database failure keeps its SQLSTATE and the name of our own exception, never row data (audit O2)', async () => {
  const source = readFileSync('src/lib/server/commercial-opportunities/workspace-store.ts', 'utf8');
  const body = source.slice(source.indexOf('export function opportunityDbCause'), source.indexOf('export function opportunityDb<T>'));
  // Evaluate the pure helper on its own, without the module's server imports.
  const opportunityDbCause = new Function(`${body.replace('export function', 'function').replace(/: \{ code\?: string; message\?: string \}/, '')}; return opportunityDbCause;`)();
  assert.equal(opportunityDbCause({ code: 'P0001', message: 'OPPORTUNITY_LEASE_LOST' }), 'P0001 OPPORTUNITY_LEASE_LOST');
  assert.equal(opportunityDbCause({ code: '21000', message: 'ON CONFLICT DO UPDATE command cannot affect row a second time' }), '21000');
  assert.equal(opportunityDbCause({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }), 'PGRST116');
  assert.equal(opportunityDbCause({ code: 'nope', message: 'contains user@example.com' }), '');
  assert.match(source, /No se pudo completar la acción de Oportunidades\.\$\{cause \? ` \(código \$\{cause\}\)` : ''\}/);
});
