import assert from 'node:assert/strict';
import test from 'node:test';
import { activeTouch, conversationStatus, conversationSummary, conversationTone, conversationUrl, groupConversations, matchesConversationView, needsReply, nextTouchFor, readConversationUrl } from './contacted-conversations';

const row = (overrides: Record<string, unknown> = {}) => ({ id: 'a', organization_id: 'org', user_id: 'user', email: 'ana@example.com', provider: 'gmail', status: 'replied', replied_at: '2026-09-22T10:00:00Z', ...overrides });

test('a reply needs attention until resolution or a later outbound message', () => {
  assert.equal(needsReply(row() as any), true);
  assert.equal(needsReply(row({ conversation_resolved_at: '2026-09-22T10:01:00Z' }) as any), false);
  assert.equal(needsReply(row({ conversation_outbound_at: '2026-09-22T10:01:00Z' }) as any), false);
});

test('conversation state distinguishes meeting requests, opt-outs and resolved records', () => {
  assert.equal(conversationStatus(row({ reply_intent: 'meeting_request' }) as any), 'Solicitó una reunión');
  assert.equal(conversationStatus(row({ reply_intent: 'unsubscribe' }) as any), 'No contactar · Baja solicitada');
  assert.equal(conversationStatus(row({ conversation_resolved_at: '2026-09-22T10:01:00Z' }) as any), 'Resuelto');
});

test('history groups only same owner/provider/recipient and keeps records', () => {
  const groups = groupConversations([row(), row({ id: 'b', replied_at: null, sent_at: '2026-09-21T10:00:00Z' }), row({ id: 'c', user_id: 'another' })] as any);
  assert.equal(groups.length, 2);
  assert.equal(groups.find(group => group.row.user_id === 'user')?.history.length, 2);
});

test('planned touch is active only when sequence remains active and step is unresolved', () => {
  const touch = { id: 'x', email: 'a', ownerId: 'u', campaignId: 'c', enrollmentId: 'e', kind: 'first_contact' as const, state: 'approved', dueAt: null, enrollmentState: 'active', draftId: null, versionId: null, index: 1, error: null, autoSend: false };
  assert.equal(activeTouch(touch), true);
  assert.equal(activeTouch({ ...touch, state: 'sent' }), false);
  assert.equal(activeTouch({ ...touch, enrollmentState: 'stopped' }), false);
});

test('each view counts what it shows: replies waiting for you, sent without answer, scheduled, everything', () => {
  const replied = row() as any;
  const waiting = row({ id: 'w', replied_at: null, sent_at: '2026-09-21T10:00:00Z', status: 'sent' }) as any;
  const scheduled = row({ id: 's', replied_at: null, status: 'scheduled' }) as any;
  assert.equal(matchesConversationView(replied, 'reply', false), true);
  assert.equal(matchesConversationView(waiting, 'reply', false), false);
  assert.equal(matchesConversationView(waiting, 'waiting', false), true);
  assert.equal(matchesConversationView(scheduled, 'scheduled', false), true);
  assert.equal(matchesConversationView(waiting, 'scheduled', true), true, 'an active follow-up counts as scheduled');
  assert.equal(matchesConversationView(waiting, 'all', false), true);
});

test('the address keeps the view and the open conversation', () => {
  assert.deepEqual(readConversationUrl('?view=waiting&c=abc'), { view: 'waiting', conversationId: 'abc' });
  assert.deepEqual(readConversationUrl('?view=nope'), { view: null, conversationId: null });
  assert.equal(conversationUrl('https://app.test/contacted?x=1', { view: 'scheduled', conversationId: 'k1' }), '/contacted?x=1&view=scheduled&c=k1');
  assert.equal(conversationUrl('https://app.test/contacted?view=all&c=k1', { conversationId: null }), '/contacted?view=all', 'closing keeps the view');
  assert.equal(conversationUrl('https://app.test/contacted?view=all', { view: 'reply' }), '/contacted', '«Por responder» is the default and needs no parameter');
});

test('statuses that need you stand out; closed ones stay quiet', () => {
  assert.equal(conversationTone('Por responder'), 'warning');
  assert.equal(conversationTone('Solicitó una reunión'), 'success');
  assert.equal(conversationTone('Envío fallido'), 'danger');
  assert.equal(conversationTone('No contactar · Baja solicitada'), 'danger');
  assert.equal(conversationTone('Programado'), 'info');
  assert.equal(conversationTone('Resuelto'), 'neutral');
});

const day = (value?: string | null) => (value ? value.slice(0, 10) : '—');
const touch = (overrides: Record<string, unknown> = {}) => ({ id: 't1', email: 'ana@example.com', ownerId: 'user', campaignId: 'c', enrollmentId: 'e',
  kind: 'first_contact', state: 'scheduled', dueAt: '2026-11-08T12:00:00Z', enrollmentState: 'active', draftId: 'd', versionId: 'v', index: 1,
  error: null, autoSend: true, ...overrides }) as any;

test('opening a conversation says where it stands and what comes next', () => {
  assert.equal(conversationSummary(row({ reply_summary: 'Le interesa y pide precios.' }) as any, null, day),
    'Respondió el 2026-09-22: Le interesa y pide precios. Te toca responder.');
  assert.equal(conversationSummary(row({ reply_intent: 'meeting_request' }) as any, null, day),
    'Pidió una reunión el 2026-09-22. Te toca proponer un horario.');
  const waiting = row({ status: 'sent', replied_at: undefined, sent_at: '2026-10-29T19:55:58Z' });
  assert.equal(conversationSummary(waiting as any, touch(), day),
    'Le escribiste el 2026-10-29. Sin respuesta todavía. Próximo seguimiento el 2026-11-08, sale solo.');
  assert.equal(conversationSummary(waiting as any, touch({ autoSend: false }), day),
    'Le escribiste el 2026-10-29. Sin respuesta todavía. Próximo seguimiento el 2026-11-08, lo envías tú.');
  assert.equal(conversationSummary(waiting as any, touch({ kind: 'bulk', campaignName: 'Hoteles' }), day),
    'Le escribiste el 2026-10-29. Sin respuesta todavía. Próximo seguimiento el 2026-11-08, de la campaña «Hoteles».');
  assert.equal(conversationSummary(waiting as any, null, day), 'Le escribiste el 2026-10-29. Sin respuesta todavía. No hay seguimientos programados.');
  assert.equal(conversationSummary(row({ reply_intent: 'negative' }) as any, null, day), 'Dijo que no le interesa. Sus seguimientos se detuvieron.');
  assert.equal(conversationSummary(row({ reply_intent: 'unsubscribe' }) as any, null, day), 'Pidió no recibir más correos. No se le vuelve a escribir.');
  assert.equal(conversationSummary(row({ status: 'failed', replied_at: undefined }) as any, null, day), 'El correo no llegó. Revisa la dirección antes de volver a escribir.');
});

test('the next follow-up is the earliest one still to go out, of this person and owner', () => {
  const r = row({ status: 'sent', replied_at: undefined });
  const later = touch({ id: 'later', dueAt: '2026-11-20T00:00:00Z' });
  const sooner = touch({ id: 'sooner', dueAt: '2026-11-10T00:00:00Z' });
  const sent = touch({ id: 'sent', dueAt: '2026-11-01T00:00:00Z', state: 'sent' });
  const other = touch({ id: 'other', dueAt: '2026-11-02T00:00:00Z', ownerId: 'someone-else' });
  assert.equal(nextTouchFor(r as any, [later, sent, other, sooner])?.id, 'sooner');
  assert.equal(nextTouchFor(r as any, [sent, other]), null);
});
