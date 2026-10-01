import test from 'node:test';

// Runs the DOM tests of the app tour and the screen guides inside the unit suite, so CI covers them.
test('the app tour opens once, can be skipped or replayed, and works on desktop and phones', async () => {
  await import('../scripts/test-product-tour.mjs');
});

test('screen guides are offered once, walked, declined, replayed and explained when empty', async () => {
  await import('../scripts/test-page-guides.mjs');
});
