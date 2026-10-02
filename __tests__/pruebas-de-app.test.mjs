import test from 'node:test';

// The 1 Oct test (Pruebas_de_app.docx) repeated end to end inside the unit suite, so CI covers it (Plan 6, PR-Z).
test('the 1 Oct test, repeated: two people prepared with one approval, real names and LinkedIn, the notice, their full reports, a first email each about AXIS and the campaign', async () => {
  await import('../scripts/test-pruebas-de-app.mjs');
});
