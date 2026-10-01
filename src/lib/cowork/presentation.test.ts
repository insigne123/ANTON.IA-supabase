import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoworkEvent, CoworkRun } from './contracts';
import {
  coworkExpectsContinuation, coworkProposalView, coworkTurnArtifacts, coworkTurnProgress, describeCoworkObservation,
  groupCoworkThreads, coworkDateBucket, coworkConsultedSources, coworkLiveActivity, coworkTurnOutput, coworkTurnSuggestions, coworkTurnChoices,
  coworkTurnBlocks, coworkPlanProgress, coworkPlanStepLine, coworkReadEvents, coworkReadFinding, coworkFindingText, coworkAnswerChanged,
  coworkCardStatuses, coworkTurnFindings, coworkProposalOutcome, coworkProposalTimeline, coworkProposalLink,
  coworkAgentRows, coworkAgentLine, coworkDraftReview, coworkAnswerReview, coworkHeldAnswerCopy, coworkEffectCopy,
} from './presentation';
import { coworkDraftSteps, coworkVersionMessage } from './blocks';
import { COWORK_AGENT_ACTION, coworkIsAssistantEvent, coworkPlanSteps } from './contracts';

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
  // The options of a closing question come from the finished answer too; turns saved before them have none.
  assert.deepEqual(coworkTurnChoices(completed({ reply: '¿Qué segmentos?', document: null, question: '¿Qué segmentos?',
    choices: { multiple: true, options: ['RR. HH.', 'Retail'] } })), { multiple: true, options: ['RR. HH.', 'Retail'] });
  assert.equal(coworkTurnChoices(completed({ reply: 'Listo.', document: null })), null);
});

test('the closing question of a finished turn reads apart; older turns keep it in the reply', () => {
  const completed = (payload: Record<string, unknown>) => [{ sequence: 1, kind: 'run.completed', payload, created_at: '2026-09-26T12:00:00Z' }];
  assert.deepEqual(coworkTurnOutput(completed({ reply: 'Listo.\n\n¿Creo la campaña?', document: null, question: '¿Creo la campaña?' })),
    { reply: 'Listo.\n\n¿Creo la campaña?', document: null, question: '¿Creo la campaña?' });
  assert.equal(coworkTurnOutput(completed({ reply: 'Listo.\n¿Creo la campaña?', document: null }))?.question, null);
});

test('cards of a finished turn open in the panel, except figures, which stay in the chat', () => {
  const events = [{ sequence: 1, kind: 'run.completed', created_at: '2026-09-26T12:00:00Z', payload: { reply: 'Listo.', document: null, blocks: [
    { type: 'metrics', title: 'Semana', period: null, items: [{ label: 'Envíos', value: '1', detail: null }] },
    { type: 'email_draft', title: 'Correo', to: null, subject: 'Hola', body: 'Hola,\nNicolás' },
    { type: 'table', title: 'Sin forma', rows: 'no es una tabla' },
  ] } }];
  // A malformed card is skipped, never the whole answer.
  assert.deepEqual(coworkTurnBlocks(events).map(block => block.type), ['metrics', 'email_draft']);
  const artifacts = coworkTurnArtifacts(run('r', 1), events);
  assert.deepEqual(artifacts.map(item => [item.kind, item.id, item.title]), [['block', 'r:block:1', 'Correo']]);
  // Turns saved before cards existed have none.
  assert.deepEqual(coworkTurnBlocks([{ sequence: 1, kind: 'run.completed', created_at: '2026-09-26T12:00:00Z', payload: { reply: 'Listo.', document: null } }]), []);
});

test('the plan of a turn checks off each step as its read completes, and the last one with the answer', () => {
  const plan = event('tool.completed', { action: 'assistant.plan', input: '', result: { steps: [
    { label: 'Reviso tus contactos', read: 'leads.search' },
    { label: 'Veo qué correos ya enviaste', read: 'contacted.search' },
    { label: 'Redacto el correo', read: null },
  ] } });
  const leads = event('tool.completed', { action: 'leads.search', input: 'RRHH', result: {} });
  const sent = event('tool.completed', { action: 'contacted.search', input: '', result: {} });
  const states = (status: CoworkRun['status'], events: CoworkEvent[]) => coworkPlanProgress({ status }, events)?.map(step => step.state);
  // It is never a read of its own.
  assert.deepEqual(coworkReadEvents([plan, leads]), [leads]);
  assert.deepEqual(states('running', [plan]), ['current', 'pending', 'pending']);
  assert.deepEqual(states('running', [plan, leads]), ['done', 'current', 'pending']);
  assert.deepEqual(states('running', [plan, leads, sent]), ['done', 'done', 'current']);
  assert.deepEqual(states('completed', [plan, leads, sent]), ['done', 'done', 'done']);
  // A read the model dropped reads as skipped, never done.
  assert.deepEqual(states('running', [plan, sent]), ['skipped', 'done', 'current']);
  assert.deepEqual(states('completed', [plan, leads]), ['done', 'skipped', 'done']);
  // A proposal ends the plan too; a failure leaves the rest pending, with nothing in progress.
  assert.deepEqual(states('waiting_approval', [plan, leads, sent]), ['done', 'done', 'done']);
  assert.deepEqual(states('failed', [plan, leads]), ['done', 'pending', 'pending']);
  assert.equal(coworkPlanProgress({ status: 'running' }, [leads]), null);
  // The line above the plan never says it is still understanding the request.
  assert.equal(coworkLiveActivity({ status: 'running' }, [plan]), 'Plan listo. Empezando…');
  assert.equal(coworkLiveActivity({ status: 'running' }, []), 'Entendiendo tu solicitud…');
  // Each done step says what its read found; the others found nothing yet.
  const counted = event('tool.completed', { action: 'leads.search', input: 'RRHH', result: { items: [{}, {}, {}, {}] } });
  assert.deepEqual(coworkPlanProgress({ status: 'running' }, [plan, counted])?.map(step => step.found), [{ count: 4, label: 'contactos' }, null, null]);
  // Who does each step (G4): the sent emails are the Researcher's; finding the contacts and answering are Cowork's own.
  const progress = coworkPlanProgress({ status: 'running' }, [plan, leads])!;
  assert.deepEqual(progress.map(step => step.agent?.name ?? null), [null, 'Investigadora', null]);
  assert.equal(coworkPlanStepLine(progress[1]), 'Investigadora · veo qué correos ya enviaste');
  assert.equal(coworkPlanStepLine(progress[0]), 'Reviso tus contactos');
  assert.equal(describeCoworkObservation({ action: 'metrics.rates', input: '', result: {} }).agent?.name, 'Analista');
  assert.equal(describeCoworkObservation({ action: 'leads.search', input: '', result: {} }).agent, null);
  // The side panel names the step in progress.
  assert.equal(coworkTurnProgress({ status: 'running' }, [plan, leads]).find(step => step.key === 'work')?.detail, 'Paso 2 de 3: Investigadora · veo qué correos ya enviaste');
  assert.equal(coworkTurnProgress({ status: 'completed' }, [plan, leads, sent]).find(step => step.key === 'work')?.detail, '2 consultas');
});

test('what a read found reads as a count and what it counts, or a short phrase', () => {
  const found = (action: string, result: unknown) => coworkReadFinding({ action, result });
  assert.deepEqual(found('leads.search', { items: [{}] }), { count: 1, label: 'contacto' });
  assert.deepEqual(found('contacted.search', { items: [] }), { count: null, label: 'sin envíos' });
  assert.deepEqual(found('campaigns.list', { campaigns: [{}, {}] }), { count: 2, label: 'campañas' });
  assert.deepEqual(found('crm.get_lead', { records: [{}, {}, {}] }), { count: 3, label: 'resultados' });
  assert.deepEqual(found('files.read', { found: true, kind: 'table', totalRows: 8 }), { count: 8, label: 'filas' });
  assert.deepEqual(found('files.read', { found: false }), { count: null, label: 'no lo encontró' });
  assert.deepEqual(found('files.read', { found: true, kind: 'unreadable' }), { count: null, label: 'no se pudo leer' });
  assert.deepEqual(found('research.get_existing', { availability: 'available', research: { sources: [{}, {}] } }), { count: 2, label: 'fuentes' });
  assert.deepEqual(found('research.get_existing', { availability: 'missing' }), { count: null, label: 'sin informe' });
  // Figures without a list (metrics, quotas) have nothing to count.
  assert.equal(found('metrics.overview', { sent: 12, replies: 1 }), null);
  assert.equal(coworkFindingText({ count: 4, label: 'contactos' }), '4 contactos');
  assert.equal(coworkFindingText({ count: null, label: 'sin envíos' }), 'sin envíos');
});

test('a stored plan is read only in the shape the worker writes', () => {
  const stored = (steps: unknown) => coworkPlanSteps({ action: 'assistant.plan', result: { steps } });
  assert.deepEqual(stored([{ label: 'Reviso tus contactos', read: 'leads.search' }, { label: 'Redacto', read: null }]),
    [{ label: 'Reviso tus contactos', read: 'leads.search' }, { label: 'Redacto', read: null }]);
  // One step is not a plan; odd reads read as none; oversized labels are dropped.
  assert.equal(stored([{ label: 'Reviso', read: null }]), null);
  assert.deepEqual(stored([{ label: 'Uno', read: 'DROP TABLE' }, { label: 'x'.repeat(81), read: null }, { label: 'Dos', read: 7 }]),
    [{ label: 'Uno', read: null }, { label: 'Dos', read: null }]);
  assert.equal(coworkPlanSteps({ action: 'assistant.note', result: { steps: [{ label: 'a', read: null }, { label: 'b', read: null }] } }), null);
  assert.equal(coworkPlanSteps(null), null);
  // History and resumed reviews skip what the assistant wrote about itself.
  assert.equal(coworkIsAssistantEvent({ action: 'assistant.plan' }), true);
  assert.equal(coworkIsAssistantEvent({ action: 'assistant.note' }), true);
  assert.equal(coworkIsAssistantEvent({ action: 'leads.search' }), false);
  assert.equal(coworkIsAssistantEvent(null), false);
});

test('the final answer counts as adjusted only when a word shown changed or went away', () => {
  const shown = 'Tus 3 contactos de RR. HH. tienen correo.';
  assert.equal(coworkAnswerChanged(shown, shown), false);
  // Spacing, case, punctuation and the closing question added at the end do not count.
  assert.equal(coworkAnswerChanged(shown, 'Tus 3 contactos de RR.HH. tienen  correo:\n\n¿Creo la campaña?'), false);
  assert.equal(coworkAnswerChanged('TUS 3 contactos', 'tus 3 contactos'), false);
  assert.equal(coworkAnswerChanged(shown, 'Tus 3 contactos de RR. HH. tienen correo verificado.'), false);
  // A changed or dropped word does.
  assert.equal(coworkAnswerChanged(shown, 'Tus 4 contactos de RR. HH. tienen correo.'), true);
  assert.equal(coworkAnswerChanged(shown, 'Tus 3 contactos tienen correo.'), true);
  assert.equal(coworkAnswerChanged(shown, 'Tus 3 contactos'), true);
});

test('a turn names what its reads found, once each and in order', () => {
  const events = [
    event('tool.completed', { action: 'assistant.plan', input: '', result: { steps: [{ label: 'Reviso', read: 'leads.search' }] } }),
    event('tool.completed', { action: 'leads.search', input: 'RRHH', result: { items: [{ lead_id: 'a' }, { lead_id: 'b' }, { lead_id: 'c' }] } }),
    event('tool.completed', { action: 'contacted.search', input: '', result: { items: [] } }),
    event('tool.completed', { action: 'leads.search', input: 'Otra', result: { items: [{ lead_id: 'x' }, { lead_id: 'y' }, { lead_id: 'z' }] } }),
    event('tool.completed', { action: 'metrics.overview', input: '', result: { sent: 4 } }),
  ];
  assert.deepEqual(coworkTurnFindings(events).map(coworkFindingText), ['3 contactos', 'sin envíos']);
  assert.deepEqual(coworkTurnFindings([]), []);
});

test('each email or sequence card knows what happened to it later in the thread', () => {
  const secuencia = { type: 'sequence' as const, title: 'Secuencia AXIS', steps: [{ day: 1, subject: 'Hola', body: 'Uno' }, { day: 4, subject: 'Sigo', body: 'Dos' }] };
  const correo = { type: 'email_draft' as const, title: 'Correo a Felipe', to: ['Felipe'], subject: 'Hola', body: 'Hola Felipe' };
  const answer = (blocks: unknown[]) => [event('run.completed', { reply: 'Listo.', document: null, blocks })];
  const first = { run: run('a', 1), events: answer([secuencia, correo]) };
  const campaign = coworkVersionMessage(secuencia, coworkDraftSteps(secuencia), 'campaign', false);
  const request = event('approval.requested', { action: 'cowork.effect', kind: 'campaign_create', label: 'Crear campaña' });
  // Nobody used them yet: no status, the card reads as a draft nobody sent.
  assert.equal(coworkCardStatuses([first]).size, 0);
  // Asked for a campaign: preparing, then waiting for approval, then created.
  assert.deepEqual(coworkCardStatuses([first, { run: run('b', 2, { message: campaign, status: 'running' }), events: [] }]).get('a:block:0'),
    { label: 'Preparando la campaña…', tone: 'accent' });
  assert.deepEqual(coworkCardStatuses([first, { run: run('b', 2, { message: campaign, status: 'waiting_approval' }), events: [request] }]).get('a:block:0'),
    { label: 'Campaña propuesta · espera tu aprobación', tone: 'attention' });
  const created = coworkCardStatuses([first, { run: run('b', 2, { message: campaign }), events: [request, event('effect.approved'), event('effect.started'), event('effect.completed')] }]);
  assert.deepEqual(created.get('a:block:0'), { label: 'Campaña creada · guardada sin enviar', tone: 'success' });
  assert.equal(created.has('a:block:1'), false);
  assert.deepEqual(coworkCardStatuses([first, { run: run('b', 2, { message: campaign }), events: [request, event('run.completed', { reply: 'Descartada.', document: null })] }]).get('a:block:0'),
    { label: 'Campaña descartada · no se creó', tone: 'neutral' });
  // A finished turn that proposed nothing leaves the card as it was.
  assert.equal(coworkCardStatuses([first, { run: run('b', 2, { message: campaign }), events: answer([]) }]).size, 0);
  // «Usar esta versión» keeps the text; an edited one says so.
  const edited = coworkDraftSteps(correo).map(step => ({ ...step, body: 'Hola Felipe, corto.' }));
  assert.deepEqual(coworkCardStatuses([first, { run: run('b', 2, { message: coworkVersionMessage(correo, edited, 'use', true) }), events: answer([]) }]).get('a:block:1'),
    { label: 'Tu versión, elegida · no se ha enviado', tone: 'accent' });
  // Two cards with the same title: the later one is the one used.
  const again = { run: run('c', 3), events: answer([secuencia]) };
  const statuses = coworkCardStatuses([first, again, { run: run('d', 4, { message: campaign, status: 'running' }), events: [] }]);
  assert.equal(statuses.has('a:block:0'), false);
  assert.equal(statuses.get('c:block:0')?.label, 'Preparando la campaña…');
  // A typed message that only quotes a title is not a use of the card.
  assert.equal(coworkCardStatuses([first, { run: run('b', 2, { message: 'Crea una campaña con «Secuencia AXIS»' }), events: [request] }]).size, 0);
});

test('an approval says what happens and what does not, and where the proposal stands', () => {
  const effect = (kind: string) => ({ type: 'effect' as const, payload: { kind } });
  assert.deepEqual(coworkProposalOutcome(effect('campaign_create')), { happens: 'Se guarda la campaña con el correo de cada persona, sin enviar (pausada).', not: 'No sale nada hasta que la actives, y activarla pide otra aprobación.' });
  assert.match(coworkProposalOutcome({ type: 'search', payload: { criteria: { target: 'companies', limit: 10 } } }).happens, /hasta 10 empresas/);
  assert.match(coworkProposalOutcome({ type: 'search', payload: { criteria: { limit: 5 } } }).happens, /hasta 5 contactos nuevos/);
  assert.match(coworkProposalOutcome({ type: 'note', payload: { leadName: 'Ana Soto' } }).happens, /nota de Ana Soto/);
  // Every kind of action has its own sentences; an unknown one still reads plainly.
  for (const kind of ['save_contact', 'start_research', 'enrich_contact', 'request_draft', 'send_email', 'campaign_activate', 'campaign_pause', 'code_execute',
    'profile_update', 'saved_search_create', 'saved_search_update', 'saved_search_delete', 'campaign_stop_v2', 'crm_update_record', 'campaign_prepare_draft_v2',
    'crm_assign_lead', 'exception_resolve', 'mission_control', 'message_context_update', 'enrich_batch', 'campaign_schedule_batch', 'linkedin_invite', 'linkedin_message', 'contacts_import', 'reply_thread', 'linkedin_invite_batch', 'linkedin_message_batch']) {
    assert.notEqual(coworkProposalOutcome(effect(kind)).happens, 'Se ejecuta la acción propuesta.', kind);
  }
  assert.equal(coworkProposalOutcome(effect('otra_cosa')).not, 'No se hace nada más sin tu aprobación.');
  const states = (state: Parameters<typeof coworkProposalTimeline>[0]) => coworkProposalTimeline(state).map(step => step.state).join(' ');
  assert.deepEqual(coworkProposalTimeline('pending').map(step => step.label), ['Propuesta', 'Tu aprobación', 'Ejecución', 'Resultado']);
  assert.equal(states('pending'), 'done current pending pending');
  assert.equal(states('running'), 'done done current pending');
  assert.equal(states('done'), 'done done done done');
  assert.equal(states('discarded'), 'done skipped skipped skipped');
  assert.equal(states('failed'), 'done done failed skipped');
  // Only a finished action with a page of its own links there.
  assert.deepEqual(coworkProposalLink({ ...effect('campaign_create'), state: 'done' }), { href: '/campaigns', label: 'Ver campañas' });
  assert.equal(coworkProposalLink({ ...effect('campaign_create'), state: 'running' }), null);
  assert.equal(coworkProposalLink({ ...effect('code_execute'), state: 'done' }), null);
  assert.deepEqual(coworkProposalLink({ ...effect('contacts_import'), state: 'done' }), { href: '/saved/leads', label: 'Ver tus contactos' });
  // A reply sent in a thread is seen where the conversation lives, and the card says it goes out only once approved.
  assert.deepEqual(coworkProposalLink({ ...effect('reply_thread'), state: 'done' }), { href: '/contacted', label: 'Ver en Contactados' });
  assert.equal(coworkProposalLink({ ...effect('reply_thread'), state: 'pending' }), null);
  assert.equal(coworkEffectCopy('reply_thread').title, 'Responder en el hilo');
  // A batch says it queues for those left on the list and that nothing goes until the extension runs it.
  for (const kind of ['linkedin_invite_batch', 'linkedin_message_batch']) {
    assert.match(coworkProposalOutcome(effect(kind)).happens, /cada persona que dejes en la lista/);
    assert.match(coworkProposalOutcome(effect(kind)).not, /No sale nada hasta que lo ejecutes desde la extensión; a quien quites/);
    assert.equal(coworkEffectCopy(kind).icon, 'linkedin');
    assert.match(coworkEffectCopy(kind).help, /quita a quien no quieras antes de aprobar/);
    assert.equal(coworkProposalLink({ ...effect(kind), state: 'done' }), null);
  }
  assert.match(coworkProposalOutcome(effect('reply_thread')).not, /no sale hasta que la apruebes/);
});

test('the Writer and the Reviewer read as one row each, at their latest step, and say how the review ended', () => {
  const agent = (result: Record<string, unknown>) => event('tool.completed', { action: COWORK_AGENT_ACTION, input: '', result });
  const read = event('tool.completed', { action: 'leads.search', input: 'RRHH', result: { scope: 'own_saved_contacts', items: [] } });
  const writing = agent({ agent: 'writer', state: 'working', label: 'Escribiendo 3 correos' });
  const written = agent({ agent: 'writer', state: 'done', label: 'Escribió 3 correos' });
  const reviewing = agent({ agent: 'reviewer', state: 'working', label: 'Revisando 3 correos' });
  const fixed = agent({ agent: 'reviewer', state: 'done', label: '1 ajuste', outcome: 'fixed', changes: ['sin «gratis»'] });
  // What the agents did is not a read: it never counts as a query.
  assert.deepEqual(coworkReadEvents([read, writing, written]), [read]);
  assert.equal(coworkLiveActivity({ status: 'running' }, [read, writing]), 'Redactora · escribiendo 3 correos…');
  assert.equal(coworkLiveActivity({ status: 'running' }, [read, writing, written, reviewing]), 'Revisora · revisando 3 correos…');
  const rows = coworkAgentRows([read, writing, written, reviewing, fixed]);
  assert.deepEqual(rows.map(row => `${row.name}:${row.state}:${row.label}`), ['Redactora:done:Escribió 3 correos', 'Revisora:done:1 ajuste']);
  assert.equal(coworkAgentLine(rows[1]), 'Revisora · 1 ajuste');
  assert.deepEqual(coworkDraftReview([writing, written, reviewing, fixed]), { outcome: 'fixed', changes: ['sin «gratis»'] });
  assert.deepEqual(coworkDraftReview([written, agent({ agent: 'reviewer', state: 'done', label: 'Sin ajustes', outcome: 'clean', changes: [] })]),
    { outcome: 'clean', changes: [] });
  // Not reviewed: no time, a failed review, or a review still running.
  assert.equal(coworkDraftReview([written]), null);
  assert.equal(coworkDraftReview([written, agent({ agent: 'reviewer', state: 'done', label: 'No alcanzó a revisar', outcome: 'skipped', changes: [] })]), null);
  assert.equal(coworkDraftReview([written, reviewing]), null);
  // A malformed step is ignored.
  assert.deepEqual(coworkAgentRows([agent({ agent: 'boss', state: 'working', label: 'x' }), agent({ agent: 'writer', state: 'done', label: ' ' })]), []);
});

test('Jev watching in the shadow leaves a step the page does not know: no row, no activity line, no read, and the judge\'s rows stay as they were', () => {
  const agent = (result: Record<string, unknown>) => event('tool.completed', { action: COWORK_AGENT_ACTION, input: '', result });
  const read = event('tool.completed', { action: 'leads.search', input: 'RRHH', result: { scope: 'own_saved_contacts', items: [] } });
  const judging = agent({ agent: 'judge', state: 'working', label: 'Revisando la respuesta' });
  const shadow = agent({ agent: 'jev', state: 'done', label: 'Jev en sombra', changes: [], detail: { engine: 'jev', shadow: true, status: 'ok', fired: ['offers_free_read'] } });
  const clean = agent({ agent: 'judge', state: 'done', label: 'Sin ajustes', outcome: 'clean', changes: [] });
  assert.deepEqual(coworkAgentRows([read, judging, shadow, clean]).map(row => `${row.name}:${row.state}:${row.label}`), ['Revisora:done:Sin ajustes']);
  assert.deepEqual(coworkAgentRows([read, shadow]), []);
  assert.deepEqual(coworkReadEvents([read, shadow]), [read], 'the shadow is not a query');
  // Alone (the judge off), it is not what Cowork is doing: the line stays on the last thing the person can see.
  assert.equal(coworkLiveActivity({ status: 'running' }, [read, shadow]), coworkLiveActivity({ status: 'running' }, [read]));
});

test('the judge reads the answer as the Reviewer, and says whether it stood or was fixed', () => {
  const agent = (result: Record<string, unknown>) => event('tool.completed', { action: COWORK_AGENT_ACTION, input: '', result });
  const read = event('tool.completed', { action: 'contacted.search', input: '', result: { items: [] } });
  const reviewing = agent({ agent: 'judge', state: 'working', label: 'Revisando la respuesta' });
  const adjusting = agent({ agent: 'judge', state: 'working', label: 'Ajustando la respuesta' });
  assert.equal(coworkLiveActivity({ status: 'running' }, [read, reviewing]), 'Revisora · revisando la respuesta…');
  // The correction's read shows as a read; the row stays at its latest step.
  const reread = event('tool.completed', { action: 'contacted.search', input: '', result: { items: [] } });
  assert.equal(coworkLiveActivity({ status: 'running' }, [read, reviewing, adjusting, reread]), 'Revisó el historial de envíos. Analizando…');
  const done = (outcome: string, label: string) => agent({ agent: 'judge', state: 'done', label, outcome, changes: [] });
  assert.deepEqual(coworkAgentRows([reviewing, adjusting, done('fixed', 'Ajustó la respuesta')]).map(row => `${row.name}:${row.state}:${row.label}`),
    ['Revisora:done:Ajustó la respuesta']);
  assert.equal(coworkAnswerReview(coworkAgentRows([reviewing, done('clean', 'Sin ajustes')])), 'clean');
  assert.equal(coworkAnswerReview(coworkAgentRows([reviewing, adjusting, done('fixed', 'Ajustó la respuesta')])), 'fixed');
  // Not reviewed: still at work, no time, or the call failed. A review of the emails is not a review of the answer.
  assert.equal(coworkAnswerReview(coworkAgentRows([reviewing])), null);
  assert.equal(coworkAnswerReview(coworkAgentRows([reviewing, done('skipped', 'No alcanzó a revisar')])), null);
  assert.equal(coworkAnswerReview(coworkAgentRows([agent({ agent: 'reviewer', state: 'done', label: 'Sin ajustes', outcome: 'clean', changes: [] })])), null);
  // The judge does not change what the cards say about their review.
  assert.equal(coworkDraftReview([reviewing, done('clean', 'Sin ajustes')]), null);
});

test('a held answer says which phase it is in, about the emails when it carries them', () => {
  assert.equal(coworkHeldAnswerCopy('writing', []), 'Escribiendo la respuesta');
  assert.equal(coworkHeldAnswerCopy(null, [{ type: 'table' }]), 'Escribiendo la respuesta');
  // While it is reviewed, the line says why no text shows yet.
  assert.equal(coworkHeldAnswerCopy('reviewing', []), 'Revisando la respuesta antes de mostrártela');
  assert.equal(coworkHeldAnswerCopy('adjusting', []), 'Ajustando la respuesta tras revisarla');
  assert.equal(coworkHeldAnswerCopy('writing', [{ type: 'email_draft' }]), 'Escribiendo el correo');
  assert.equal(coworkHeldAnswerCopy('reviewing', [{ type: 'email_draft' }, { type: 'table' }]), 'Revisando el correo antes de mostrártelo');
  assert.equal(coworkHeldAnswerCopy('reviewing', [{ type: 'sequence' }]), 'Revisando los correos antes de mostrártelos');
  assert.equal(coworkHeldAnswerCopy('adjusting', [{ type: 'email_draft' }, { type: 'email_draft' }]), 'Ajustando los correos tras revisarlos');
});
