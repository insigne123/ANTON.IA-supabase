import { collectCoworkLeadRows } from './lead-export';
import { coworkDocumentSchema, coworkStoredBlocks, coworkStoredQuestion, coworkStoredSuggestions, type CoworkBlock, type CoworkEvent, type CoworkRun, type CoworkRunStatus, type CoworkSuggestion, coworkNoteText } from './contracts';

/**
 * Pure presentation helpers for the Cowork workspace. Everything here derives
 * user-facing copy from persisted runs/events; nothing is invented.
 */

export type CoworkIconKey =
  | 'contacts' | 'research' | 'team' | 'crm' | 'mail' | 'reply' | 'chart' | 'shield' | 'scale' | 'app'
  | 'draft' | 'campaign' | 'file' | 'bookmark' | 'profile' | 'lock' | 'list' | 'linkedin' | 'target'
  | 'alert' | 'audience' | 'pen' | 'globe' | 'calendar' | 'send' | 'play' | 'pause' | 'code' | 'stop'
  | 'user-plus' | 'user-check' | 'sparkles' | 'check' | 'search';

export type CoworkActionInfo = { label: string; source: string; icon: CoworkIconKey };

const ACTIONS: Record<string, CoworkActionInfo> = {
  'leads.search': { label: 'Buscó en tus contactos guardados', source: 'Contactos guardados', icon: 'contacts' },
  'leads.get': { label: 'Abrió la ficha de un contacto guardado', source: 'Contactos guardados', icon: 'contacts' },
  'research.get_existing': { label: 'Consultó la investigación guardada', source: 'Investigaciones', icon: 'research' },
  'specialists.review': { label: 'Pidió una revisión a especialistas', source: 'Especialistas', icon: 'team' },
  'crm.search': { label: 'Buscó en el CRM del equipo', source: 'CRM', icon: 'crm' },
  'crm.get_lead': { label: 'Abrió una ficha del CRM', source: 'CRM', icon: 'crm' },
  'crm.record': { label: 'Abrió la ficha comercial', source: 'CRM', icon: 'crm' },
  'crm.collaboration': { label: 'Revisó responsables y reservas', source: 'CRM', icon: 'crm' },
  'contacted.search': { label: 'Revisó el historial de envíos', source: 'Contactados', icon: 'mail' },
  'contacted.timeline': { label: 'Revisó la cronología de un contacto', source: 'Contactados', icon: 'mail' },
  'contacted.account': { label: 'Revisó los hilos de toda la empresa', source: 'Contactados', icon: 'mail' },
  'replies.meeting_chain': { label: 'Trazó envío, respuesta y reunión', source: 'Respuestas', icon: 'reply' },
  'replies.attention': { label: 'Revisó respuestas que requieren atención', source: 'Respuestas', icon: 'reply' },
  'replies.stalled': { label: 'Buscó interesados sin seguimiento', source: 'Respuestas', icon: 'reply' },
  'metrics.overview': { label: 'Consultó el resumen de métricas', source: 'Métricas', icon: 'chart' },
  'metrics.rates': { label: 'Calculó tasas de 7 y 30 días', source: 'Métricas', icon: 'chart' },
  'metrics.diagnose': { label: 'Contrastó hipótesis con tus datos', source: 'Métricas', icon: 'chart' },
  'metrics.channels': { label: 'Comparó email y LinkedIn', source: 'Métricas', icon: 'chart' },
  'metrics.incidents': { label: 'Revisó incidencias del sistema', source: 'Métricas', icon: 'alert' },
  'deliverability.check': { label: 'Verificó los registros DNS del dominio', source: 'Entregabilidad', icon: 'shield' },
  'deliverability.bounces': { label: 'Analizó los rebotes', source: 'Entregabilidad', icon: 'shield' },
  'deliverability.sender': { label: 'Contrastó tu remitente con envíos reales', source: 'Entregabilidad', icon: 'shield' },
  'compliance.check': { label: 'Revisó la política de contacto', source: 'Cumplimiento', icon: 'scale' },
  'compliance.law': { label: 'Consultó el marco legal chileno', source: 'Cumplimiento', icon: 'scale' },
  'compliance.obligation': { label: 'Identificó la regulación del sector', source: 'Cumplimiento', icon: 'scale' },
  'privacy.contactability': { label: 'Revisó restricciones de contacto', source: 'Privacidad', icon: 'lock' },
  'privacy.contactability_batch': { label: 'Revisó restricciones de un lote', source: 'Privacidad', icon: 'lock' },
  'app.context': { label: 'Revisó conexiones y volúmenes de la cuenta', source: 'Cuenta ANTON.IA', icon: 'app' },
  'draft.get': { label: 'Abrió un borrador', source: 'Borradores', icon: 'draft' },
  'message.context': { label: 'Consultó el contexto de redacción', source: 'Redacción', icon: 'pen' },
  'message.check_terms': { label: 'Verificó términos del borrador', source: 'Redacción', icon: 'pen' },
  'message.check_evidence': { label: 'Verificó afirmaciones contra evidencia', source: 'Redacción', icon: 'pen' },
  'campaigns.list': { label: 'Revisó tus campañas', source: 'Campañas', icon: 'campaign' },
  'campaigns.inbox': { label: 'Revisó pendientes de campañas', source: 'Campañas', icon: 'campaign' },
  'campaigns.plan': { label: 'Revisó el plan de seguimiento', source: 'Campañas', icon: 'campaign' },
  'campaigns.step_context': { label: 'Revisó un paso de campaña', source: 'Campañas', icon: 'campaign' },
  'campaigns.batch_report': { label: 'Revisó el reporte del lote', source: 'Campañas', icon: 'campaign' },
  'campaigns.next_touch': { label: 'Calculó el siguiente toque', source: 'Campañas', icon: 'campaign' },
  'campaigns.retry_review': { label: 'Revisó envíos reintentables', source: 'Campañas', icon: 'campaign' },
  'campaigns.company_plan': { label: 'Revisó el plan por empresa', source: 'Campañas', icon: 'campaign' },
  'files.list': { label: 'Revisó los archivos adjuntos', source: 'Archivos', icon: 'file' },
  'saved_searches.list': { label: 'Revisó tus búsquedas guardadas', source: 'Búsquedas guardadas', icon: 'bookmark' },
  'profile.get': { label: 'Consultó tu perfil comercial', source: 'Perfil', icon: 'profile' },
  'lists.review_contact': { label: 'Revisó un contacto para la lista', source: 'Listas', icon: 'list' },
  'lists.review_batch': { label: 'Revisó un lote de contactos para la lista', source: 'Listas', icon: 'list' },
  'linkedin.network': { label: 'Revisó tu red de LinkedIn', source: 'LinkedIn', icon: 'linkedin' },
  'linkedin.inbox': { label: 'Revisó tu bandeja de LinkedIn', source: 'LinkedIn', icon: 'linkedin' },
  'linkedin.quota': { label: 'Revisó tu cupo de invitaciones', source: 'LinkedIn', icon: 'linkedin' },
  'linkedin.followups': { label: 'Buscó segundos contactos en LinkedIn', source: 'LinkedIn', icon: 'linkedin' },
  'linkedin.jobs': { label: 'Revisó los trabajos de LinkedIn en cola', source: 'LinkedIn', icon: 'linkedin' },
  'missions.list': { label: 'Revisó tus misiones', source: 'Misiones', icon: 'target' },
  'exceptions.list': { label: 'Revisó incidencias abiertas', source: 'Incidencias', icon: 'alert' },
  'audience.analyze': { label: 'Analizó tu audiencia', source: 'Audiencia', icon: 'audience' },
  'gmail.contact_history': { label: 'Revisó correos en tu Gmail', source: 'Gmail', icon: 'mail' },
  'prospecting.search': { label: 'Buscó nuevos contactos en el proveedor', source: 'Búsqueda externa', icon: 'globe' },
};

export function coworkActionInfo(action: unknown): CoworkActionInfo {
  const key = typeof action === 'string' ? action : '';
  return ACTIONS[key] || { label: 'Consultó datos de la cuenta', source: 'ANTON.IA', icon: 'search' };
}

function countOf(result: unknown): number | null {
  if (!result || typeof result !== 'object') return null;
  const record = result as Record<string, unknown>;
  for (const key of ['items', 'leads', 'records', 'campaigns', 'files', 'contacts', 'threads', 'sources']) {
    if (Array.isArray(record[key])) return (record[key] as unknown[]).length;
  }
  return null;
}

/** One human line for a recorded read, with the query and result size when known. */
export function describeCoworkObservation(payload: Record<string, unknown>): { label: string; detail: string | null; icon: CoworkIconKey; source: string } {
  const action = String(payload.action || '');
  const info = coworkActionInfo(action);
  const input = typeof payload.input === 'string' ? payload.input.trim() : '';
  const parts: string[] = [];
  const showsQuery = ['leads.search', 'crm.search', 'contacted.search', 'deliverability.check', 'compliance.obligation'].includes(action);
  if (showsQuery && input) parts.push(`«${input.length > 48 ? `${input.slice(0, 47)}…` : input}»`);
  if (action === 'prospecting.search' && payload.input && typeof payload.input === 'object') {
    const criteria = payload.input as { titles?: unknown; target?: unknown };
    if (criteria.target === 'companies') parts.push('empresas');
    if (Array.isArray(criteria.titles) && criteria.titles.length) parts.push(criteria.titles.slice(0, 2).map(String).join(', '));
  }
  if (action === 'research.get_existing') {
    const research = (payload.result as { availability?: string; research?: { sources?: unknown[] } } | null);
    if (research?.availability === 'available') parts.push(`${research.research?.sources?.length ?? 0} fuentes`);
    else if (research?.availability) parts.push('sin informe disponible');
  } else {
    const count = countOf(payload.result);
    if (count !== null) parts.push(`${count} resultado${count === 1 ? '' : 's'}`);
  }
  return { label: info.label, detail: parts.length ? parts.join(' · ') : null, icon: info.icon, source: info.source };
}

export type CoworkStatusTone = 'neutral' | 'progress' | 'attention' | 'success' | 'danger';

export function coworkStatusCopy(status: CoworkRunStatus, options: { executing?: boolean } = {}): { label: string; tone: CoworkStatusTone } {
  if (status === 'waiting_approval' && options.executing) return { label: 'Ejecutando lo aprobado', tone: 'progress' };
  return ({
    queued: { label: 'En cola', tone: 'progress' },
    running: { label: 'Trabajando', tone: 'progress' },
    waiting_approval: { label: 'Necesita tu aprobación', tone: 'attention' },
    waiting_workers: { label: 'Revisando con especialistas', tone: 'progress' },
    completed: { label: 'Listo', tone: 'success' },
    failed: { label: 'No se pudo completar', tone: 'danger' },
    cancelled: { label: 'Detenido', tone: 'neutral' },
  } as const)[status] || { label: 'Actualizando', tone: 'neutral' };
}

export const COWORK_ACTIVE_STATUSES: readonly CoworkRunStatus[] = ['queued', 'running', 'waiting_approval', 'waiting_workers'];
export const isCoworkActive = (status: CoworkRunStatus) => COWORK_ACTIVE_STATUSES.includes(status);

export type CoworkEffectCopy = { title: string; help: string; icon: CoworkIconKey };

const EFFECTS: Record<string, CoworkEffectCopy> = {
  save_contact: { title: 'Guardar contacto', icon: 'user-plus', help: 'Se guardará en tus contactos sin correo verificado. Podrás enriquecerlo después.' },
  start_research: { title: 'Investigar contacto', icon: 'research', help: 'Se encolará la investigación con tu cuota disponible. Suele tardar unos minutos; después puedes pedirme el resumen o el borrador.' },
  enrich_contact: { title: 'Enriquecer contacto', icon: 'sparkles', help: 'Se consultará el correo al proveedor (solo email, sin teléfono). Consume 1 crédito de enriquecimiento y no inventa datos.' },
  request_draft: { title: 'Preparar borrador', icon: 'draft', help: 'Se preparará el borrador en segundo plano. Podrás revisarlo cuando esté listo.' },
  send_email: { title: 'Enviar correo', icon: 'send', help: 'Se enviará exactamente la versión mostrada.' },
  campaign_create: { title: 'Crear campaña', icon: 'campaign', help: 'Se crea pausada como borrador. Activarla requiere otra revisión.' },
  campaign_activate: { title: 'Activar campaña', icon: 'play', help: 'Al aprobar se verifican de nuevo audiencia, bajas y cada mensaje.' },
  campaign_pause: { title: 'Pausar campaña', icon: 'pause', help: 'Los envíos que ya estaban en curso podrían completarse.' },
  code_execute: { title: 'Ejecutar código', icon: 'code', help: 'Se ejecutará exactamente este código en un entorno aislado.' },
  profile_update: { title: 'Actualizar perfil', icon: 'profile', help: 'Se actualizará solo tu perfil comercial con los valores mostrados.' },
  saved_search_create: { title: 'Guardar búsqueda', icon: 'bookmark', help: 'Solo se guardará la búsqueda; no se ejecutará ni consumirá créditos.' },
  saved_search_update: { title: 'Actualizar búsqueda', icon: 'bookmark', help: 'Solo se guardará la búsqueda; no se ejecutará ni consumirá créditos.' },
  saved_search_delete: { title: 'Eliminar búsqueda', icon: 'bookmark', help: 'Solo se eliminará tu búsqueda; no afecta contactos ni campañas.' },
  campaign_stop_v2: { title: 'Detener seguimiento', icon: 'stop', help: 'Se omitirán los pasos pendientes de ese destinatario; lo enviado no se revierte.' },
  crm_update_record: { title: 'Actualizar ficha comercial', icon: 'crm', help: 'Solo cambiará la ficha comercial mostrada; no reasigna responsables del equipo.' },
  campaign_prepare_draft_v2: { title: 'Preparar borrador del paso', icon: 'draft', help: 'Solo se preparará el borrador del paso; no se enviará nada.' },
  crm_assign_lead: { title: 'Asignar o reservar contacto', icon: 'user-check', help: 'Se aplicará la misma regla de asignación que usa la pantalla de colaboración.' },
  exception_resolve: { title: 'Resolver incidencia', icon: 'alert', help: 'Solo se registrará el resultado revisado con su motivo.' },
  mission_control: { title: 'Controlar misión', icon: 'target', help: 'Pausar omite tareas pendientes; reactivar retoma el ciclo.' },
  message_context_update: { title: 'Actualizar contexto de redacción', icon: 'pen', help: 'Solo cambiará el contexto de redacción de tu organización; no reescribe borradores existentes.' },
  enrich_batch: { title: 'Enriquecer lote', icon: 'audience', help: 'Se consultará el correo de cada contacto del lote; los ya enriquecidos se reutilizan sin gastar de más.' },
  campaign_schedule_batch: { title: 'Programar lote', icon: 'calendar', help: 'Se reservará un día por empresa y un espaciado entre envíos. No crea ni activa la campaña ni envía nada.' },
  linkedin_invite: { title: 'Invitar en LinkedIn', icon: 'linkedin', help: 'Se encolará una invitación sin nota. La ejecutarás desde la extensión ante ese perfil.' },
  linkedin_message: { title: 'Mensaje de LinkedIn', icon: 'linkedin', help: 'Se encolará el mensaje aprobado. La ejecutarás desde la extensión ante ese perfil; solo lo confirmado cuenta como enviado.' },
};

export function coworkEffectCopy(kind: unknown): CoworkEffectCopy {
  return EFFECTS[String(kind || '')] || { title: 'Revisar acción', icon: 'check', help: 'Revisa la propuesta antes de aprobarla.' };
}

export type CoworkProposalState = 'pending' | 'approved' | 'running' | 'done' | 'discarded' | 'failed';
export type CoworkProposalView = {
  type: 'search' | 'note' | 'effect';
  payload: Record<string, unknown>;
  state: CoworkProposalState;
  title: string;
  label: string;
  icon: CoworkIconKey;
};

/** Current decision state of the proposal in one run, derived from its events. */
export function coworkProposalView(run: Pick<CoworkRun, 'status'>, events: CoworkEvent[]): CoworkProposalView | null {
  const request = events.slice().reverse().find(event => event.kind === 'approval.requested');
  if (!request) return null;
  const payload = request.payload || {};
  const kinds = new Set(events.filter(event => event.sequence > request.sequence).map(event => event.kind));
  const completed = events.slice().reverse().find(event => event.kind === 'run.completed' && event.sequence > request.sequence)?.payload;
  const failed = kinds.has('run.failed');
  if (payload.action === 'prospecting.search') {
    const criteria = (payload.criteria || {}) as { target?: string; limit?: number };
    const state: CoworkProposalState = failed ? 'failed'
      : kinds.has('search.approved') || kinds.has('search.started')
        ? (run.status === 'completed' ? 'done' : kinds.has('search.started') ? 'running' : 'approved')
        : run.status === 'waiting_approval' ? 'pending' : 'discarded';
    return { type: 'search', payload, state, icon: 'globe',
      title: criteria.target === 'companies' ? 'Buscar empresas' : 'Buscar nuevos contactos',
      label: `Hasta ${criteria.limit ?? 25} ${criteria.target === 'companies' ? 'empresas' : 'contactos'}` };
  }
  if (payload.action === 'crm.replace_note') {
    const state: CoworkProposalState = completed ? (completed.applied === true ? 'done' : 'discarded')
      : failed ? 'failed' : run.status === 'waiting_approval' ? 'pending' : 'discarded';
    return { type: 'note', payload, state, icon: 'crm', title: 'Reemplazar nota comercial',
      label: String(payload.leadName || 'Contacto del CRM') };
  }
  const copy = coworkEffectCopy(payload.kind);
  const state: CoworkProposalState = kinds.has('effect.completed') ? 'done'
    : kinds.has('effect.failed') ? 'failed'
      : kinds.has('effect.started') ? (run.status === 'waiting_approval' ? 'running' : failed ? 'failed' : 'done')
        : kinds.has('effect.approved') ? (run.status === 'waiting_approval' ? 'approved' : failed ? 'failed' : 'done')
          : run.status === 'waiting_approval' ? 'pending' : 'discarded';
  return { type: 'effect', payload, state, icon: copy.icon, title: copy.title, label: String(payload.label || copy.title) };
}

/** Continuations are admitted by the worker right after an effect or search finishes. */
export function coworkExpectsContinuation(events: CoworkEvent[]): boolean {
  if (events.some(event => event.kind === 'thread.budget_exhausted')) return false;
  const completedIndex = events.map(event => event.kind).lastIndexOf('run.completed');
  if (completedIndex === -1) return false;
  const before = events.slice(0, completedIndex + 1);
  // A finished or failed action resumes the thread (a failure is explained, not left as a raw error).
  if (before.some(event => event.kind === 'effect.completed' || event.kind === 'effect.failed')) return true;
  return before.some(event => event.kind === 'search.started')
    && before.some(event => event.kind === 'tool.completed' && event.payload?.action === 'prospecting.search');
}

export type CoworkTurnOutput = { reply: string; document: { title: string; content: string } | null; question: string | null };

/** Data reads of a turn: tool events other than the assistant's own note. */
export function coworkReadEvents(events: CoworkEvent[]): CoworkEvent[] {
  return events.filter(event => event.kind === 'tool.completed' && coworkNoteText(event.payload) === null);
}

/** What the assistant wrote next to its proposal, if anything. */
export function coworkTurnNote(events: CoworkEvent[]): string | null {
  for (const event of events.slice().reverse()) {
    if (event.kind !== 'tool.completed') continue;
    const note = coworkNoteText(event.payload);
    if (note) return note;
  }
  return null;
}

export function coworkTurnOutput(events: CoworkEvent[]): CoworkTurnOutput | null {
  const completed = events.slice().reverse().find(event => event.kind === 'run.completed')?.payload;
  const parsed = coworkDocumentSchema.safeParse(completed ? { reply: completed.reply, document: completed.document } : null);
  // Turns saved before the question traveled apart keep it inside the reply.
  return parsed.success ? { reply: parsed.data.reply, document: parsed.data.document, question: coworkStoredQuestion(completed?.question) } : null;
}

/** Cards of a finished answer (emails, sequences, tables and figures); older turns have none. */
export function coworkTurnBlocks(events: CoworkEvent[]): CoworkBlock[] {
  const completed = events.slice().reverse().find(event => event.kind === 'run.completed')?.payload;
  return coworkStoredBlocks(completed?.blocks);
}

/** Quick replies of a finished answer; turns saved before they existed have none. */
export function coworkTurnSuggestions(events: CoworkEvent[]): CoworkSuggestion[] {
  const completed = events.slice().reverse().find(event => event.kind === 'run.completed')?.payload;
  return coworkStoredSuggestions(completed?.suggestions);
}

/** Cards that also open in the side panel; figures stay inline in the chat. */
export type CoworkPanelBlock = Exclude<CoworkBlock, { type: 'metrics' }>;

export type CoworkArtifact =
  | { kind: 'block'; id: string; runId: string; title: string; block: CoworkPanelBlock; createdAt: string }
  | { kind: 'document'; id: string; runId: string; title: string; content: string; createdAt: string }
  | { kind: 'contacts'; id: string; runId: string; title: string; count: number; companies: boolean; external: boolean; createdAt: string }
  | { kind: 'file'; id: string; runId: string; title: string; name: string; extension: string; size: number | null; createdAt: string }
  | { kind: 'sources'; id: string; runId: string; title: string; count: number; sequence: number; createdAt: string };

/** Title and noun for a set of observed rows (people, companies or both). */
export function coworkContactsTitle(rows: Array<{ id: string }>) {
  const companies = rows.length > 0 && rows.every(row => row.id.startsWith('apollo-company:'));
  const mixed = !companies && rows.some(row => row.id.startsWith('apollo-company:'));
  const external = rows.some(row => row.id.startsWith('apollo:') || row.id.startsWith('apollo-company:'));
  const title = companies ? 'Empresas encontradas'
    : mixed ? 'Resultados encontrados'
      : external ? 'Contactos encontrados' : 'Contactos consultados';
  const noun = (count: number) => companies ? (count === 1 ? 'empresa' : 'empresas')
    : mixed ? (count === 1 ? 'resultado' : 'resultados') : (count === 1 ? 'contacto' : 'contactos');
  return { title, noun, companies, mixed, external };
}

export function coworkTurnArtifacts(run: Pick<CoworkRun, 'id' | 'created_at'>, events: CoworkEvent[]): CoworkArtifact[] {
  const artifacts: CoworkArtifact[] = [];
  const completedAt = events.slice().reverse().find(event => event.kind === 'run.completed')?.created_at || run.created_at;
  const output = coworkTurnOutput(events);
  coworkTurnBlocks(events).forEach((block, index) => {
    if (block.type === 'metrics') return;
    artifacts.push({ kind: 'block', id: `${run.id}:block:${index}`, runId: run.id, title: block.title, block, createdAt: completedAt });
  });
  if (output?.document) {
    artifacts.push({ kind: 'document', id: `${run.id}:document`, runId: run.id, title: output.document.title,
      content: output.document.content, createdAt: completedAt });
  }
  const observations = events.filter(event => event.kind === 'tool.completed').map(event => event.payload);
  const rows = collectCoworkLeadRows(observations);
  if (rows.length) {
    const { title, companies, external } = coworkContactsTitle(rows);
    artifacts.push({ kind: 'contacts', id: `${run.id}:contacts`, runId: run.id, count: rows.length, companies, external, title,
      createdAt: events.slice().reverse().find(event => event.kind === 'tool.completed')?.created_at || completedAt });
  }
  for (const event of events) {
    if (event.kind === 'artifact.created') {
      const payload = event.payload as { name?: unknown; size?: unknown } | null;
      const name = typeof payload?.name === 'string' ? payload.name : '';
      if (!name) continue;
      const dot = name.lastIndexOf('.');
      artifacts.push({ kind: 'file', id: `${run.id}:file:${name}`, runId: run.id, title: name, name,
        extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : '', size: typeof payload?.size === 'number' ? payload.size : null,
        createdAt: event.created_at });
    }
    if (event.kind === 'tool.completed' && event.payload?.action === 'research.get_existing') {
      const result = event.payload.result as { availability?: string; research?: { sources?: unknown[] } } | null;
      if (result?.availability === 'available' && Array.isArray(result.research?.sources) && result.research.sources.length) {
        artifacts.push({ kind: 'sources', id: `${run.id}:sources:${event.sequence}`, runId: run.id, sequence: event.sequence,
          title: 'Fuentes de la investigación', count: result.research.sources.length, createdAt: event.created_at });
      }
    }
  }
  return artifacts;
}

export type CoworkProgressState = 'done' | 'active' | 'attention' | 'pending' | 'error' | 'skipped';
export type CoworkProgressStep = { key: string; label: string; state: CoworkProgressState; detail?: string };

/** Honest lifecycle checklist for one turn, derived from persisted events only. */
export function coworkTurnProgress(run: Pick<CoworkRun, 'status' | 'automatic'>, events: CoworkEvent[]): CoworkProgressStep[] {
  const reads = coworkReadEvents(events).length;
  const proposal = coworkProposalView(run, events);
  const started = events.some(event => event.kind === 'run.started') || run.status !== 'queued';
  const steps: CoworkProgressStep[] = [{ key: 'received', label: run.automatic ? 'Retomó el trabajo con el resultado' : 'Solicitud recibida', state: 'done' }];
  const workDone = proposal !== null || ['completed', 'failed', 'cancelled'].includes(run.status) || run.status === 'waiting_workers';
  steps.push({
    key: 'work', label: run.status === 'queued' && !started ? 'En cola para empezar' : 'Analizar y consultar datos',
    state: run.status === 'queued' && !started ? 'active' : workDone ? (run.status === 'failed' && !proposal && reads === 0 ? 'error' : 'done') : 'active',
    detail: reads ? `${reads} consulta${reads === 1 ? '' : 's'}` : undefined,
  });
  if (run.status === 'waiting_workers') steps.push({ key: 'specialists', label: 'Revisión de especialistas', state: 'active' });
  if (proposal) {
    const approvalState: CoworkProgressState = proposal.state === 'pending' ? 'attention'
      : proposal.state === 'discarded' ? 'skipped' : 'done';
    steps.push({ key: 'approval', label: proposal.state === 'discarded' ? 'Propuesta descartada' : 'Tu aprobación', state: approvalState, detail: proposal.title });
    if (proposal.state !== 'pending' && proposal.state !== 'discarded') {
      steps.push({ key: 'execute', label: proposal.type === 'search' ? 'Buscar en el proveedor' : 'Ejecutar la acción',
        state: proposal.state === 'failed' ? 'error' : proposal.state === 'done' ? 'done' : 'active' });
    }
  }
  steps.push({
    key: 'result',
    label: run.status === 'failed' ? 'No se pudo completar' : run.status === 'cancelled' ? 'Trabajo detenido' : 'Resultado listo',
    state: run.status === 'completed' ? 'done' : run.status === 'failed' ? 'error' : run.status === 'cancelled' ? 'skipped' : 'pending',
  });
  return steps;
}

export type CoworkThreadSummary = {
  id: string;
  rootId: string;
  title: string;
  status: CoworkRunStatus;
  updatedAt: string;
  turns: number;
};

const UUID_PATTERN = '[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
const ID_REFERENCE = new RegExp(`\\s*\\((?:ID(?: del contacto)?\\s*:?\\s*)?${UUID_PATTERN}\\)`, 'gi');

/** Your message as you wrote it: internal references (contact IDs) stay out of sight. */
export function coworkDisplayMessage(message: string) {
  return String(message || '').replace(ID_REFERENCE, '').trim();
}

export function coworkCleanTitle(message: string, max = 90) {
  const text = coworkDisplayMessage(message).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Collapses follow-up runs into conversations, newest activity first. */
export function groupCoworkThreads(runs: CoworkRun[]): CoworkThreadSummary[] {
  const byId = new Map(runs.map(run => [run.id, run]));
  const rootOf = (run: CoworkRun) => {
    let cursor = run;
    const seen = new Set<string>();
    while (cursor.parent_run_id && byId.has(cursor.parent_run_id) && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      cursor = byId.get(cursor.parent_run_id) as CoworkRun;
    }
    return cursor;
  };
  const groups = new Map<string, CoworkRun[]>();
  for (const run of runs) {
    const root = rootOf(run);
    groups.set(root.id, [...(groups.get(root.id) || []), run]);
  }
  const time = (value: string) => Date.parse(value) || 0;
  return [...groups.entries()].map(([rootId, members]) => {
    const chronological = members.slice().sort((a, b) => time(a.created_at) - time(b.created_at));
    const latest = chronological[chronological.length - 1];
    const titled = chronological.find(run => !run.automatic) || chronological[0];
    return {
      id: latest.id, rootId,
      title: coworkCleanTitle(titled.automatic ? 'Continuación de un trabajo anterior' : titled.message),
      status: latest.status, updatedAt: latest.created_at,
      turns: chronological.filter(run => !run.automatic).length,
    };
  }).sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
}

export function coworkDateBucket(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Anteriores';
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86400000;
  const at = date.getTime();
  if (at >= startOfToday) return 'Hoy';
  if (at >= startOfToday - day) return 'Ayer';
  if (at >= startOfToday - 6 * day) return 'Últimos 7 días';
  if (at >= startOfToday - 29 * day) return 'Últimos 30 días';
  return 'Anteriores';
}

export function coworkShortTime(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const bucket = coworkDateBucket(value, now);
  if (bucket === 'Hoy') return date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (bucket === 'Ayer') return 'Ayer';
  if (bucket === 'Últimos 7 días') return date.toLocaleDateString('es-CL', { weekday: 'short' }).replace('.', '');
  return date.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }).replace('.', '');
}

export function coworkElapsed(fromIso: string | undefined, now = Date.now()): string {
  if (!fromIso) return '';
  const seconds = Math.max(0, Math.round((now - Date.parse(fromIso)) / 1000));
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${String(seconds % 60).padStart(2, '0')} s`;
}

export function coworkFileSize(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Unique data sources consulted across the visible turns, in first-seen order. */
export function coworkConsultedSources(events: CoworkEvent[]): string[] {
  const sources: string[] = [];
  for (const event of coworkReadEvents(events)) {
    const source = coworkActionInfo(event.payload?.action).source;
    if (!sources.includes(source)) sources.push(source);
  }
  return sources;
}

/** Latest live activity line while a run is working. */
export function coworkLiveActivity(run: Pick<CoworkRun, 'status'>, events: CoworkEvent[]): string {
  if (run.status === 'queued') return events.some(event => event.kind === 'effect.completed' || event.kind === 'search.approved') ? 'Retomando el trabajo…' : 'Preparando el trabajo…';
  if (run.status === 'waiting_workers') return 'Revisando con especialistas…';
  if (run.status === 'waiting_approval') {
    if (events.some(event => event.kind === 'search.started')) return 'Buscando en el proveedor…';
    if (events.some(event => event.kind === 'effect.started')) return 'Ejecutando la acción aprobada…';
    if (events.some(event => event.kind === 'effect.approved' || event.kind === 'search.approved')) return 'Aprobado. Empezará en unos segundos…';
    return 'Esperando tu decisión';
  }
  const lastRead = coworkReadEvents(events).pop();
  if (!lastRead) return 'Entendiendo tu solicitud…';
  return `${coworkActionInfo(lastRead.payload?.action).label}. Analizando…`;
}
