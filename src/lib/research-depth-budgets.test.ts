import assert from 'node:assert/strict';
import test from 'node:test';

import {
  capQueriesForDepth,
  depthFromAllowedDepth,
  getResearchDepthBudget,
  normalizeResearchDepth,
  RESEARCH_DEPTH_BUDGETS,
} from './research-depth-budgets';

const query = (family: string, index: number, ownDomain = false) => ({
  family,
  query: `${family} query ${index}`,
  ownDomain,
});

const REQUIRED = ['scale', 'press', 'spokesperson', 'people', 'hiring', 'industry', 'registry'];

test('budgets define searches/pages/evidence/model-stage limits that grow with depth', () => {
  (['express', 'standard', 'deep'] as const).forEach((depth) => {
    const budget = RESEARCH_DEPTH_BUDGETS[depth];
    assert.ok(budget.maxQueries >= 7, `${depth} must cover the seven required families`);
    assert.ok(budget.maxPages > 0 && budget.maxEvidence > 0 && budget.maxModelStages > 0);
  });
  assert.ok(RESEARCH_DEPTH_BUDGETS.express.maxQueries <= RESEARCH_DEPTH_BUDGETS.standard.maxQueries);
  assert.ok(RESEARCH_DEPTH_BUDGETS.standard.maxQueries <= RESEARCH_DEPTH_BUDGETS.deep.maxQueries);
  assert.ok(RESEARCH_DEPTH_BUDGETS.express.maxEvidence < RESEARCH_DEPTH_BUDGETS.deep.maxEvidence);
  assert.ok(RESEARCH_DEPTH_BUDGETS.express.maxModelStages < RESEARCH_DEPTH_BUDGETS.deep.maxModelStages);
});

test('unknown depths fall back to standard without throwing', () => {
  assert.equal(normalizeResearchDepth('ultra'), 'standard');
  assert.equal(normalizeResearchDepth(null), 'standard');
  assert.equal(getResearchDepthBudget('nope').depth, 'standard');
  assert.equal(getResearchDepthBudget('deep').maxQueries, 12);
});

test('qualification depths map fail-closed to the cheapest budget', () => {
  assert.equal(depthFromAllowedDepth('deep'), 'deep');
  assert.equal(depthFromAllowedDepth('shallow'), 'standard');
  assert.equal(depthFromAllowedDepth('skip'), 'express');
  assert.equal(depthFromAllowedDepth('unknown'), 'express');
});

test('express caps protect required families first', () => {
  const queries = [
    ...REQUIRED.map((family, index) => query(family, index)),
    query('awards', 100),
    query('tech', 101),
  ];
  const capped = capQueriesForDepth(queries, 'express', { requiredFamilies: REQUIRED });
  assert.equal(capped.length, 7);
  assert.deepEqual(new Set(capped.map((item) => item.family)), new Set(REQUIRED));
});

test('depth caps enforce per-family and own-domain limits deterministically', () => {
  const queries = [
    query('scale', 1, true),
    query('scale', 2, true),
    query('press', 3, true),
    query('press', 4, false),
  ];
  const first = capQueriesForDepth(queries, 'express', { requiredFamilies: REQUIRED });
  const second = capQueriesForDepth(queries, 'express', { requiredFamilies: REQUIRED });
  assert.deepEqual(first, second);
  assert.ok(first.filter((item) => item.ownDomain).length <= 1);
  assert.ok(first.filter((item) => item.family === 'scale').length <= 1);
});

test('deep keeps optional families once required ones fit', () => {
  const queries = [
    ...REQUIRED.map((family, index) => query(family, index)),
    query('awards', 100),
    query('tech', 101),
  ];
  const capped = capQueriesForDepth(queries, 'deep', { requiredFamilies: REQUIRED });
  assert.equal(capped.length, 9);
  assert.ok(capped.some((item) => item.family === 'awards'));
});
