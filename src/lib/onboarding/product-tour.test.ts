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

test('steps are short and unique; menu steps say where they are, page steps say which screen', () => {
  const ids = PRODUCT_TOUR_STEPS.map(step => step.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const step of PRODUCT_TOUR_STEPS) {
    assert.ok(step.title.length <= 40, step.id);
    assert.ok(step.body.length <= 140, `${step.id}: ${step.body.length}`);
    assert.ok(step.section, `${step.id} says which part of the app it is in`);
    assert.ok(step.mobileOnly || step.menuLabel || step.route || step.target === 'page-help', `${step.id} says where it is`);
  }
  assert.deepEqual(productTourSteps(false).map(step => step.id), ids.filter(id => id !== 'menu'));
  assert.equal(productTourSteps(true)[0].id, 'menu');
  assert.equal(productTourSteps(false).at(-1)?.target, 'help-center', 'it ends where the manual and the replay live');
});

test('screen guides are short, unique, cover the main screens and point at anchors that exist in the code', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { PAGE_GUIDES, pageGuideFor } = await import('./product-tour');
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx$/.test(name)) sources.push(readFileSync(path, 'utf8'));
    }
  };
  walk('src');
  const code = sources.join('\n');
  const ids = PAGE_GUIDES.map((guide) => guide.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const guide of PAGE_GUIDES) {
    assert.ok(guide.steps.length >= 1 && guide.steps.length <= 4, guide.id);
    for (const step of guide.steps) {
      assert.ok(step.title.length <= 40, `${guide.id}:${step.id}`);
      assert.ok(step.body.length <= 140, `${guide.id}:${step.id}`);
      assert.ok(code.includes(`data-tour="${step.target}"`), `${guide.id}:${step.target} is anchored on a real control`);
    }
  }
  assert.equal(pageGuideFor('/search')?.id, 'search');
  assert.equal(pageGuideFor('/saved/leads')?.id, 'saved');
  assert.equal(pageGuideFor('/saved/leads/enriched')?.id, 'enriched');
  assert.equal(pageGuideFor('/contacted')?.id, 'conversations');
  assert.equal(pageGuideFor('/contacted/replied'), null); // Retired: the address redirects to /contacted?view=reply.
  assert.equal(pageGuideFor('/dashboard')?.id, 'home');
  assert.equal(pageGuideFor('/settings/privacy'), null);
  assert.equal(pageGuideFor(null), null);
});

test('only known guides marked true count as seen', async () => {
  const { PAGE_GUIDES_METADATA_KEY, seenPageGuides } = await import('./product-tour');
  assert.deepEqual(seenPageGuides({ [PAGE_GUIDES_METADATA_KEY]: { search: true, crm: 'yes', ghost: true } }), { search: true });
  assert.deepEqual(seenPageGuides({ [PAGE_GUIDES_METADATA_KEY]: ['search'] }), {});
  assert.deepEqual(seenPageGuides(null), {});
});

test('the tour walks every main screen, in the order of the work, and ends where help lives', async () => {
  const { existsSync, readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { onTourRoute, pageGuidesInTour } = await import('./product-tour');
  assert.deepEqual(productTourSteps(false).map((step) => step.route || step.target), [
    '/dashboard', '/dashboard', '/profile', '/profile', '/connections', '/search', '/search', '/saved/leads',
    '/saved/leads/enriched', '/saved/leads/enriched', '/contacted', '/campaigns', '/crm', 'page-help', 'help-center',
  ]);
  assert.ok(PRODUCT_TOUR_VERSION >= 3, 'the new tour is offered again to new accounts');
  assert.doesNotMatch(JSON.stringify(PRODUCT_TOUR_STEPS), /agente|misiones/i, 'the retired agent is not in the tour');

  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx$/.test(name)) sources.push(readFileSync(path, 'utf8'));
    }
  };
  walk('src');
  const code = sources.join('\n');
  for (const step of PRODUCT_TOUR_STEPS) {
    if (step.target !== 'menu') assert.ok(code.includes(`data-tour="${step.target}"`), `${step.id}: ${step.target} is anchored on a real control`);
    if (step.route) assert.ok(existsSync(join('src/app/(app)', step.route, 'page.tsx')), `${step.id}: ${step.route} is a real screen`);
  }

  assert.equal(onTourRoute('/search/', '/search'), true);
  assert.equal(onTourRoute('/search?mode=filters', '/search'), true);
  assert.equal(onTourRoute('/saved/leads/enriched', '/saved/leads'), false);
  assert.deepEqual(pageGuidesInTour().sort(), ['campaigns', 'connections', 'conversations', 'crm', 'enriched', 'home', 'profile', 'saved', 'search']);
});
