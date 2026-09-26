import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoworkEvent, CoworkRun } from './contracts';
import {
  coworkExpectsContinuation, coworkProposalView, coworkTurnArtifacts, coworkTurnProgress, describeCoworkObservation,
  groupCoworkThreads, coworkDateBucket, coworkConsultedSources, coworkLiveActivity, coworkTurnSuggestions,
} from './presentation';

const at = (minute: number) => `2026-09-24T12:${String(minute).padStart(2, '0')}:00Z`;
const run = (id: string, minute: number, extra: Partial<CoworkRun> = {}): CoworkRun =>
  ({ id, message: `Mensaje ${id}`, mode: 'approval', status: 'completed', created_at: at(minute), ...extra });
let sequence = 0;
const event = (kind: string, payload: Record<string, unknown> = {}): CoworkEvent => ({ sequence: ++sequence, kind, payload, created_at: at(sequence % 59) });

test('groups follow-ups and automatic continuations into one conversation', () => {
  const threads = groupCoworkThreads([
    run('c', 5, { parent_run_id: 'b', automatic: true, status: 'running' }),
    run('b', 4, { parent_run_id: 'a' }),
    run('x', 3),
    run('a', 1, { message: 'Revisa mis pendientes de hoy' }),
  ]);
  assert.equal(threads.length, 2);
  assert.deepEqual(threads[0], { id: 'c', rootId: 'a', title: 'Revisa mis pendientes de hoy', status: 'running', updatedAt: at(5), turns: 2 });
  assert.equal(threads[1].id, 'x');
});

test('a continuation whose root fell out of the list never shows the synthetic prompt', () => {
  const [thread] = groupCoworkThreads([run('c', 5, { parent_run_id: 'gone', automatic: true, message: 'Continúa a partir del efecto…' })]);
  assert.equal(thread.title, 'Continuación de un trabajo anterior');
});

test('proposal states follow approval, execution and discard events', () => {
  const request = event('approval.requested', { action: 'cowork.effect', kind: 'save_contact', label: 'Guardar contacto Ana (Sur)' });
  assert.equal(coworkProposalView({ status: 'waiting_approval' }, [request])?.state, 'pending');
  assert.equal(coworkProposalView({ status: 'waiting_approval' }, [request, event('effect.approved')])?.state, 'approved');
  assert.equal(coworkProposalView({ status: 'waiting_approval' }, [request, event('effect.approved'), event('effect.started')])?.state, 'running');
  assert.equal(coworkProposalView({ status: 'completed' }, [request, event('effect.approved'), event('effect.started'), event('effect.completed'), event('run.completed', { reply: 'Listo', document: null })])?.state, 'done');
  const discarded = coworkProposalView({ status: 'completed' }, [request, event('run.completed', { reply: 'Propuesta descartada.', document: null, applied: false })]);
  assert.equal(discarded?.state, 'discarded');
  assert.equal(discarded?.title, 'Guardar contacto');
  const search = event('approval.requested', { action: 'prospecting.search', criteria: { target: 'companies', limit: 10 } });
  assert.equal(coworkProposalView({ status: 'waiting_approval' }, [search, event('search.approved'), event('search.started')])?.state, 'running');
  assert.equal(coworkProposalView({ status: 'waiting_approval' }, [search])?.title, 'Buscar empresas');
});

test('continuations are expected after effects and searches but not after discards or budget stops', () => {
  assert.equal(coworkExpectsContinuation([event('effect.completed'), event('run.completed', { reply: 'ok', document: null })]), true);
  // A failed action is explained in the next turn instead of ending on the raw error.
  assert.equal(coworkExpectsContinuation([event('effect.failed', { kind: 'enrich_contact' }), event('run.completed', { reply: 'No se pudo.', document: null })]), true);
  assert.equal(coworkExpectsContinuation([event('search.started'), event('tool.completed', { action: 'prospecting.search' }), event('run.completed', { reply: 'ok', document: null })]), true);
  assert.equal(coworkExpectsContinuation([event('run.completed', { reply: 'Propuesta descartada.', document: null })]), false);
  assert.equal(coworkExpectsContinuation([event('effect.completed'), event('run.completed', { reply: 'ok', document: null }), event('thread.budget_exhausted')]), false);
});

test('artifacts come only from persisted results', () => {
  const events = [
    event('tool.completed', { action: 'leads.search', input: 'Ana', result: { scope: 'own_saved_contacts', items: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Ana' }] } }),
    event('tool.completed', { action: 'research.get_existing', result: { availability: 'available', research: { sources: [{ id: 's' }] } } }),
    event('artifact.created', { name: 'reporte.xlsx', size: 2048 }),
    event('run.completed', { reply: 'Hecho', document: { title: 'Informe', content: '# Informe' } }),
  ];
  const artifacts = coworkTurnArtifacts(run('r', 1), events);
  assert.deepEqual(artifacts.map(item => item.kind), ['document', 'contacts', 'sources', 'file']);
  assert.equal(artifacts[1].title, 'Contactos consultados');
  assert.equal(artifacts[1].kind === 'contacts' && artifacts[1].count, 1);
});

test('progress checklist reflects approval and failure honestly', () => {
  const request = event('approval.requested', { action: 'cowork.effect', kind: 'send_email', label: 'Enviar' });
  const waiting = coworkTurnProgress({ status: 'waiting_approval' }, [event('run.started'), event('tool.completed', { action: 'draft.get' }), request]);
  assert.deepEqual(waiting.map(step => [step.key, step.state]), [['received', 'done'], ['work', 'done'], ['approval', 'attention'], ['result', 'pending']]);
  const failed = coworkTurnProgress({ status: 'failed' }, [event('run.started'), event('run.failed', { message: 'x' })]);
  assert.equal(failed.at(-1)?.state, 'error');
});

test('observation lines carry the query and result size', () => {
  const line = describeCoworkObservation({ action: 'leads.search', input: 'Logística', result: { items: [{}, {}, {}] } });
  assert.equal(line.label, 'Buscó en tus contactos guardados');
  assert.equal(line.detail, '«Logística» · 3 resultados');
  assert.deepEqual(coworkConsultedSources([event('tool.completed', { action: 'crm.search' }), event('tool.completed', { action: 'crm.get_lead' }), event('tool.completed', { action: 'gmail.contact_history' })]), ['CRM', 'Gmail']);
  assert.equal(coworkLiveActivity({ status: 'running' }, [event('tool.completed', { action: 'metrics.rates' })]), 'Calculó tasas de 7 y 30 días. Analizando…');
});

test('date buckets', () => {
  const now = new Date(2026, 8, 24, 20, 0);
  assert.equal(coworkDateBucket(new Date(2026, 8, 24, 8).toISOString(), now), 'Hoy');
  assert.equal(coworkDateBucket(new Date(2026, 8, 23, 8).toISOString(), now), 'Ayer');
  assert.equal(coworkDateBucket(new Date(2026, 8, 19, 8).toISOString(), now), 'Últimos 7 días');
  assert.equal(coworkDateBucket(new Date(2026, 7, 1, 8).toISOString(), now), 'Anteriores');
});

test('quick replies come only from the finished answer and only in shapes that fit', () => {
  const completed = (payload: Record<string, unknown>) => [{ sequence: 1, kind: 'run.completed', payload, created_at: '2026-09-26T12:00:00Z' }];
  assert.deepEqual(coworkTurnSuggestions(completed({ reply: '¿Busco su correo?', document: null,
    suggestions: [{ label: ' Sí, búscalo ', message: 'Sí, busca el correo de Nehal' }, { label: 'x'.repeat(41), message: 'Muy larga' },
      { label: 'Sin mensaje' }, null, { label: 'Ver ficha', message: 'Muéstrame su ficha' }, { label: 'Otra', message: 'Otra' },
      { label: 'Cuarta', message: 'No entra' }] })),
  [{ label: 'Sí, búscalo', message: 'Sí, busca el correo de Nehal' }, { label: 'Ver ficha', message: 'Muéstrame su ficha' },
    { label: 'Otra', message: 'Otra' }]);
  // Turns saved before quick replies existed, and failed turns, have none.
  assert.deepEqual(coworkTurnSuggestions(completed({ reply: 'Listo.', document: null })), []);
  assert.deepEqual(coworkTurnSuggestions([{ sequence: 1, kind: 'run.failed', payload: { suggestions: [{ label: 'Sí', message: 'Sí' }] }, created_at: '2026-09-26T12:00:00Z' }]), []);
});
