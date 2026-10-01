import test from 'node:test';

// Runs the DOM test of «Hoy» (scripts/test-today-panel-ui.mjs) inside the unit suite, so CI covers it.
test('«Hoy» renders its primary step, queue, setup and errors', async () => {
  await import('../scripts/test-today-panel-ui.mjs');
});
