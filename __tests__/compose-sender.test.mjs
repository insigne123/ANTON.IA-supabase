import test from 'node:test';

// Runs scripts/test-compose-sender.mjs inside the unit suite, so CI covers it.
test('compose shows the real sender and asks to connect when there is no mailbox', async () => {
  await import('../scripts/test-compose-sender.mjs');
});
