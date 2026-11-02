import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASK_AFTER_MS, PENDING_CALL_MAX_AGE_MS, countsAsContacted, dialable, lastCallLine, needsCall, outcomeLabel, parsePendingCall,
  reachedPerson, shouldAskOutcome, telHref, whatsappHref, whatsappOpener,
} from './contact-calls';

const ID = '3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e';

test('a number is dialed with its country code when it has one, and a Chilean mobile without it gets +56', () => {
  assert.deepEqual(dialable('+56 9 1234 5678'), { tel: '+56912345678', international: true });
  assert.deepEqual(dialable('(+51) 987-654-321'), { tel: '+51987654321', international: true });
  assert.deepEqual(dialable('0056912345678'), { tel: '+56912345678', international: true });
  assert.deepEqual(dialable('9 1234 5678'), { tel: '+56912345678', international: true });
  assert.deepEqual(dialable('22 345 6789'), { tel: '223456789', international: false }, 'a landline without code is left to the phone');
  assert.equal(dialable('Not Found'), null);
  assert.equal(dialable(''), null);
  assert.equal(dialable('12'), null);
});

test('«Llamar» opens tel: and «WhatsApp» opens wa.me with the first line, only for international numbers', () => {
  assert.equal(telHref('+56 9 1234 5678'), 'tel:+56912345678');
  assert.equal(telHref(null), null);
  assert.equal(whatsappHref('+56 9 1234 5678', 'Hola Ana, ¿cómo estás?'), 'https://wa.me/56912345678?text=Hola%20Ana%2C%20%C2%BFc%C3%B3mo%20est%C3%A1s%3F');
  assert.equal(whatsappHref('+56912345678'), 'https://wa.me/56912345678');
  assert.equal(whatsappHref('22 345 6789', 'Hola'), null, 'WhatsApp needs the country');
});

test('the WhatsApp opener greets by first name and says who writes, and never invents a sender', () => {
  assert.equal(whatsappOpener({ contactName: 'Ana María Rojas', senderName: 'Diego Soto', senderCompany: 'GrupoExpro' }),
    'Hola Ana, soy Diego de GrupoExpro. ¿Tienes unos minutos esta semana para conversar?');
  assert.equal(whatsappOpener({ contactName: 'Ana Rojas', senderName: 'Diego Soto' }), 'Hola Ana, soy Diego. ¿Tienes unos minutos esta semana para conversar?');
  assert.equal(whatsappOpener({ contactName: 'Ana Rojas' }), 'Hola Ana, ¿cómo estás?');
  assert.equal(whatsappOpener({}), 'Hola, ¿cómo estás?');
});

test('the results read differently on WhatsApp, and a wrong number reaches nobody', () => {
  assert.equal(outcomeLabel('answered'), 'Contestó');
  assert.equal(outcomeLabel('answered', 'whatsapp'), 'Respondió');
  assert.equal(outcomeLabel('no_answer', 'whatsapp'), 'Sin respuesta aún');
  assert.equal(countsAsContacted('no_answer'), true);
  assert.equal(countsAsContacted('wrong_number'), false);
  assert.equal(countsAsContacted(null), false);
  assert.equal(reachedPerson('meeting'), true);
  assert.equal(reachedPerson('not_interested'), true);
  assert.equal(reachedPerson('no_answer'), false);
});

test('the pending call is read back while it is recent, and anything else is ignored', () => {
  const now = new Date('2026-11-02T15:00:00Z');
  const stored = JSON.stringify({ id: ID, name: 'Ana Rojas', company: 'Minera Sur', channel: 'call', startedAt: '2026-11-02T14:58:00Z',
    contact: { leadId: ' lead-1 ', providerPersonId: 'p1', email: 'ana@sur.cl' } });
  assert.deepEqual(parsePendingCall(stored, now), {
    id: ID, name: 'Ana Rojas', company: 'Minera Sur', channel: 'call', startedAt: '2026-11-02T14:58:00.000Z',
    contact: { leadId: 'lead-1', providerPersonId: 'p1', email: 'ana@sur.cl' },
  });
  const old = JSON.stringify({ id: ID, name: 'Ana', channel: 'call', startedAt: new Date(now.getTime() - PENDING_CALL_MAX_AGE_MS - 1).toISOString() });
  assert.equal(parsePendingCall(old, now), null, 'too old to ask about');
  assert.equal(parsePendingCall(JSON.stringify({ id: 'x', name: 'Ana', channel: 'call', startedAt: '2026-11-02T14:58:00Z' }), now), null);
  assert.equal(parsePendingCall(JSON.stringify({ id: ID, name: 'Ana', channel: 'fax', startedAt: '2026-11-02T14:58:00Z' }), now), null);
  assert.equal(parsePendingCall('{not json', now), null);
  assert.equal(parsePendingCall(null, now), null);
});

test('the question comes after a real absence, or on a later visit while the call waits', () => {
  const now = new Date('2026-11-02T15:00:00Z');
  const pending = { id: ID, name: 'Ana', company: null, channel: 'call' as const, startedAt: '2026-11-02T14:59:00Z' };
  assert.equal(shouldAskOutcome(pending, now, now.getTime() - ASK_AFTER_MS + 500), false, 'back too soon: a slip');
  assert.equal(shouldAskOutcome(pending, now, now.getTime() - ASK_AFTER_MS), true);
  assert.equal(shouldAskOutcome(pending, now, null), true, 'the page reloaded while they called');
  assert.equal(shouldAskOutcome({ ...pending, startedAt: '2026-11-02T14:59:59Z' }, now, null), false, 'brand new');
  assert.equal(shouldAskOutcome(null, now, 0), false);
});

test('«Por llamar» holds contacts with a mobile nobody called, or who did not answer', () => {
  assert.equal(needsCall(false, null), false);
  assert.equal(needsCall(true, null), true);
  assert.equal(needsCall(true, { outcome: 'no_answer', channel: 'call', at: '2026-11-02T10:00:00Z' }), true);
  assert.equal(needsCall(true, { outcome: null, channel: 'whatsapp', at: '2026-11-02T10:00:00Z' }), true);
  assert.equal(needsCall(true, { outcome: 'answered', channel: 'call', at: '2026-11-02T10:00:00Z' }), false);
  assert.equal(needsCall(true, { outcome: 'wrong_number', channel: 'call', at: '2026-11-02T10:00:00Z' }), false);
});

test('the last call reads as its result and when, in Chile\'s day', () => {
  const now = new Date('2026-11-02T15:00:00Z');
  assert.equal(lastCallLine({ outcome: 'answered', channel: 'call', at: '2026-11-02T13:00:00Z' }, now), 'Contestó · hoy');
  assert.equal(lastCallLine({ outcome: 'no_answer', channel: 'call', at: '2026-11-01T20:00:00Z' }, now), 'No contestó · ayer');
  assert.equal(lastCallLine({ outcome: 'answered', channel: 'whatsapp', at: '2026-10-28T15:00:00Z' }, now), 'Respondió · 28 oct');
  assert.equal(lastCallLine({ outcome: null, channel: 'whatsapp', at: '2026-11-02T14:00:00Z' }, now), 'WhatsApp sin resultado · hoy');
  // 01:00Z on 2 Nov is still 1 Nov in Chile (UTC−3).
  assert.equal(lastCallLine({ outcome: 'meeting', channel: 'call', at: '2026-11-02T01:00:00Z' }, now), 'Agendó reunión · ayer');
});
