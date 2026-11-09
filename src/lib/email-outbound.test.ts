import test from 'node:test';
import assert from 'node:assert/strict';
import { hasUnsubscribeContent, prepareOutboundEmail, validateOutboundEmail, withoutRepeatedSignOff } from './email-outbound';

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

test('validateOutboundEmail blocks unresolved placeholders', () => {
  const result = validateOutboundEmail({
    to: 'lead@example.com',
    subject: 'Hola [Nombre del Lead]',
    text: 'Mi nombre es [Tu Nombre]',
    requireUnsubscribe: true,
    unsubscribeUrl: 'https://app.example.com/unsubscribe?x=1',
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /unresolved placeholders/i);
});

test('validateOutboundEmail blocks null-like content', () => {
  const result = validateOutboundEmail({
    to: 'lead@example.com',
    subject: 'null',
    text: 'undefined',
    requireUnsubscribe: true,
    unsubscribeUrl: 'https://app.example.com/unsubscribe?x=1',
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /missing email subject|missing email content/i);
});

test('validateOutboundEmail blocks empty html wrappers', () => {
  const result = validateOutboundEmail({
    to: 'lead@example.com',
    subject: 'Hola',
    html: '<div><br></div>',
    requireUnsubscribe: true,
    unsubscribeUrl: 'https://app.example.com/unsubscribe?x=1',
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /missing email content/i);
});

// Fictional people. The signature brought from Outlook (9 Nov 2026) and the closing block the writers put at the end of a body.
const OUTLOOK_SIGNATURE = { html: '<p><b>Camila Torres</b><br>Gerente comercial · Yago QA<br>+56 9 1234 5678</p>', text: 'Camila Torres\nGerente comercial · Yago QA\n+56 9 1234 5678' };

test('the body’s own name, title and company do not repeat above a signature that says them', () => {
  const body = 'Hola Ana,\n\n¿Cuántos ingresos revisan al mes en Retail Andino?\n\nSaludos,\nCamila Torres\nGerente comercial\nYago QA';
  const prepared = prepareOutboundEmail({ text: body, unsubscribeUrl: 'https://app.example/unsubscribe?t=1', signature: OUTLOOK_SIGNATURE });
  assert.equal(prepared.text.split('Camila Torres').length - 1, 1, prepared.text);
  assert.match(prepared.text, /Retail Andino\?\n\nSaludos,\n\n-- \nCamila Torres\nGerente comercial · Yago QA/);
  assert.equal(prepared.html.split('Camila Torres').length - 1, 1, 'the HTML too');
  // Prepared again (the senders do), it stays the same.
  assert.equal(prepareOutboundEmail({ html: prepared.html, text: prepared.text, unsubscribeUrl: 'https://app.example/unsubscribe?t=1', signature: OUTLOOK_SIGNATURE }).text, prepared.text);
});

test('a first name, a sign-off and content that only mentions the company stay; without a signature nothing changes', () => {
  assert.equal(withoutRepeatedSignOff('Gracias por tu tiempo.\n\nSaludos,\nCamila', OUTLOOK_SIGNATURE.text), 'Gracias por tu tiempo.\n\nSaludos,\nCamila');
  assert.equal(withoutRepeatedSignOff('Te escribo desde Yago QA.\n\nYago QA', OUTLOOK_SIGNATURE.text), 'Te escribo desde Yago QA.\n\nYago QA', 'no name, nothing goes');
  assert.equal(withoutRepeatedSignOff('Camila Torres', OUTLOOK_SIGNATURE.text), 'Camila Torres', 'never an empty body');
  const body = 'Hola Ana,\n\nSaludos,\nCamila Torres';
  assert.equal(prepareOutboundEmail({ text: body, unsubscribeUrl: 'https://app.example/u' }).text.startsWith(body), true);
  // An HTML body is the person's own layout: it is not touched.
  const html = '<p>Hola Ana,</p><p>Camila Torres<br>Yago QA</p>';
  assert.match(prepareOutboundEmail({ html, unsubscribeUrl: 'https://app.example/u', signature: OUTLOOK_SIGNATURE }).html, /<p>Camila Torres<br>Yago QA<\/p>/);
});

test('a template’s short name and company, and a signature with its own sign-off, read once', () => {
  const signature = 'Saludos cordiales,\nPedro Soto Rojas\nEjecutivo Comercial | GrupoExpro\npedro.soto@grupoexpro.cl';
  assert.equal(withoutRepeatedSignOff('¿Te parece conversarlo?\n\nSaludos,\nPedro Soto\nGrupoExpro\npedro.soto@grupoexpro.cl', signature), '¿Te parece conversarlo?');
  assert.equal(withoutRepeatedSignOff('¿Te parece conversarlo?\n\nPedro Soto, Ejecutivo Comercial', signature), '¿Te parece conversarlo?');
});
