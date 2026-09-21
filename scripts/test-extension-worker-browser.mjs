// Real Chromium extension worker + local HTTP server; no production credentials/providers.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
let received;
const server = createServer((req, res) => {
  received = req.headers;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ userId: 'test-user', organizationId: 'test-org' }));
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(9003, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
try {
  const extension = resolve('chrome-extension');
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await context.addCookies([{ name: 'test_session', value: 'fixture-only', url: origin, httpOnly: true, sameSite: 'Lax' }]);
  const result = await worker.evaluate(async origin => {
    await chrome.storage.local.set({ prospectConnection: { origin, session: { userId: 'test-user', organizationId: 'test-org' } } });
    return prospectRequest(await prospectConnection(), { action: 'session' });
  }, origin);
  assert.equal(result.userId, 'test-user');
  assert.match(received.origin, /^chrome-extension:\/\/[a-p]{32}$/);
  assert.match(received.cookie, /test_session=fixture-only/);
  console.log('PASS: real extension worker sends HttpOnly SameSite=Lax session cookie and extension Origin with no app tab.');
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
}
