import test from 'node:test';
import assert from 'node:assert/strict';
import { hasUnsubscribeContent, prepareOutboundEmail, validateOutboundEmail } from './email-outbound';

test('prepareOutboundEmail appends unsubscribe footer to html and text', () => {
  const prepared = prepareOutboundEmail({
    html: '<div>Hola mundo</div>',
    unsubscribeUrl: 'https://app.example.com/unsubscribe?x=1',
  });

  assert.equal(hasUnsubscribeContent(prepared.html), true);
  assert.equal(hasUnsubscribeContent(prepared.text), true);
  assert.match(prepared.html, /darte de baja/i);
  assert.match(prepared.text, /unsubscribe\?x=1/i);
});

test('prepareOutboundEmail does not duplicate unsubscribe footer', () => {
  const prepared = prepareOutboundEmail({
    html: '<div>Texto <a href="https://app.example.com/unsubscribe?x=1">darte de baja aquí</a></div>',
    unsubscribeUrl: 'https://app.example.com/unsubscribe?x=1',
  });

  const matches = prepared.html.match(/unsubscribe\?x=1/gi) || [];
  assert.equal(matches.length, 1);
});

test('prepareOutboundEmail converts plain text marked as html into structured html', () => {
  const prepared = prepareOutboundEmail({
    html: 'Hola Nicolas,\n\nEste correo no traia etiquetas HTML.',
    unsubscribeUrl: 'https://app.example.com/unsubscribe?x=1',
  });

  assert.match(prepared.html, /<div/i);
  assert.match(prepared.html, /<br>/i);
  assert.match(prepared.text, /Este correo no traia etiquetas HTML/i);
});

test('validateOutboundEmail requires recipient subject body and unsubscribe when requested', () => {
  const result = validateOutboundEmail({
    to: 'lead@example.com',
    subject: 'Hola',
    html: '<p>Hola</p>',
    requireUnsubscribe: true,
    unsubscribeUrl: 'https://app.example.com/unsubscribe?x=1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});
