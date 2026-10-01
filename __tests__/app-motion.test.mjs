import test from 'node:test';

// Runs scripts/test-app-motion.mjs inside the unit suite, so CI covers it.
test('screens and empty states use motion-safe motion and one clear action', async () => {
  await import('../scripts/test-app-motion.mjs');
});
