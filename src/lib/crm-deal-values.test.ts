import assert from 'node:assert/strict';
import test from 'node:test';

import { dealTotals, dealTrendText, formatDealValue, formatDealValueShort, parseDealValue, sumDealValues } from './crm-deal-values';
import type { UnifiedRow } from './unified-sheet-types';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const row = (gid: string, overrides: Partial<UnifiedRow>): UnifiedRow => ({ gid, sourceId: gid, status: 'saved', kind: 'contacted', ...overrides } as UnifiedRow);

test('amounts read as people type them in Chile', () => {
  assert.equal(parseDealValue('1.200.000'), 1_200_000);
  assert.equal(parseDealValue('$ 1.200.000'), 1_200_000);
  assert.equal(parseDealValue('1200000'), 1_200_000);
  assert.equal(parseDealValue('120,5'), 120.5);
  assert.equal(parseDealValue('UF 85,25'), 85.25);
  assert.equal(parseDealValue('1.200'), 1200);
  assert.equal(parseDealValue('99.5'), 99.5);
  assert.equal(parseDealValue(''), null);
  assert.equal(parseDealValue('   '), null);
  assert.equal(parseDealValue('mucho'), 'invalid');
  assert.equal(parseDealValue('-5'), 'invalid');
  assert.equal(parseDealValue('1,2,3'), 'invalid');
  assert.equal(parseDealValue('1000000000000'), 'invalid');
});

test('amounts are written with their currency', () => {
  assert.equal(formatDealValue(1_200_000, 'CLP'), '$1.200.000');
  assert.equal(formatDealValue(12_000, 'USD'), 'US$12.000');
  assert.equal(formatDealValue(120.5, 'UF'), 'UF 120,5');
  assert.equal(formatDealValue(9000, 'EUR'), '€9.000');
});

test('where there is little room, amounts are shortened and the comparison spells out its sign', () => {
  assert.equal(formatDealValueShort(12_500_000, 'CLP'), '$12,5 M');
  assert.equal(formatDealValueShort(850_000, 'CLP'), '$850 mil');
  assert.equal(formatDealValueShort(9_500, 'CLP'), '$9.500');
  assert.equal(formatDealValueShort(85.25, 'UF'), 'UF 85,25');
  assert.equal(formatDealValueShort(1_250_000_000, 'USD'), 'US$1.250 M');
  assert.equal(dealTrendText(1_200_000, 'CLP', '30 días antes'), '+$1,2 M vs 30 días antes');
  assert.equal(dealTrendText(-50_000, 'CLP', '30 días antes'), '−$50 mil vs 30 días antes');
  assert.equal(dealTrendText(0, 'CLP', '30 días antes'), 'igual que 30 días antes');
});

test('the panel adds the open pipeline by stage and what was won in the period, never mixing currencies', () => {
  const rows = [
    row('a', { stage: 'meeting', dealValue: 1_000_000, dealCurrency: 'CLP' }),
    row('b', { stage: 'negotiation', dealValue: 3_000_000, dealCurrency: 'CLP' }),
    row('c', { stage: 'closed_won', dealValue: 2_000_000, dealCurrency: 'CLP', wonAt: daysAgo(5) }),
    row('d', { stage: 'closed_won', dealValue: 500_000, dealCurrency: 'CLP', wonAt: daysAgo(40) }),
    row('e', { stage: 'closed_won', dealValue: 700_000, dealCurrency: 'CLP', stageChangedAt: daysAgo(10) }),
    row('f', { stage: 'meeting', dealValue: 5_000, dealCurrency: 'USD' }),
    row('g', { stage: 'contacted' }),
  ];
  const totals = dealTotals(rows, { days: 30, now: NOW });
  assert.ok(totals);
  assert.equal(totals.currency, 'CLP');
  assert.equal(totals.deals, 5);
  assert.equal(totals.openDeals, 2);
  assert.equal(totals.open, 4_000_000);
  assert.equal(totals.openByStage.find(item => item.stage === 'meeting')?.value, 1_000_000);
  assert.equal(totals.won, 2_700_000, 'won in the last 30 days, a lead saved before the migration by its stage change');
  assert.equal(totals.wonPrevious, 500_000);
  assert.deepEqual(totals.others, [{ currency: 'USD', deals: 1 }]);
});

test('no values, no totals', () => {
  assert.equal(dealTotals([row('a', { stage: 'meeting' }), row('b', { stage: 'contacted', dealValue: 0 })], { days: 30, now: NOW }), null);
});

test('a column of the board adds its deals in the currency most of them use', () => {
  assert.equal(sumDealValues([row('a', { stage: 'meeting' })]), null);
  assert.deepEqual(sumDealValues([
    row('a', { stage: 'meeting', dealValue: 1_000_000 }),
    row('b', { stage: 'meeting', dealValue: 2_500_000.5, dealCurrency: 'CLP' }),
    row('c', { stage: 'meeting', dealValue: 3_000, dealCurrency: 'USD' }),
    row('d', { stage: 'meeting', dealValue: 0, dealCurrency: 'USD' }),
  ]), { currency: 'CLP', value: 3_500_000.5, deals: 2, otherCurrencies: 1 });
});
