import test from 'node:test';

// Runs the DOM tests of the Centro de ayuda inside the unit suite, so CI covers them.
test('the Centro de ayuda shows the path, the popular questions and a card per topic by role, searches, answers with the AI or the manual, and starts the tour', async () => {
  await import('../scripts/test-help-center.mjs');
});

test('each section of the manual has its own page with its screen, guide, steps, questions and what follows', async () => {
  await import('../scripts/test-help-section-page.mjs');
});
