import assert from 'node:assert/strict';
import test from 'node:test';
import { addMessageTracking } from './email-tracking';

test('message tracking is tied to a send identity and does not rewrite unsubscribe links', () => {
  const result = addMessageTracking({ html: '<a href="https://example.com/page?a=1&b=2">Abrir</a><a href="https://example.com/unsubscribe?t=abc">Baja</a>', baseUrl: 'https://app.example.com', trackingKey: 'dispatch-1' });
  assert.equal(result.pixelEnabled, true);
  assert.equal(result.trackedLinks, 1);
  assert.match(result.html, /\/api\/tracking\/open\?dispatch=dispatch-1/);
  assert.match(result.html, /\/api\/tracking\/click\?dispatch=dispatch-1&amp;url=https%3A%2F%2Fexample.com%2Fpage/);
  assert.match(result.html, /href="https:\/\/example.com\/unsubscribe\?t=abc"/);
});

test('without tracking identity content is left unchanged', () => {
  assert.deepEqual(addMessageTracking({ html: '<p>Hola</p>', baseUrl: 'https://app.example.com' }), { html: '<p>Hola</p>', trackedLinks: 0, pixelEnabled: false });
});
