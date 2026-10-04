export type ConversationRow = {
  id: string; user_id: string; organization_id: string; name: string; email: string;
  company?: string; lead_id?: string; subject?: string; provider: string;
  status?: string; sent_at?: string; replied_at?: string; reply_intent?: string;
  reply_preview?: string; last_reply_text?: string; reply_summary?: string;
  reply_subject?: string;
  opened_at?: string; click_count?: number; scheduled_at?: string;
  conversation_resolved_at?: string; conversation_outbound_at?: string;
  reply_sync_succeeded_at?: string; reply_sync_error?: string;
  crm_stage?: string | null;
  message_id?: string; thread_id?: string; conversation_id?: string;
  internet_message_id?: string;
};
export type ConversationView = 'reply' | 'waiting' | 'scheduled' | 'all';
export type PlannedTouch = {
  id: string; email: string; ownerId: string; campaignId: string; enrollmentId: string; kind: 'first_contact' | 'bulk'; campaignName?: string; state: string; dueAt: string | null;
  enrollmentState: string; draftId: string | null; versionId: string | null;
  index: number; error: string | null; autoSend: boolean; subject?: string; text?: string;
};
export function needsReply(row: ConversationRow) {
  if (!row.replied_at || ['negative', 'unsubscribe', 'delivery_failure', 'auto_reply'].includes(row.reply_intent || '')) return false;
  return Date.parse(row.replied_at) > Math.max(Date.parse(row.conversation_resolved_at || '') || 0, Date.parse(row.conversation_outbound_at || '') || 0);
}
export function conversationStatus(row: ConversationRow) {
  if (row.reply_intent === 'unsubscribe') return 'No contactar · Baja solicitada';
  if (row.status === 'failed' || row.reply_intent === 'delivery_failure') return 'Envío fallido';
  if (needsReply(row)) return row.reply_intent === 'meeting_request' ? 'Solicitó una reunión' : 'Por responder';
  if (row.reply_intent === 'negative') return 'Sin interés · Seguimiento detenido';
  if (row.reply_intent === 'auto_reply') return 'Respuesta automática';
  if (row.conversation_resolved_at && Date.parse(row.conversation_resolved_at) >= (Date.parse(row.replied_at || '') || 0)) return 'Resuelto';
  if (row.status === 'scheduled') return 'Programado';
  return 'Esperando respuesta';
}
export function activeTouch(touch: PlannedTouch) {
  return ['active', 'pending_initial_send'].includes(touch.enrollmentState) && !['sent', 'skipped', 'blocked'].includes(touch.state);
}
export function conversationKey(row: ConversationRow) {
  return `${row.organization_id}:${row.user_id}:${row.provider}:${row.email?.toLowerCase() || row.id}`;
}
export function groupConversations(rows: ConversationRow[]) {
  const groups = new Map<string, ConversationRow[]>();
  for (const row of rows) { const key = conversationKey(row); groups.set(key, [...(groups.get(key) || []), row]); }
  return [...groups.values()].map(history => {
    history.sort((a, b) => Date.parse(b.replied_at || b.sent_at || '') - Date.parse(a.replied_at || a.sent_at || ''));
    return { row: history.find(needsReply) || history[0], history };
  }).sort((a, b) => Number(needsReply(b.row)) - Number(needsReply(a.row)) || Date.parse(b.row.replied_at || b.row.sent_at || '') - Date.parse(a.row.replied_at || a.row.sent_at || ''));
}

// The inbox (Plan 9, PR-14): one list with a count per view, the conversation open beside it, and an address that keeps
// both (?view=…&c=…) so a link, a reload and the back button land on the same place.
export const CONVERSATION_VIEWS: ConversationView[] = ['reply', 'waiting', 'scheduled', 'all'];
export const CONVERSATION_VIEW_LABELS: Record<ConversationView, string> = { reply: 'Por responder', waiting: 'Esperando', scheduled: 'Programados', all: 'Todas' };

export function matchesConversationView(row: ConversationRow, view: ConversationView, hasActivePlans: boolean) {
  if (view === 'reply') return needsReply(row);
  if (view === 'waiting') return conversationStatus(row) === 'Esperando respuesta';
  if (view === 'scheduled') return hasActivePlans || row.status === 'scheduled';
  return true;
}

/** The view and the open conversation an address asks for; an unknown view reads as none. */
export function readConversationUrl(search: string) {
  const params = new URLSearchParams(search);
  const view = params.get('view') || '';
  return {
    view: (CONVERSATION_VIEWS as string[]).includes(view) ? view as ConversationView : null,
    conversationId: params.get('c')?.trim() || null,
  };
}

/** The same address with the view and the open conversation set (or cleared), other parameters kept. */
export function conversationUrl(href: string, state: { view?: ConversationView | null; conversationId?: string | null }) {
  const url = new URL(href);
  if (state.view !== undefined) {
    if (state.view && state.view !== 'reply') url.searchParams.set('view', state.view); else url.searchParams.delete('view');
  }
  if (state.conversationId !== undefined) {
    if (state.conversationId) url.searchParams.set('c', state.conversationId); else url.searchParams.delete('c');
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export type ConversationTone = 'warning' | 'success' | 'danger' | 'info' | 'neutral';

/** The badge tone of each status: what needs you stands out, what is closed stays quiet. */
export function conversationTone(status: string): ConversationTone {
  if (status === 'Por responder') return 'warning';
  if (status === 'Solicitó una reunión') return 'success';
  if (status === 'Envío fallido' || status.startsWith('No contactar')) return 'danger';
  if (status === 'Programado') return 'info';
  return 'neutral';
}
