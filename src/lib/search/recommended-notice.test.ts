import assert from 'node:assert/strict';
import test from 'node:test';

import { RECOMMENDED_ROWS, recommendedMoreLabel, recommendedNoticeKey, recommendedNoticeOf, recommendedNoticeTitle, recommendedResultsOf, recommendedResultsTitle } from './recommended-notice';

const TODAY = '2026-11-19';
const item = (extra: Record<string, unknown> = {}) => ({ leadId: 'x', draft: { subject: 'Hola', body: 'Hola' }, ...extra });

test('the search page says which recommended contacts still wait for the person, from what «Hoy» reads', () => {
  // Several contacts of today, none touched.
  const fresh = recommendedNoticeOf({ drop: null, board: { id: 'drop-6', date: TODAY, items: [item(), item(), item()] } }, TODAY);
  assert.deepEqual(fresh, { id: 'drop-6', total: 3, left: 3, today: true });
  // One enriched with its campaign still to approve, one already going: two wait.
  const partly = recommendedNoticeOf({ board: { id: 'drop-6', date: TODAY, items: [item(), item({ savedLeadId: 'e-1' }), item({ savedLeadId: 'e-2', campaign: { id: 'c' } })] } }, TODAY);
  assert.deepEqual(partly, { id: 'drop-6', total: 3, left: 2, today: true });
  // Yesterday's, still waiting: not «hoy».
  const earlier = recommendedNoticeOf({ board: { id: 'drop-5', date: '2026-11-18', items: [item(), item({ savedLeadId: 'e', campaign: { id: 'c' } })] } }, TODAY);
  assert.deepEqual(earlier, { id: 'drop-5', total: 2, left: 1, today: false });
  // A team of one contact a day.
  const one = recommendedNoticeOf({ drop: { id: 'drop-1', dropDate: TODAY, total: 1, left: 1 } }, TODAY);
  assert.deepEqual(one, { id: 'drop-1', total: 1, left: 1, today: true });
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

test('the contacts of several are shown as results: the whole drop, and which of them wait, in the order they came', () => {
  const row = (leadId: string, extra: Record<string, unknown> = {}) => ({ leadId, draft: { subject: 'Hola', body: 'Hola' }, ...extra });
  const results = recommendedResultsOf({ board: { id: 'drop-6', date: TODAY, items: [row('a'), row('b', { savedLeadId: 'e-b' }), row('c', { savedLeadId: 'e-c', campaign: { id: 'c' } }), row('d'), null, { name: 'sin id' }] } }, TODAY);
  assert.deepEqual([results?.id, results?.today, results?.items.map(item => item.leadId), results?.waiting], ['drop-6', true, ['a', 'b', 'c', 'd'], ['a', 'b', 'd']]);
  assert.equal(recommendedResultsOf({ board: { id: 'drop-5', date: '2026-11-18', items: [row('a')] } }, TODAY)?.today, false, 'earlier ones still waiting');
  // Nothing left, a drop of one contact (said in a line by recommendedNoticeOf), or an answer that cannot be read: no rows.
  assert.equal(recommendedResultsOf({ board: { id: 'drop-6', date: TODAY, items: [row('c', { savedLeadId: 'e', campaign: { id: 'c' } })] } }, TODAY), null);
  assert.equal(recommendedResultsOf({ drop: { id: 'drop-1', dropDate: TODAY, total: 1, left: 1 } }, TODAY), null);
  for (const latest of [null, undefined, {}, { board: { id: 7, items: [] } }, { board: { id: 'x', items: 'no' } }]) assert.equal(recommendedResultsOf(latest as never, TODAY), null);
});

test('the section says what is left as the person works through it, and offers the rest of its rows', () => {
  assert.equal(RECOMMENDED_ROWS, 3);
  assert.equal(recommendedResultsTitle({ total: 6, left: 6, today: true }), 'Tienes 6 contactos recomendados para hoy');
  assert.equal(recommendedResultsTitle({ total: 6, left: 4, today: true }), 'Te esperan 4 contactos recomendados');
  assert.equal(recommendedResultsTitle({ total: 6, left: 0, today: true }), 'Listo: ya revisaste tus contactos recomendados');
  assert.deepEqual([recommendedMoreLabel(6, false), recommendedMoreLabel(6, true)], ['Ver los 6', 'Ver menos']);
});
