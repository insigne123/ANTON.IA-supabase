import type { SupabaseClient } from '@supabase/supabase-js';
import {
  RECONNECT_AFTER_CHOICES, RECONNECT_SIGNAL_WINDOW_DAYS, buildReconnectAlerts, reconnectContextFor, reconnectInstruction, reconnectSettings,
  type ReconnectMark, type ReconnectRow, type ReconnectSignal, type ReconnectSignalKind,
} from '@/lib/reconnect';

type Scope = { organizationId: string; userId: string };
type Client = Pick<SupabaseClient, 'from'>;

export class ReconnectError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ReconnectError'; }
}

const ROW_COLUMNS = 'id,lead_id,email,name,company,role,subject,sent_at,last_follow_up_at,conversation_outbound_at,replied_at,reply_intent,'
  + 'conversation_resolved_at,evaluation_status,campaign_followup_reason,bounced_at,status';
const MISSING_COLUMN = '42703';
const MISSING_TABLE = '42P01';
const DAY = 86_400_000;

/** The person's own conversations, newest first; before the close outcome column exists, without it. */
async function readRows(client: Client, scope: Scope, contactedId?: string): Promise<ReconnectRow[]> {
  const query = (columns: string) => {
    let builder = client.from('contacted_leads').select(columns)
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).not('sent_at', 'is', null);
    if (contactedId) builder = builder.eq('id', contactedId);
    return builder.order('sent_at', { ascending: false }).limit(3000);
  };
  let result: any = await query(`${ROW_COLUMNS},conversation_close_outcome`);
  if (result.error?.code === MISSING_COLUMN) result = await query(ROW_COLUMNS);
  if (result.error) throw new ReconnectError('No pudimos revisar tus conversaciones.', 503);
  return (result.data || []) as ReconnectRow[];
}

async function readMarks(client: Client, scope: Scope): Promise<{ marks: ReconnectMark[]; available: boolean }> {
  const result: any = await client.from('contact_reconnect_marks').select('contacted_id,state,until')
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).limit(5000);
  if (result.error?.code === MISSING_TABLE) return { marks: [], available: false };
  if (result.error) throw new ReconnectError('No pudimos revisar tus avisos para retomar.', 503);
  return { available: true, marks: (result.data || []).map((row: any) => ({ contactedId: row.contacted_id, state: row.state, until: row.until })) };
}

/** What the workspace found this month in «Oportunidades»: a company hiring or a buyer publishing is a reason to write. */
async function readSignals(client: Client, scope: Scope, now: Date): Promise<ReconnectSignal[]> {
  const since = new Date(now.getTime() - RECONNECT_SIGNAL_WINDOW_DAYS * DAY).toISOString();
  const result: any = await client.from('commercial_opportunities').select('kind,title,company_name,company_domain,buyer_name,first_seen_at,status')
    .eq('organization_id', scope.organizationId).gte('first_seen_at', since).neq('status', 'dismissed').limit(2000);
  // Without «Oportunidades» there are no signals; the alerts still work.
  if (result.error) return [];
  return (result.data || []).map((row: any) => ({
    company: row.kind === 'hiring' ? row.company_name : (row.buyer_name || row.company_name),
    domain: row.company_domain || null,
    title: String(row.title || '').trim(),
    kind: row.kind as ReconnectSignalKind,
    seenAt: row.first_seen_at,
  })).filter((signal: ReconnectSignal) => signal.title);
}

async function readSettings(client: Client, scope: Scope) {
  const result: any = await client.from('profiles').select('signatures').eq('id', scope.userId).maybeSingle();
  return reconnectSettings(result.data?.signatures?.reconnect);
}

/** «Para retomar» for one person in one workspace. */
export async function readReconnectAlerts(client: Client, scope: Scope, now = new Date()) {
  const [rows, marks, signals, settings] = await Promise.all([
    readRows(client, scope), readMarks(client, scope), readSignals(client, scope, now), readSettings(client, scope),
  ]);
  const alerts = buildReconnectAlerts({ rows, marks: marks.marks, signals, settings, now });
  return { alerts: alerts.slice(0, 50), total: alerts.length, afterDays: settings.afterClosedDays, canPostpone: marks.available };
}

/** «Posponer» (30 days by default), «No retomar» (for good) or undo either. Only the owner of the conversation. */
export async function markReconnect(client: Client, scope: Scope, input: { contactedId: string; action: 'snooze' | 'dismiss' | 'restore'; days?: number }, now = new Date()) {
  const own = await readRows(client, scope, input.contactedId);
  if (!own.length) throw new ReconnectError('No encontramos esa conversación.', 404);
  const key = { organization_id: scope.organizationId, user_id: scope.userId, contacted_id: input.contactedId };
  if (input.action === 'restore') {
    const removed: any = await client.from('contact_reconnect_marks').delete()
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).eq('contacted_id', input.contactedId);
    if (removed.error) throw new ReconnectError('No pudimos deshacerlo. Intenta de nuevo.', 503);
    return { contactedId: input.contactedId, state: null, until: null };
  }
  const days = Math.min(180, Math.max(1, Math.round(input.days || 30)));
  const until = input.action === 'snooze' ? new Date(now.getTime() + days * DAY).toISOString() : null;
  const state = input.action === 'snooze' ? 'snoozed' : 'dismissed';
  const saved: any = await client.from('contact_reconnect_marks')
    .upsert({ ...key, state, until, updated_at: now.toISOString() }, { onConflict: 'user_id,contacted_id' });
  if (saved.error?.code === MISSING_TABLE) throw new ReconnectError('Posponer aún no está disponible en esta organización.', 503);
  if (saved.error) throw new ReconnectError('No pudimos guardarlo. Intenta de nuevo.', 503);
  return { contactedId: input.contactedId, state, until };
}

/** «Avisarme después de»: 30, 60 or 90 days, or 0 for never. Kept with the person's other preferences. */
export async function saveReconnectSettings(client: Client, scope: Scope, afterDays: number) {
  if (afterDays !== 0 && !(RECONNECT_AFTER_CHOICES as readonly number[]).includes(afterDays)) throw new ReconnectError('Elige 30, 60 o 90 días.', 400);
  const current: any = await client.from('profiles').select('signatures').eq('id', scope.userId).maybeSingle();
  if (current.error) throw new ReconnectError('No pudimos guardar tu preferencia.', 503);
  const signatures = current.data?.signatures && typeof current.data.signatures === 'object' ? current.data.signatures : {};
  const saved: any = await client.from('profiles').update({ signatures: { ...signatures, reconnect: { afterDays } } }).eq('id', scope.userId);
  if (saved.error) throw new ReconnectError('No pudimos guardar tu preferencia.', 503);
  return { afterDays };
}

export type ReconnectDraftDependencies = {
  findSnapshot: (scope: Scope, leadId: string) => Promise<string | null>;
  createDraft: (input: { organizationId: string; userId: string; snapshotId: string; userInstruction: string; idempotencyKey: string })
    => Promise<{ status: string; draft?: { draftId: string }; message?: string }>;
};

/**
 * «Retomar»: a new email with a different angle, written by the same writer as any first email (its checks, the
 * person's offer and style, and the research of the contact), told why now and what not to repeat. It opens in
 * «Redactar» to review and send; nothing is sent here. A contact without research is sent to research first.
 */
export async function prepareReconnectDraft(client: Client, scope: Scope, contactedId: string, deps: ReconnectDraftDependencies, now = new Date()) {
  const rows = await readRows(client, scope);
  const target = rows.find(row => row.id === contactedId);
  if (!target) throw new ReconnectError('No encontramos esa conversación.', 404);
  const context = reconnectContextFor(rows, contactedId, await readSignals(client, scope, now), now);
  if (!context) throw new ReconnectError('A esta persona no se le vuelve a escribir: no quiso más correos o el correo rebotó.', 409);
  if (!target.lead_id) return { status: 'needs_research' as const, leadId: null };
  const snapshotId = await deps.findSnapshot(scope, target.lead_id);
  if (!snapshotId) return { status: 'needs_research' as const, leadId: target.lead_id };
  const day = now.toISOString().slice(0, 10);
  const result = await deps.createDraft({
    organizationId: scope.organizationId, userId: scope.userId, snapshotId,
    userInstruction: reconnectInstruction(context, target.subject),
    // Pressing twice the same day opens the same draft.
    idempotencyKey: `reconnect:${contactedId}:${day}`,
  });
  if (result.status !== 'drafted' || !result.draft?.draftId) {
    throw new ReconnectError(result.message || 'No pudimos preparar el correo. Revisa la investigación del contacto e intenta de nuevo.', 409);
  }
  return { status: 'drafted' as const, draftId: result.draft.draftId };
}
