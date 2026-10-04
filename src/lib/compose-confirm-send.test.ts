import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const compose = readFileSync('src/app/(app)/contact/compose/page.tsx', 'utf8');

test('«Redactar correo» offers «Confirmar y enviar» and keeps «Solo confirmar»', () => {
  assert.match(compose, /'Confirmar y enviar'/);
  assert.match(compose, /Solo confirmar/);
  // The send waits for the approved draft in state and goes through the same send() and its blocking checks.
  assert.match(compose, /if \(!sendAfterReview \|\| nativeDraftApproving \|\| !nativeReviewComplete\) return;/);
  assert.match(compose, /if \(latest && !latest\.blocked\) void latest\.send\(\);/);
  assert.match(compose, /confirmedSendRef\.current = \{ send, blocked: isSendBlocked \};/);
});

test('the success screen names the mailbox instead of showing a raw dispatch id, and the page uses the palette', () => {
  const start = compose.indexOf("if (sendReceipt?.status === 'sent') {");
  const end = compose.indexOf('const send = ', start);
  assert.ok(start > 0 && end > start);
  const success = compose.slice(start, end);
  assert.doesNotMatch(success, /dispatchId/);
  assert.match(success, /Salió con /);
  assert.doesNotMatch(compose, /(emerald|amber)-\d/, 'no raw emerald or amber classes');
  assert.match(compose, /Código del intento: \{sendReceipt\.dispatchId\}/, 'an unconfirmed attempt keeps its code for support');
});
