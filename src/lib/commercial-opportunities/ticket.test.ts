import assert from 'node:assert/strict';
import test from 'node:test';
import { TICKET_GUIDE, TICKET_PORTAL_URL, looksLikeTicket, ticketNeedsAction, ticketStatusLine, type TicketStatus } from './ticket';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const status = (patch: Partial<TicketStatus> = {}): TicketStatus => ({ connected: false, hint: null, verifiedAt: null, lastError: null, shared: false, ...patch });

test('a ticket is 36 letters and numbers with hyphens, spaces from the email are ignored', () => {
  assert.equal(looksLikeTicket('f8537a18-6766-4def-9e59-426b4fee2844'), true);
  assert.equal(looksLikeTicket(' F8537A18-6766-4DEF-9E59-426B4FEE2844 \n'), true);
  assert.equal(looksLikeTicket('F8537A18 6766 4DEF 9E59 426B4FEE2844'), false, 'hyphens are part of it');
  assert.equal(looksLikeTicket('mi ticket'), false);
});

test('the page asks for a ticket when there is none, or the one there is was refused', () => {
  assert.equal(ticketNeedsAction(undefined), true);
  assert.equal(ticketNeedsAction(status()), true);
  assert.equal(ticketNeedsAction(status({ connected: true, hint: '1A2B' })), false);
  assert.equal(ticketNeedsAction(status({ shared: true })), false, 'the shared ticket also searches');
  assert.equal(ticketNeedsAction(status({ connected: true, hint: '1A2B', lastError: 'Mercado Público rechazó este ticket.' })), true);
});

test('the status line shows the last four characters and when it was checked, never more', () => {
  assert.equal(ticketStatusLine(status({ connected: true, hint: '1A2B', verifiedAt: '2026-10-03T12:00:00Z' }), NOW), 'Tu ticket ••••1A2B · verificado hace 2 días');
  assert.equal(ticketStatusLine(status({ connected: true, hint: '1A2B', verifiedAt: '2026-10-05T11:59:50Z' }), NOW), 'Tu ticket ••••1A2B · verificado recién');
  assert.equal(ticketStatusLine(status({ shared: true }), NOW), 'Usas el ticket compartido de tu cuenta.');
  assert.equal(ticketStatusLine(status(), NOW), 'Aún no conectas tu ticket.');
});

test('the guide follows the official portal, checked on 5 Oct 2026', () => {
  assert.equal(TICKET_PORTAL_URL, 'https://www.chilecompra.cl/api/');
  assert.deepEqual([...TICKET_GUIDE.steps], ['Qué es el ticket', 'Pídelo en ChileCompra', 'Pégalo aquí']);
  const request = TICKET_GUIDE.request.join(' ');
  for (const step of [/«Pide tu ticket»/, /Clave Única/, /«Solicitud de Ticket»/, /nombre, RUT y correo/, /llega a tu correo/]) assert.match(request, step);
  const what = TICKET_GUIDE.what.map(item => `${item.lead} ${item.text}`).join(' ');
  assert.match(what, /Gratis y personal/);
  assert.match(what, /10\.000 consultas al día/);
  assert.match(what, /últimos 4 caracteres/);
});
