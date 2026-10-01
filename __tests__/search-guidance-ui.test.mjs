import test from 'node:test';

// Runs the DOM test of the lead search guidance (scripts/test-search-guidance-ui.mjs) inside the unit suite, so CI covers it.
test('lead search guidance renders its problems, starting points and filter hints', async () => {
  await import('../scripts/test-search-guidance-ui.mjs');
});
