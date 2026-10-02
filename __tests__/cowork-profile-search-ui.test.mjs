import test from 'node:test';

test('an exact LinkedIn lookup shows its profile and cost before approval, without saving or inviting', async () => {
  await import('../scripts/test-cowork-profile-search-ui.mjs');
});
