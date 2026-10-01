import test from 'node:test';

// Runs the DOM test of the Centro de ayuda inside the unit suite, so CI covers it.
test('the Centro de ayuda shows the manual by role, searches, answers with the AI or the manual, and starts the tour', async () => {
  await import('../scripts/test-help-center.mjs');
});
