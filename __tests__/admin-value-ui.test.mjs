import test from 'node:test';

// Runs scripts/test-admin-value.mjs inside the unit suite, so CI covers it.
test('admin summary shows results, adoption and who needs help, and never sends on its own', async () => {
  await import('../scripts/test-admin-value.mjs');
});
