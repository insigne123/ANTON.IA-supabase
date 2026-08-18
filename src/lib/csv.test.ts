import test from 'node:test';
import assert from 'node:assert/strict';

import { toCsv } from './csv';

test('CSV export neutralizes spreadsheet formulas', () => {
  const csv = toCsv([
    ['=HYPERLINK("https://example.com")', '+SUM(1,1)', '-1+2', '@command'],
  ], ['A', 'B', 'C', 'D']);

  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /'\+SUM/);
  assert.match(csv, /'-1\+2/);
  assert.match(csv, /'@command/);
});
