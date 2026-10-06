import { coworkSpecialistFor, type CoworkSpecialistInfo } from './agents';
import { collectCoworkLeadRows } from './lead-export';
import { coworkSearchCriteriaSchema, coworkSearchStrategy } from './search-proposal';
import { coworkVersionSource } from './blocks';
import { coworkMessageAttachments } from './attachments';
import { coworkDocumentSchema, coworkStoredBlocks, coworkStoredChoices, coworkStoredQuestion, coworkStoredSuggestions, type CoworkBlock, type CoworkChoices, type CoworkEvent, type CoworkRun, type CoworkRunStatus, type CoworkSuggestion, coworkNoteText,
  coworkIsAssistantEvent, coworkPlanSteps, type CoworkPlanStep, coworkAgentEvent, type CoworkAgentEvent, type CoworkDraftPhase } from './contracts';

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
  'replies.thread': { label: 'Leyó la conversación con un contacto', source: 'Respuestas', icon: 'reply' },
  'metrics.overview': { label: 'Consultó el resumen de métricas', source: 'Métricas', icon: 'chart' },
  'metrics.rates': { label: 'Calculó tasas de 7 y 30 días', source: 'Métricas', icon: 'chart' },
  'metrics.diagnose': { label: 'Contrastó hipótesis con tus datos', source: 'Métricas', icon: 'chart' },
  'metrics.channels': { label: 'Comparó email y LinkedIn', source: 'Métricas', icon: 'chart' },
  'metrics.incidents': { label: 'Revisó incidencias del sistema', source: 'Métricas', icon: 'alert' },
  'deliverability.check': { label: 'Verificó los registros DNS del dominio', source: 'Entregabilidad', icon: 'shield' },
  'site.read': { label: 'Leyó tu sitio web', source: 'Sitio web', icon: 'globe' },
  'leads.count': { label: 'Contó tus contactos guardados', source: 'Contactos', icon: 'contacts' },
  'leads.summary': { label: 'Resumió tus contactos por estado', source: 'Contactos', icon: 'contacts' },
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
  'files.read': { label: 'Leyó un archivo que subiste', source: 'Archivos', icon: 'file' },
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
  'icp.analyze': { label: 'Analizó tu cliente ideal', source: 'Cliente ideal', icon: 'audience' },
  'leads.recommend': { label: 'Ordenó a quién escribirle', source: 'Recomendados', icon: 'audience' },
  'opportunities.list': { label: 'Revisó tus oportunidades comerciales', source: 'Oportunidades', icon: 'target' },
  'agenda.today': { label: 'Armó tu lista de hoy', source: 'Agenda', icon: 'calendar' },
  'credits.balance': { label: 'Revisó tu saldo de créditos', source: 'Créditos', icon: 'scale' },
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
export function describeCoworkObservation(payload: Record<string, unknown>): { label: string; detail: string | null; icon: CoworkIconKey; source: string; agent: CoworkSpecialistInfo | null } {
  const action = String(payload.action || '');
  const info = coworkActionInfo(action);
  const input = typeof payload.input === 'string' ? payload.input.trim() : '';
  const parts: string[] = [];
  const showsQuery = ['leads.search', 'crm.search', 'contacted.search', 'deliverability.check', 'site.read', 'leads.count', 'compliance.obligation'].includes(action);
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
  return { label: info.label, detail: parts.length ? parts.join(' · ') : null, icon: info.icon, source: info.source, agent: coworkSpecialistFor(action) };
}

/** What a read found, in the person's words, for the chip beside its plan step:
 * a number and what it counts («4 contactos»), or a short phrase («sin envíos»). */
export type CoworkReadFinding = { count: number | null; label: string };

const FINDING_NOUNS: Record<string, [string, string]> = {
  'leads.search': ['contacto', 'contactos'],
  'crm.search': ['ficha', 'fichas'],
  'contacted.search': ['envío', 'envíos'],
  'contacted.account': ['hilo', 'hilos'],
  'campaigns.list': ['campaña', 'campañas'],
  'campaigns.inbox': ['pendiente', 'pendientes'],
  'replies.attention': ['respuesta', 'respuestas'],
  'replies.stalled': ['interesado', 'interesados'],
  'saved_searches.list': ['búsqueda guardada', 'búsquedas guardadas'],
  'files.list': ['archivo', 'archivos'],
  'linkedin.network': ['contacto', 'contactos'],
  'linkedin.followups': ['contacto', 'contactos'],
  'linkedin.inbox': ['conversación', 'conversaciones'],
  'missions.list': ['misión', 'misiones'],
  'exceptions.list': ['incidencia', 'incidencias'],
  'agenda.today': ['pendiente de hoy', 'pendientes de hoy'],
  'credits.balance': ['saldo', 'saldos'],
  'prospecting.search': ['contacto nuevo', 'contactos nuevos'],
};

export function coworkReadFinding(payload: Record<string, unknown> | null | undefined): CoworkReadFinding | null {
  const action = String(payload?.action || '');
  const result = payload?.result;
  if (action === 'files.read') {
    const file = (result && typeof result === 'object' ? result : null) as { found?: unknown; kind?: unknown; totalRows?: unknown } | null;
    if (!file) return null;
    if (file.found === false) return { count: null, label: 'no lo encontró' };
    if (file.kind === 'table' && typeof file.totalRows === 'number') return { count: file.totalRows, label: file.totalRows === 1 ? 'fila' : 'filas' };
    if (file.kind === 'text') return { count: null, label: 'texto leído' };
    if (file.kind === 'unreadable') return { count: null, label: 'no se pudo leer' };
    return null;
  }
  if (action === 'research.get_existing') {
    const research = (result && typeof result === 'object' ? result : null) as { availability?: string; research?: { sources?: unknown[] } } | null;
    if (research?.availability === 'available') {
      const sources = research.research?.sources?.length ?? 0;
      return { count: sources, label: sources === 1 ? 'fuente' : 'fuentes' };
    }
    return research?.availability ? { count: null, label: 'sin informe' } : null;
  }
  if (action === 'replies.thread') {
    const thread = (result && typeof result === 'object' ? result : null) as { available?: unknown; reply?: unknown } | null;
    if (!thread) return null;
    if (thread.available === false) return { count: null, label: 'no es tuya' };
    return thread.reply ? { count: null, label: 'con su respuesta' } : { count: null, label: 'sin respuesta aún' };
  }
  const count = countOf(result);
  if (count === null) return null;
  const [one, many] = FINDING_NOUNS[action] || ['resultado', 'resultados'];
  return count === 0 ? { count: null, label: `sin ${many}` } : { count, label: count === 1 ? one : many };
}

export function coworkFindingText(finding: CoworkReadFinding) {
  return finding.count === null ? finding.label : `${finding.count} ${finding.label}`;
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
  start_research: { title: 'Investigar contacto', icon: 'research', help: 'Se encolará la investigación con tu cuota disponible. Suele tardar unos minutos; cuando termine te aviso en esta conversación con lo útil para escribirle.' },
  enrich_contact: { title: 'Enriquecer contacto', icon: 'sparkles', help: 'Se consultará el correo al proveedor (solo email, sin teléfono). Consume 1 crédito de enriquecimiento y no inventa datos.' },
  request_draft: { title: 'Preparar borrador', icon: 'draft', help: 'Se preparará el borrador en segundo plano. Podrás revisarlo cuando esté listo.' },
  send_email: { title: 'Enviar correo', icon: 'send', help: 'Se enviará exactamente la versión mostrada.' },
  campaign_create: { title: 'Crear campaña', icon: 'campaign', help: 'Queda guardada sin enviar: nada sale hasta que la actives, y activarla pide otra aprobación.' },
  campaign_activate: { title: 'Activar campaña', icon: 'play', help: 'Al aprobar se verifican de nuevo audiencia, bajas y cada mensaje.' },
  campaign_pause: { title: 'Pausar campaña', icon: 'pause', help: 'Los envíos que ya estaban en curso podrían completarse.' },
  enrich_phone: { title: 'Revelar teléfono', icon: 'user-check', help: 'Se pedirá el teléfono de esta persona al proveedor. Cuesta 10 créditos y llega en unos minutos a tus contactos enriquecidos.' },
  campaign_retry: { title: 'Reintentar envíos fallidos', icon: 'send', help: 'Solo vuelven a la cola los envíos que fallaron por un motivo que se puede reintentar. Salen con los frenos de siempre y ninguno se envía dos veces.' },
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
  contacts_import: { title: 'Importar contactos', icon: 'user-plus', help: 'Se guardarán en tus contactos las personas del archivo que aún no están. Los que ya estaban no se tocan.' },
  linkedin_invite_batch: { title: 'Invitar en LinkedIn (lote)', icon: 'linkedin', help: 'Se encolará una invitación sin nota por cada persona que dejes en la lista. La ejecutarás desde la extensión ante cada perfil; quita a quien no quieras antes de aprobar.' },
  linkedin_message_batch: { title: 'Mensajes de LinkedIn (lote)', icon: 'linkedin', help: 'Se encolará el mensaje de cada persona que dejes en la lista, con el texto que ves. Los ejecutarás desde la extensión ante cada perfil; quita a quien no quieras antes de aprobar.' },
  reply_thread: { title: 'Responder en el hilo', icon: 'mail', help: 'Si la apruebas, esta respuesta sale tal cual dentro de la conversación de esa persona, desde tu correo. Revisa el texto antes.' },
  memory_save: { title: 'Recordar preferencia', icon: 'bookmark', help: 'Se guardará esta preferencia, tal como está escrita, y la tendré en cuenta en tus próximos trabajos.' },
  lead_prepare_batch: { title: 'Preparar contactos', icon: 'audience', help: 'A cada persona de la lista se le hace solo lo que le falta: guardarla, buscar su correo (1 crédito) e investigarla. Lo ya hecho no se repite ni se cobra; quita a quien no quieras antes de aprobar.' },
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
    const criteria = (payload.criteria || {}) as { target?: string; limit?: number; linkedinUrl?: string };
    const state: CoworkProposalState = failed ? 'failed'
      : kinds.has('search.approved') || kinds.has('search.started')
        ? (run.status === 'completed' ? 'done' : kinds.has('search.started') ? 'running' : 'approved')
        : run.status === 'waiting_approval' ? 'pending' : 'discarded';
    return { type: 'search', payload, state, icon: 'globe',
      title: criteria.linkedinUrl ? 'Consultar perfil de LinkedIn' : criteria.target === 'companies' ? 'Buscar empresas' : 'Buscar nuevos contactos',
      label: criteria.linkedinUrl ? 'Una persona, por su perfil exacto'
        : `Hasta ${criteria.limit ?? 25} ${criteria.target === 'companies' ? 'empresas' : 'contactos'}` };
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

export type CoworkOutcome = { happens: string; not: string };

/** What approving does, and what it does not, in one sentence each. */
const OUTCOMES: Record<string, CoworkOutcome> = {
  save_contact: { happens: 'Se guarda el contacto en tus contactos.', not: 'No se le escribe ni se gasta crédito.' },
  start_research: { happens: 'Se investiga el contacto con tu cuota.', not: 'No se le escribe.' },
  enrich_contact: { happens: 'Se busca su correo en el proveedor (1 crédito).', not: 'No se le escribe ni se inventan datos.' },
  request_draft: { happens: 'Se prepara un borrador en segundo plano.', not: 'No se envía nada.' },
  send_email: { happens: 'Se envía este correo, tal cual, desde tu cuenta.', not: 'No se envía a nadie más ni se cambia el texto.' },
  campaign_create: { happens: 'Se guarda la campaña con el correo de cada persona, sin enviar (pausada).', not: 'No sale nada hasta que la actives, y activarla pide otra aprobación.' },
  campaign_activate: { happens: 'Se activa la campaña y empieza a enviar según su calendario.', not: 'No cambian los correos ni los destinatarios.' },
  campaign_pause: { happens: 'Se pausa la campaña.', not: 'Lo que ya se envió no se revierte.' },
  enrich_phone: { happens: 'Se pide su teléfono al proveedor (10 créditos).', not: 'No se le llama ni se le escribe, y no se pide nada de otras personas.' },
  campaign_retry: { happens: 'Los envíos de la lista vuelven a la cola para reintentarse.', not: 'No se envía nada ahora ni se salta ningún freno: cupo, una empresa por día, respuestas y bajas siguen mandando.' },
  code_execute: { happens: 'Se ejecuta este código en un entorno aislado.', not: 'No toca tus contactos ni envía nada.' },
  profile_update: { happens: 'Se actualiza tu perfil comercial con estos valores.', not: 'No cambian tus contactos ni tus campañas.' },
  saved_search_create: { happens: 'Se guarda la búsqueda.', not: 'No se ejecuta ni gasta créditos.' },
  saved_search_update: { happens: 'Se actualiza la búsqueda guardada.', not: 'No se ejecuta ni gasta créditos.' },
  saved_search_delete: { happens: 'Se elimina la búsqueda guardada.', not: 'No afecta contactos ni campañas.' },
  campaign_stop_v2: { happens: 'Se detienen los pasos pendientes de ese destinatario.', not: 'Lo que ya se envió no se revierte.' },
  crm_update_record: { happens: 'Se actualiza la ficha comercial mostrada.', not: 'No se reasignan responsables del equipo.' },
  campaign_prepare_draft_v2: { happens: 'Se prepara el borrador de ese paso.', not: 'No se envía nada.' },
  crm_assign_lead: { happens: 'Se asigna o reserva el contacto, con la regla del equipo.', not: 'No se le escribe.' },
  exception_resolve: { happens: 'Se registra el resultado revisado de la incidencia.', not: 'No se envía nada.' },
  mission_control: { happens: 'Se pausa o reactiva la misión, como dice la propuesta.', not: 'No se envía nada en este paso.' },
  message_context_update: { happens: 'Se actualiza el contexto de redacción de tu organización.', not: 'No se reescriben los borradores que ya existen.' },
  enrich_batch: { happens: 'Se busca el correo de cada contacto del lote.', not: 'No se les escribe; los ya enriquecidos no gastan de nuevo.' },
  campaign_schedule_batch: { happens: 'Se reserva un día por empresa y un espaciado entre envíos.', not: 'No se crea ni se activa la campaña, ni se envía nada.' },
  linkedin_invite: { happens: 'Se deja en cola una invitación sin nota.', not: 'No sale hasta que la ejecutes desde la extensión.' },
  linkedin_message: { happens: 'Se deja en cola el mensaje aprobado.', not: 'No sale hasta que lo ejecutes desde la extensión.' },
  contacts_import: { happens: 'Se guardan en tus contactos las personas nuevas del archivo.', not: 'No se les escribe, no se buscan correos y no cambian los contactos que ya tenías.' },
  linkedin_invite_batch: { happens: 'Se deja en cola una invitación sin nota por cada persona que dejes en la lista.', not: 'No sale nada hasta que lo ejecutes desde la extensión; a quien quites, o no sale hoy, no se le toca.' },
  linkedin_message_batch: { happens: 'Se deja en cola el mensaje de cada persona que dejes en la lista, con el texto que ves.', not: 'No sale nada hasta que lo ejecutes desde la extensión; a quien quites, o no sale hoy, no se le toca.' },
  reply_thread: { happens: 'La respuesta sale en el hilo de esa conversación, con el texto que ves, desde tu correo.', not: 'No se envía nada más ni a nadie más, y no sale hasta que la apruebes.' },
  memory_save: { happens: 'Se guarda la preferencia y la tengo en cuenta desde tu próximo pedido.', not: 'No cambian tus contactos, tus campañas ni lo que ya se escribió.' },
  lead_prepare_batch: { happens: 'A cada persona que dejes en la lista se le hace lo que le falta, en orden: guardarla, buscar su correo e investigarla.', not: 'No se le escribe a nadie, y lo que ya estaba hecho no se repite ni se cobra de nuevo.' },
};

export function coworkProposalOutcome(proposal: Pick<CoworkProposalView, 'type' | 'payload'>): CoworkOutcome {
  if (proposal.type === 'search') {
    const criteria = (proposal.payload.criteria || {}) as { target?: string; limit?: number };
    const companies = criteria.target === 'companies';
    const parsed = coworkSearchCriteriaSchema.safeParse(proposal.payload.criteria);
    const more = parsed.success && ((parsed.data.page || 1) > 1 || Boolean(parsed.data.offset)) ? ' más' : '';
    if (parsed.success && parsed.data.linkedinUrl) {
      return { happens: 'Se consulta solo la persona de este perfil en el proveedor (aproximadamente 1 crédito y 1 búsqueda de tu cuota).',
        not: 'No se revelan correos ni teléfonos, no se guarda el contacto y no se envía una invitación.' };
    }
    if (parsed.success && coworkSearchStrategy(parsed.data) === 'companies_first') {
      return { happens: `Se buscan empresas de esos rubros y, dentro de ellas, hasta ${parsed.data.limit} contactos nuevos${more} en el proveedor (1 búsqueda de tu cuota).`,
        not: 'No se revelan correos ni se guardan contactos, y no se envía nada.' };
    }
    return { happens: `Se buscan hasta ${criteria.limit ?? 25} ${companies ? 'empresas' : 'contactos nuevos'}${more} en el proveedor (1 búsqueda de tu cuota).`,
      not: 'No se revelan correos ni se guardan contactos, y no se envía nada.' };
  }
  if (proposal.type === 'note') {
    return { happens: `Se reemplaza la nota de ${String(proposal.payload.leadName || 'este contacto')} en el CRM.`, not: 'No cambia nada más del contacto.' };
  }
  return OUTCOMES[String(proposal.payload.kind || '')] || { happens: 'Se ejecuta la acción propuesta.', not: 'No se hace nada más sin tu aprobación.' };
}

export type CoworkTimelineState = 'done' | 'current' | 'pending' | 'skipped' | 'failed';
export type CoworkTimelineStep = { label: string; state: CoworkTimelineState };

/** Proposal → your approval → execution → result, with where the proposal is. */
export function coworkProposalTimeline(state: CoworkProposalState): CoworkTimelineStep[] {
  const steps: Record<CoworkProposalState, CoworkTimelineState[]> = {
    pending: ['done', 'current', 'pending', 'pending'],
    approved: ['done', 'done', 'current', 'pending'],
    running: ['done', 'done', 'current', 'pending'],
    done: ['done', 'done', 'done', 'done'],
    discarded: ['done', 'skipped', 'skipped', 'skipped'],
    failed: ['done', 'done', 'failed', 'skipped'],
  };
  return ['Propuesta', 'Tu aprobación', 'Ejecución', 'Resultado'].map((label, index) => ({ label, state: steps[state][index] }));
}

/** Where a finished action can be seen, when it has a page of its own. */
export function coworkProposalLink(proposal: Pick<CoworkProposalView, 'type' | 'payload' | 'state'>): { href: string; label: string } | null {
  if (proposal.state !== 'done' || proposal.type !== 'effect') return null;
  const kind = String(proposal.payload.kind || '');
  if (kind === 'campaign_create' || kind === 'campaign_activate' || kind === 'campaign_pause' || kind === 'campaign_schedule_batch' || kind === 'campaign_retry') return { href: '/campaigns', label: 'Ver campañas' };
  if (kind === 'save_contact' || kind === 'enrich_contact' || kind === 'enrich_batch' || kind === 'contacts_import' || kind === 'enrich_phone'
    || kind === 'lead_prepare_batch') return { href: '/saved/leads', label: 'Ver tus contactos' };
  if (kind === 'send_email' || kind === 'reply_thread') return { href: '/contacted', label: 'Ver en Contactados' };
  if (kind === 'profile_update') return { href: '/profile', label: 'Ver tu perfil' };
  return null;
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
  return events.filter(event => event.kind === 'tool.completed' && !coworkIsAssistantEvent(event.payload));
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

export type CoworkPlanState = 'done' | 'current' | 'pending' | 'skipped';
/** Each step with its state and, once its read is in, what that read found. */
/** `agent`: who does the step (G4), from its read; null for Cowork's own steps and the answer. */
export type CoworkPlanProgress = Array<CoworkPlanStep & { state: CoworkPlanState; found: CoworkReadFinding | null; agent: CoworkSpecialistInfo | null }>;

/** The plan shown while a turn works, with each step's state. A step with a
 * read is done once that read completes; the final step, once the answer or
 * the proposal is in. A read the model dropped reads as skipped, never as done. */
export function coworkPlanProgress(run: Pick<CoworkRun, 'status'>, events: CoworkEvent[]): CoworkPlanProgress | null {
  const planEvent = events.find(event => event.kind === 'tool.completed' && coworkPlanSteps(event.payload));
  const steps = planEvent ? coworkPlanSteps(planEvent.payload) : null;
  if (!planEvent || !steps) return null;
  const reads = coworkReadEvents(events).filter(event => event.sequence > planEvent.sequence);
  const found: Array<CoworkReadFinding | null> = steps.map(() => null);
  const states: CoworkPlanState[] = steps.map((step, at) => {
    const index = step.read ? reads.findIndex(event => event.payload?.action === step.read) : -1;
    if (index === -1) return 'pending';
    found[at] = coworkReadFinding(reads[index].payload);
    reads.splice(index, 1);
    return 'done';
  });
  const lastDone = states.lastIndexOf('done');
  states.forEach((state, index) => { if (state === 'pending' && steps[index].read && index < lastDone) states[index] = 'skipped'; });
  const ended = run.status === 'completed' || run.status === 'waiting_approval';
  if (ended) states.forEach((state, index) => { if (state === 'pending') states[index] = steps[index].read ? 'skipped' : 'done'; });
  else if (isCoworkActive(run.status)) {
    const current = states.indexOf('pending');
    if (current !== -1) states[current] = 'current';
  }
  return steps.map((step, index) => ({ ...step, state: states[index], found: found[index], agent: coworkSpecialistFor(step.read) }));
}

/** A plan step as the headline says it: «Analista · reviso tus cifras de la semana», or just the step. */
export function coworkPlanStepLine(step: { label: string; agent: CoworkSpecialistInfo | null }): string {
  return step.agent ? `${step.agent.name} · ${step.label.charAt(0).toLocaleLowerCase('es')}${step.label.slice(1)}` : step.label;
}

/** What a turn's reads found, in order and without repeats: the evidence behind its answer. */
export function coworkTurnFindings(events: CoworkEvent[]): CoworkReadFinding[] {
  const seen = new Set<string>();
  return coworkReadEvents(events).flatMap(event => {
    const finding = coworkReadFinding(event.payload);
    if (!finding || seen.has(coworkFindingText(finding))) return [];
    seen.add(coworkFindingText(finding));
    return [finding];
  });
}

export type CoworkCardTone = 'neutral' | 'accent' | 'attention' | 'success' | 'danger';
export type CoworkCardStatus = { label: string; tone: CoworkCardTone };

const CAMPAIGN_STATUS: Record<CoworkProposalState, CoworkCardStatus> = {
  pending: { label: 'Campaña propuesta · espera tu aprobación', tone: 'attention' },
  approved: { label: 'Creando la campaña…', tone: 'accent' },
  running: { label: 'Creando la campaña…', tone: 'accent' },
  done: { label: 'Campaña creada · guardada sin enviar', tone: 'success' },
  discarded: { label: 'Campaña descartada · no se creó', tone: 'neutral' },
  failed: { label: 'No se pudo crear la campaña', tone: 'danger' },
};

/**
 * What happened to each email or sequence card after it was shown, keyed by
 * artifact id. A later turn sent from the card («Usar esta versión», «Crear
 * campaña con esta versión») names it by title; the latest card with that title
 * before the turn is the one used, and the latest use wins. Cards nobody used
 * are not in the map: they are drafts nobody sent.
 */
export function coworkCardStatuses(turns: Array<{ run: CoworkRun; events: CoworkEvent[] }>): Map<string, CoworkCardStatus> {
  const statuses = new Map<string, CoworkCardStatus>();
  const cardByTitle = new Map<string, string>();
  for (const { run, events } of turns) {
    const source = coworkVersionSource(run.message);
    const card = source ? cardByTitle.get(source.title) : undefined;
    if (source && card) {
      if (source.intent === 'use') {
        statuses.set(card, { label: `${source.edited ? 'Tu versión, elegida' : 'Versión elegida'} · no se ha enviado`, tone: 'accent' });
      } else {
        const proposal = coworkProposalView(run, events);
        if (proposal?.type === 'effect' && proposal.payload.kind === 'campaign_create') statuses.set(card, CAMPAIGN_STATUS[proposal.state]);
        else if (isCoworkActive(run.status)) statuses.set(card, { label: 'Preparando la campaña…', tone: 'accent' });
      }
    }
    for (const artifact of coworkTurnArtifacts(run, events)) {
      if (artifact.kind === 'block' && (artifact.block.type === 'email_draft' || artifact.block.type === 'sequence')) cardByTitle.set(artifact.title, artifact.id);
    }
  }
  return statuses;
}

/** Whether the final answer reads differently from the one shown while it was being
 * written: a word changed or went away. Spacing, punctuation, case and text added at
 * the end (the closing question) do not count. */
export function coworkAnswerChanged(shown: string, final: string): boolean {
  const words = (text: string) => text.toLocaleLowerCase('es').match(/[\p{L}\p{N}]+/gu) || [];
  const after = words(final);
  return words(shown).some((word, index) => after[index] !== word);
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

/** The options that answer the closing question of a turn (V5), or null. */
export function coworkTurnChoices(events: CoworkEvent[]): CoworkChoices | null {
  const completed = events.slice().reverse().find(event => event.kind === 'run.completed')?.payload;
  return coworkStoredChoices(completed?.choices);
}

/** Cards that also open in the side panel; figures and charts stay inline in the chat. */
export type CoworkPanelBlock = Exclude<CoworkBlock, { type: 'metrics' }>;

export type CoworkArtifact =
  | { kind: 'block'; id: string; runId: string; title: string; block: CoworkPanelBlock; createdAt: string }
  | { kind: 'document'; id: string; runId: string; title: string; content: string; createdAt: string }
  | { kind: 'contacts'; id: string; runId: string; title: string; count: number; companies: boolean; external: boolean; createdAt: string }
  | { kind: 'file'; id: string; runId: string; title: string; name: string; extension: string; size: number | null; createdAt: string }
  | { kind: 'sources'; id: string; runId: string; title: string; count: number; sequence: number; createdAt: string }
  /** A code artifact (Plan 12): a page the Designer wrote, shown in a sandboxed frame. key and version group its versions. */
  | { kind: 'code'; id: string; runId: string; title: string; name: string; key: string; version: number; tables: Array<{ label: string; rows: number }>; createdAt: string };

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

/** The results of a conversation for the canvas switcher (Plan 12, 2): newest first, and a code artifact once, at its
 * latest version (its versions have their own selector). `artifacts` comes in the conversation's order, oldest first. */
export function coworkThreadResults(artifacts: CoworkArtifact[]): CoworkArtifact[] {
  const seen = new Set<string>();
  const latest = new Map<string, number>();
  for (const item of artifacts) if (item.kind === 'code') latest.set(item.key, Math.max(latest.get(item.key) ?? 0, item.version));
  return artifacts.slice().reverse().filter(item => {
    if (item.kind !== 'code') return true;
    if (seen.has(item.key) || item.version !== latest.get(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

export function coworkTurnArtifacts(run: Pick<CoworkRun, 'id' | 'created_at'>, events: CoworkEvent[]): CoworkArtifact[] {
  const artifacts: CoworkArtifact[] = [];
  const completedAt = events.slice().reverse().find(event => event.kind === 'run.completed')?.created_at || run.created_at;
  const output = coworkTurnOutput(events);
  coworkTurnBlocks(events).forEach((block, index) => {
    // Figures read inline; a chart is drawn on the canvas, with a compact card in the chat (Plan 12, 2).
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
      const payload = event.payload as { name?: unknown; size?: unknown; kind?: unknown; title?: unknown; key?: unknown; version?: unknown; tables?: unknown } | null;
      const name = typeof payload?.name === 'string' ? payload.name : '';
      if (!name) continue;
      if (payload?.kind === 'code' && typeof payload.key === 'string' && Number.isInteger(payload.version)) {
        const tables = Array.isArray(payload.tables) ? (payload.tables as Array<{ label?: unknown; rows?: unknown }>)
          .filter(table => typeof table?.label === 'string' && typeof table.rows === 'number').map(table => ({ label: String(table.label), rows: Number(table.rows) })) : [];
        artifacts.push({ kind: 'code', id: `${run.id}:code:${name}`, runId: run.id, title: typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : name,
          name, key: payload.key, version: Number(payload.version), tables, createdAt: event.created_at });
        continue;
      }
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
  // With a plan, the step in progress says which one it is, like the chat does.
  const plan = coworkPlanProgress(run, events);
  const current = plan ? plan.findIndex(step => step.state === 'current') : -1;
  steps.push({
    key: 'work', label: run.status === 'queued' && !started ? 'En cola para empezar' : 'Analizar y consultar datos',
    state: run.status === 'queued' && !started ? 'active' : workDone ? (run.status === 'failed' && !proposal && reads === 0 ? 'error' : 'done') : 'active',
    detail: plan && current !== -1 ? `Paso ${current + 1} de ${plan.length}: ${coworkPlanStepLine(plan[current])}`
      : reads ? `${reads} consulta${reads === 1 ? '' : 's'}` : undefined,
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
// «(ID del contacto: …)» from a card, and «(ID de Marcela Rojas: …)» from a mention (mentions.ts).
const ID_REFERENCE = new RegExp(`\\s*\\((?:ID(?: del contacto| de [^():\\n]{1,80})?\\s*:?\\s*)?${UUID_PATTERN}\\)`, 'gi');

/** Your message as you wrote it: internal references (contact IDs) stay out of sight. */
export function coworkDisplayMessage(message: string) {
  return String(message || '').replace(ID_REFERENCE, '').trim();
}

/** A thread's title: the text of its first message, or its files when it only carried files. */
export function coworkCleanTitle(message: string, max = 90) {
  const { text: written, files } = coworkMessageAttachments(message);
  const text = coworkDisplayMessage(written || (files.length ? `Archivos: ${files.join(', ')}` : '')).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Collapses follow-up runs into conversations, newest activity first. The conversation is the run's root_run_id when the
 * server sends it (it holds even when the first run is older than the list), else the chain of parents; `titles` are the
 * names the person gave (cowork_thread_settings), which replace the first message.
 */
export function groupCoworkThreads(runs: CoworkRun[], titles: Record<string, string> = {}): CoworkThreadSummary[] {
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
    const rootId = run.root_run_id || rootOf(run).id;
    groups.set(rootId, [...(groups.get(rootId) || []), run]);
  }
  const time = (value: string) => Date.parse(value) || 0;
  return [...groups.entries()].map(([rootId, members]) => {
    const chronological = members.slice().sort((a, b) => time(a.created_at) - time(b.created_at));
    const latest = chronological[chronological.length - 1];
    const titled = chronological.find(run => !run.automatic) || chronological[0];
    return {
      id: latest.id, rootId,
      title: titles[rootId] || coworkCleanTitle(titled.automatic ? 'Continuación de un trabajo anterior' : titled.message),
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

/** The Writer, the Reviewer or the judge in a turn (writer.ts, judge-run.ts): its latest step, with the name the page shows. */
export type CoworkAgentRow = CoworkAgentEvent & { name: string };
/** The judge reads answers as the Reviewer reads emails: to the person, both are the Reviewer. */
const AGENT_NAMES: Record<CoworkAgentEvent['agent'], string> = { writer: 'Redactora', reviewer: 'Revisora', judge: 'Revisora', designer: 'Diseñadora', analyst: 'Analista' };

/** Each agent of the turn at its latest step, in the order they started: who wrote, who reviewed. */
export function coworkAgentRows(events: CoworkEvent[]): CoworkAgentRow[] {
  const rows = new Map<CoworkAgentEvent['agent'], CoworkAgentRow>();
  for (const event of events) {
    const step = event.kind === 'tool.completed' ? coworkAgentEvent(event.payload) : null;
    // A later step replaces the agent's row in place: the order stays the order they started.
    if (step) rows.set(step.agent, { ...step, name: AGENT_NAMES[step.agent] });
  }
  return [...rows.values()];
}

/** One line for an agent's step: «Redactora · escribiendo 3 correos…». */
export function coworkAgentLine(row: CoworkAgentRow): string {
  const label = row.label.charAt(0).toLocaleLowerCase('es') + row.label.slice(1);
  return `${row.name} · ${label}${row.state === 'working' ? '…' : ''}`;
}

export type CoworkDraftReview = { outcome: 'clean' | 'fixed' | 'pending'; changes: string[] };
/** How the Reviewer left the turn's emails, for their cards: nothing to fix, what it fixed, or what
 * is still to look at. Null when nobody reviewed them (no time, or the review failed). */
export function coworkDraftReview(events: CoworkEvent[]): CoworkDraftReview | null {
  const reviewer = coworkAgentRows(events).find(row => row.agent === 'reviewer');
  if (!reviewer || reviewer.state !== 'done' || !reviewer.outcome || reviewer.outcome === 'skipped') return null;
  return { outcome: reviewer.outcome, changes: reviewer.changes };
}

/**
 * The line a held answer shows until it is final (COWORK_ANSWER_HOLD_ENABLED): which phase it is in,
 * about the emails when it carries them. While it is reviewed the line says why no text shows yet.
 */
export function coworkHeldAnswerCopy(phase: CoworkDraftPhase | null, cards: Array<{ type: string }>): string {
  const emails = cards.filter(card => card.type === 'email_draft' || card.type === 'sequence');
  const [noun, pronoun] = !emails.length ? ['la respuesta', 'la']
    : emails.length === 1 && emails[0].type === 'email_draft' ? ['el correo', 'lo'] : ['los correos', 'los'];
  if (phase === 'reviewing') return `Revisando ${noun} antes de mostrárte${pronoun}`;
  if (phase === 'adjusting') return `Ajustando ${noun} tras revisar${pronoun}`;
  return `Escribiendo ${noun}`;
}

/** How the judge left the turn's answer (G2): read with nothing to fix, or fixed after its review.
 * Null when it did not review it (off, no time, or its call failed). */
export function coworkAnswerReview(rows: CoworkAgentRow[]): 'clean' | 'fixed' | null {
  const judge = rows.find(row => row.agent === 'judge');
  return judge?.state === 'done' && (judge.outcome === 'clean' || judge.outcome === 'fixed') ? judge.outcome : null;
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
  // After the reads, the Writer, the Reviewer and the judge say what they are doing.
  const lastAgent = events.slice().reverse().find(event => event.kind === 'tool.completed' && coworkAgentEvent(event.payload));
  if (lastAgent && (!lastRead || lastAgent.sequence > lastRead.sequence)) {
    const row = coworkAgentRows(events).find(item => item.agent === coworkAgentEvent(lastAgent.payload)?.agent);
    if (row) return coworkAgentLine(row);
  }
  // Once the plan is on screen, the request is understood.
  if (!lastRead) return events.some(event => event.kind === 'tool.completed' && coworkPlanSteps(event.payload)) ? 'Plan listo. Empezando…' : 'Entendiendo tu solicitud…';
  return `${coworkActionInfo(lastRead.payload?.action).label}. Analizando…`;
}
