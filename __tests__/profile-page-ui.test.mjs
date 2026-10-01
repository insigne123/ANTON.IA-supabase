import test from 'node:test';

// Runs scripts/test-profile-page.mjs inside the unit suite, so CI covers it.
test('Perfil reads the site, proposes with sources and saves only what the person applied', async () => {
  await import('../scripts/test-profile-page.mjs');
});
