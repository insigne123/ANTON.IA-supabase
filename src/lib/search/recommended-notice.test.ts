import assert from 'node:assert/strict';
import test from 'node:test';

import { recommendedNoticeKey, recommendedNoticeOf, recommendedNoticeText, recommendedNoticeTitle } from './recommended-notice';

const TODAY = '2026-11-19';
const item = (extra: Record<string, unknown> = {}) => ({ leadId: 'x', draft: { subject: 'Hola', body: 'Hola' }, ...extra });

test('the search page says which recommended contacts still wait for the person, from what «Hoy» reads', () => {
  // Several contacts of today, none touched.
  const fresh = recommendedNoticeOf({ drop: null, board: { id: 'drop-6', date: TODAY, items: [item(), item(), item()] } }, TODAY);
  assert.deepEqual(fresh, { id: 'drop-6', total: 3, left: 3, today: true });
  assert.equal(recommendedNoticeText(fresh!), 'Hoy elegimos 3 contactos para ti con tu cliente ideal, cada uno con su campaña ya escrita.');
  // One enriched with its campaign still to approve, one already going: two wait.
  const partly = recommendedNoticeOf({ board: { id: 'drop-6', date: TODAY, items: [item(), item({ savedLeadId: 'e-1' }), item({ savedLeadId: 'e-2', campaign: { id: 'c' } })] } }, TODAY);
  assert.deepEqual(partly, { id: 'drop-6', total: 3, left: 2, today: true });
  assert.equal(recommendedNoticeText(partly!), 'Te quedan 2 de tus 3 contactos recomendados por revisar.');
  // Yesterday's, still waiting: not «hoy».
  const earlier = recommendedNoticeOf({ board: { id: 'drop-5', date: '2026-11-18', items: [item(), item({ savedLeadId: 'e', campaign: { id: 'c' } })] } }, TODAY);
  assert.equal(recommendedNoticeText(earlier!), 'Te queda 1 de tus 2 contactos recomendados por revisar.');
  assert.equal(recommendedNoticeText({ id: 'd', total: 3, left: 3, today: false }), 'Te quedan 3 de tus 3 contactos recomendados por revisar.');
  // A team of one contact a day.
  const one = recommendedNoticeOf({ drop: { id: 'drop-1', dropDate: TODAY, total: 1, left: 1 } }, TODAY);
  assert.deepEqual(one, { id: 'drop-1', total: 1, left: 1, today: true });
  assert.equal(recommendedNoticeText(one!), 'Hoy elegimos un contacto para ti con tu cliente ideal, con su campaña ya escrita.');
  assert.equal(recommendedNoticeText({ id: 'd', total: 1, left: 1, today: false }), 'Tienes un contacto elegido para ti por revisar, con su campaña ya escrita.');
});

test('the headline says how many wait: today\'s whole, or what is left', () => {
  assert.equal(recommendedNoticeTitle({ id: 'd', total: 6, left: 6, today: true }), 'Tienes 6 contactos recomendados para hoy');
  assert.equal(recommendedNoticeTitle({ id: 'd', total: 1, left: 1, today: true }), 'Tienes un contacto recomendado para hoy');
  assert.equal(recommendedNoticeTitle({ id: 'd', total: 6, left: 2, today: true }), 'Te esperan 2 contactos recomendados');
  assert.equal(recommendedNoticeTitle({ id: 'd', total: 6, left: 6, today: false }), 'Te esperan 6 contactos recomendados');
  assert.equal(recommendedNoticeTitle({ id: 'd', total: 3, left: 1, today: false }), 'Te espera un contacto recomendado');
});

test('nothing left, nothing said; and an answer that cannot be read says nothing either', () => {
  assert.equal(recommendedNoticeOf({ board: { id: 'drop-6', date: TODAY, items: [item({ savedLeadId: 'e', campaign: { id: 'c' } })] } }, TODAY), null);
  assert.equal(recommendedNoticeOf({ drop: { id: 'drop-1', dropDate: TODAY, total: 5, left: 0 } }, TODAY), null);
  assert.equal(recommendedNoticeOf({ drop: null, board: null }, TODAY), null);
  for (const answer of [null, undefined, {}, { drop: { id: 7, total: 3, left: 3 } }, { board: { id: 'd', items: 'x' } }, { drop: { id: 'd', total: 'tres', left: 2 } }])
    assert.equal(recommendedNoticeOf(answer as any, TODAY), null);
  assert.deepEqual(recommendedNoticeOf({ drop: { id: 'd', dropDate: TODAY, total: 2, left: 9 } }, TODAY), { id: 'd', total: 2, left: 2, today: true }, 'never more left than there are');
  assert.equal(recommendedNoticeKey('drop-6'), 'anton:search-recommended:drop-6');
});
