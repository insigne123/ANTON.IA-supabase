import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCT_TOUR_METADATA_KEY, PRODUCT_TOUR_STEPS, PRODUCT_TOUR_VERSION,
  productTourRecord, productTourSteps, shouldOfferProductTour,
} from './product-tour';

const now = new Date('2026-09-25T15:00:00Z');

test('the tour is offered once to new accounts and never after finishing or skipping it', () => {
  assert.equal(shouldOfferProductTour({ record: null, createdAt: '2026-09-25T14:59:00Z', now }), true);
  assert.equal(shouldOfferProductTour({ record: null, createdAt: '2026-09-25T15:00:05Z', now }), true, 'a clock slightly behind still counts as new');
  assert.equal(shouldOfferProductTour({ record: null, createdAt: '2026-08-01T00:00:00Z', now }), false, 'older accounts replay it from the menu');
  assert.equal(shouldOfferProductTour({ record: null, createdAt: null, now }), false);
  for (const status of ['completed', 'skipped'] as const) {
    assert.equal(shouldOfferProductTour({ record: { version: PRODUCT_TOUR_VERSION, status, updatedAt: '' }, createdAt: '2026-09-25T14:59:00Z', now }), false);
  }
  assert.equal(shouldOfferProductTour({ record: { version: PRODUCT_TOUR_VERSION - 1, status: 'completed', updatedAt: '' }, createdAt: '2026-09-25T14:59:00Z', now }), true,
    'a new version is offered again to new accounts');
});

test('only a well-formed record counts as seen', () => {
  const record = { version: 1, status: 'skipped', updatedAt: '2026-09-25T15:00:00Z' };
  assert.deepEqual(productTourRecord({ full_name: 'Ana', [PRODUCT_TOUR_METADATA_KEY]: record }), record);
  assert.equal(productTourRecord({ [PRODUCT_TOUR_METADATA_KEY]: { version: 1, status: 'maybe' } }), null);
  assert.equal(productTourRecord({ [PRODUCT_TOUR_METADATA_KEY]: 'completed' }), null);
  assert.equal(productTourRecord(null), null);
});

test('steps are short, unique and point at menu entries; the menu button step is mobile only', () => {
  const ids = PRODUCT_TOUR_STEPS.map(step => step.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const step of PRODUCT_TOUR_STEPS) {
    assert.ok(step.title.length <= 40, step.id);
    assert.ok(step.body.length <= 140, step.id);
    assert.ok(step.mobileOnly || step.menuLabel, `${step.id} says where it is in the menu`);
  }
  assert.deepEqual(productTourSteps(false).map(step => step.id), ids.filter(id => id !== 'menu'));
  assert.equal(productTourSteps(true)[0].id, 'menu');
  assert.equal(productTourSteps(false).at(-1)?.target, 'tour-help', 'it ends where it can be replayed');
});