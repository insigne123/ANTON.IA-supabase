import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bookingLinkForReply, bookingProvider, bookingSentence, insertBookingLine, normalizeBookingUrl, readBookingPreference,
} from './booking-link';

test('only a public https address is kept', () => {
  assert.equal(normalizeBookingUrl(' calendly.com/ana-soto/30min '), 'https://calendly.com/ana-soto/30min');
  assert.equal(normalizeBookingUrl('https://calendar.app.google/AbC123'), 'https://calendar.app.google/AbC123');
  assert.equal(normalizeBookingUrl('https://cal.com'), 'https://cal.com');
  for (const bad of ['', 'http://calendly.com/ana', 'javascript:alert(1)', 'https://user:pw@calendly.com/x', 'calendly', 'https://calendly.com/a b', null]) {
    assert.equal(normalizeBookingUrl(bad), null, String(bad));
  }
});

test('the service is named when it is a known one', () => {
  assert.equal(bookingProvider('https://calendly.com/ana'), 'Calendly');
  assert.equal(bookingProvider('https://calendar.app.google/x'), 'Google Calendar');
  assert.equal(bookingProvider('https://outlook.office365.com/owa/calendar/x/bookings/'), 'Microsoft Bookings');
  assert.equal(bookingProvider('https://meetings.hubspot.com/ana'), 'HubSpot');
  assert.equal(bookingProvider('https://mi-sitio.cl/agenda'), null);
});

test('the saved preference: a mode without a valid link is no preference, except «never»', () => {
  assert.deepEqual(readBookingPreference({ booking: { url: 'calendly.com/ana', mode: 'on_request' } }), { url: 'https://calendly.com/ana', mode: 'on_request' });
  assert.deepEqual(readBookingPreference({ booking: { url: 'https://calendly.com/ana', mode: 'raro' } }), { url: 'https://calendly.com/ana', mode: 'auto' });
  assert.deepEqual(readBookingPreference({ booking: { url: '', mode: 'never' } }), { url: '', mode: 'never' });
  assert.equal(readBookingPreference({ booking: { url: 'no es link', mode: 'auto' } }), null);
  assert.equal(readBookingPreference({ gmail: {} }), null);
  assert.equal(readBookingPreference(null), null);
});

test('the suggested reply carries the link only when it should', () => {
  const auto = { url: 'https://calendly.com/ana', mode: 'auto' as const };
  assert.equal(bookingLinkForReply(auto, 'https://otra.cl', 'meeting_request'), 'https://calendly.com/ana');
  assert.equal(bookingLinkForReply(auto, null, 'positive'), 'https://calendly.com/ana');
  assert.equal(bookingLinkForReply(auto, null, 'neutral'), '', 'a neutral answer is no invitation to book');
  assert.equal(bookingLinkForReply({ ...auto, mode: 'on_request' }, 'https://otra.cl', 'meeting_request'), '', 'only with the button');
  assert.equal(bookingLinkForReply({ url: '', mode: 'never' }, 'https://otra.cl', 'meeting_request'), '', '«never» wins over the workspace');
  assert.equal(bookingLinkForReply(null, ' https://otra.cl ', 'neutral'), 'https://otra.cl', 'without a setting, as before');
});

test('«Insertar mi agenda» adds one sentence at the end, once', () => {
  const url = 'https://calendly.com/ana';
  assert.equal(insertBookingLine('Hola Ana,\n\nGracias por tu respuesta.  \n', url), `Hola Ana,\n\nGracias por tu respuesta.\n\n${bookingSentence(url)}`);
  assert.equal(insertBookingLine(`Hola\n\n${bookingSentence(url)}`, url), `Hola\n\n${bookingSentence(url)}`);
  assert.equal(insertBookingLine('', url), bookingSentence(url));
});
