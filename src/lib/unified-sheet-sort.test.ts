import assert from 'node:assert/strict';
import test from 'node:test';

import type { UnifiedRow } from './unified-sheet-types';
import { compareSheetRows } from './unified-sheet-sort';

const row = (gid: string, overrides: Partial<UnifiedRow> = {}): UnifiedRow => ({ gid, sourceId: gid, status: 'saved', kind: 'lead_saved', ...overrides } as UnifiedRow);
const order = (rows: UnifiedRow[], key: Parameters<typeof compareSheetRows>[2], direction: 'asc' | 'desc' = 'asc') =>
  [...rows].sort((a, b) => compareSheetRows(a, b, key, direction)).map((item) => item.gid);

test('«Estado» sorts by progress, not as a date or by its label', () => {
  const rows = [row('replied', { status: 'replied' }), row('saved', { status: 'saved' }), row('sent', { status: 'sent' }), row('opened', { status: 'opened' })];
  assert.deepEqual(order(rows, 'status'), ['saved', 'sent', 'opened', 'replied']);
  assert.deepEqual(order(rows, 'status', 'desc'), ['replied', 'opened', 'sent', 'saved']);
});

test('dates sort by time and an empty or broken date goes last both ways', () => {
  const rows = [row('none'), row('old', { createdAt: '2026-01-02T00:00:00Z' }), row('bad', { createdAt: 'mañana' }), row('new', { createdAt: '2026-09-30T00:00:00Z' })];
  assert.deepEqual(order(rows, 'createdAt'), ['old', 'new', 'none', 'bad']);
  assert.deepEqual(order(rows, 'createdAt', 'desc').slice(0, 2), ['new', 'old']);
});

test('text sorts in Spanish with numbers in order, empties last', () => {
  const rows = [row('b', { company: 'Ñandú' }), row('a', { company: 'Árbol' }), row('e', { company: '' }), row('n2', { company: 'Tienda 10' }), row('n1', { company: 'Tienda 9' })];
  assert.deepEqual(order(rows, 'company'), ['a', 'b', 'n1', 'n2', 'e']);
  assert.deepEqual(order(rows, 'company', 'desc').at(-1), 'e');
});

test('each source of the sheet falls back on its own, so one failure does not empty the whole table', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('src/lib/unified-sheet-data.ts', 'utf8');
  // Every source goes through `read`, which awaits it inside its own try and keeps the others when it fails.
  const reads = source.match(/read\('(?:saved|enriched|opportunities|contacted|custom)', \(\) => /g) || [];
  assert.equal(reads.length, 5);
  assert.match(source, /try \{ return await load\(\); \}\s*catch \(e\) \{[^\n]*failed\.push\(source\); return empty; \}/);
  const page = readFileSync('src/app/(app)/sheet/page.tsx', 'utf8');
  assert.match(page, /compareSheetRows\(a, b, sortKey, sortDirection\)/);
  assert.doesNotMatch(page, /sortKey\.toLowerCase\(\)\.includes\('at'\)/);
});
