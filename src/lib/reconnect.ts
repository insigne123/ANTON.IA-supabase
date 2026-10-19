/**
 * «Para retomar» (propuesta 7, 19 oct 2026): people worth writing to again, from what is already in the person's
 * conversations. A conversation closed as «Sin acuerdo» or «Lo retomo yo», or one that went quiet, comes back after a
 * while; a new signal from that company (it is hiring, it published a tender) brings it back sooner. «No interesado»,
 * a won deal, a bounce or an unsubscribe never come back. Pure: the route reads, this decides.
 */

export type ReconnectRow = {
  id: string;
  lead_id?: string | null;
  email: string | null;
  name: string | null;
  company: string | null;
  role?: string | null;
  subject?: string | null;
  sent_at: string | null;
  last_follow_up_at?: string | null;
  conversation_outbound_at?: string | null;
  replied_at: string | null;
  reply_intent: string | null;
  conversation_resolved_at: string | null;
  conversation_close_outcome?: string | null;
  evaluation_status?: string | null;
  campaign_followup_reason?: string | null;
  bounced_at?: string | null;
  status?: string | null;
};

export type ReconnectSignalKind = 'hiring' | 'tender' | 'compra_agil' | 'project';
export type ReconnectSignal = { company: string | null; domain: string | null; title: string; kind: ReconnectSignalKind; seenAt: string };
export type ReconnectMark = { contactedId: string; state: 'snoozed' | 'dismissed'; until: string | null };
export type ReconnectKind = 'closed' | 'kept' | 'quiet' | 'no_reply' | 'signal';

export type ReconnectAlert = {
  contactedId: string;
  leadId: string | null;
  name: string;
  company: string;
  kind: ReconnectKind;
  /** One line: why now, in plain words. */
  reason: string;
  /** The last time either side wrote. */
  lastContactAt: string;
  daysSince: number;
  signal?: { kind: ReconnectSignalKind; title: string };
};

export type ReconnectSettings = { afterClosedDays: number; afterQuietDays: number };

/** «Avisarme después de»: the choices of the card; 0 turns the alerts off. */
export const RECONNECT_AFTER_CHOICES = [30, 60, 90] as const;
export const RECONNECT_DEFAULTS: ReconnectSettings = { afterClosedDays: 60, afterQuietDays: 45 };
/** A signal brings someone back after this many days without contact, not before: nobody wants two emails in a week. */
export const RECONNECT_SIGNAL_MIN_DAYS = 14;
/** Signals older than this are not news. */
export const RECONNECT_SIGNAL_WINDOW_DAYS = 30;

const DAY = 86_400_000;
const NEVER_INTENTS = new Set(['negative', 'unsubscribe', 'delivery_failure']);
const FREE_MAIL = new Set(['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'live.com', 'icloud.com', 'msn.com', 'yahoo.es', 'hotmail.es', 'outlook.es']);

/** The settings saved by the person (profiles.signatures.reconnect), clamped to the choices of the card. */
export function reconnectSettings(saved: unknown): ReconnectSettings {
  const value = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
  const after = Number(value.afterDays);
  if (after === 0) return { afterClosedDays: 0, afterQuietDays: 0 };
  const chosen = (RECONNECT_AFTER_CHOICES as readonly number[]).includes(after) ? after : RECONNECT_DEFAULTS.afterClosedDays;
  return { afterClosedDays: chosen, afterQuietDays: Math.min(chosen, RECONNECT_DEFAULTS.afterQuietDays) };
}

/** «Grupo Expro SpA» and «grupoexpro» are the same company. */
export function companyKey(value: string | null | undefined) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/\b(s\.?\s?p\.?\s?a|s\.?\s?a|ltda|limitada|e\.?i\.?r\.?l|sociedad|anonima|chile|spa)\b\.?/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

/** The company domain of a work email; none for personal mailboxes. */
export function emailDomain(email: string | null | undefined) {
  const domain = String(email || '').trim().toLowerCase().split('@')[1] || '';
  return domain && !FREE_MAIL.has(domain) ? domain.replace(/^www\./, '') : null;
}

const time = (value: string | null | undefined) => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** The last time either side wrote in this conversation. */
export function lastContactAt(row: ReconnectRow) {
  return Math.max(time(row.sent_at), time(row.last_follow_up_at), time(row.conversation_outbound_at), time(row.replied_at));
}

/** Never again: «No interesado», a won deal, a bounce, an unsubscribe or a negative answer. */
export function neverReconnect(row: ReconnectRow) {
  return !String(row.email || '').trim()
    || row.evaluation_status === 'do_not_contact'
    || row.campaign_followup_reason === 'not_interested'
    || row.conversation_close_outcome === 'not_interested'
    || row.conversation_close_outcome === 'won'
    || Boolean(row.bounced_at)
    || ['failed', 'bounced'].includes(String(row.status || ''))
    || NEVER_INTENTS.has(String(row.reply_intent || ''));
}

/** An answer still waiting for the person is in «Lo que te espera», not here. */
function waitingForAnswer(row: ReconnectRow) {
  if (!row.replied_at || ['auto_reply', ...NEVER_INTENTS].includes(String(row.reply_intent || ''))) return false;
  return time(row.replied_at) > Math.max(time(row.conversation_resolved_at), time(row.conversation_outbound_at));
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

const SIGNAL_WORDS: Record<ReconnectSignalKind, string> = {
  hiring: 'está contratando',
  tender: 'publicó una licitación',
  compra_agil: 'publicó una Compra Ágil',
  project: 'tiene un proyecto de inversión',
};

function findSignal(row: ReconnectRow, signals: ReconnectSignal[], nowMs: number) {
  const key = companyKey(row.company);
  const domain = emailDomain(row.email);
  return signals
    .filter(signal => nowMs - time(signal.seenAt) <= RECONNECT_SIGNAL_WINDOW_DAYS * DAY)
    .filter(signal => (domain && signal.domain && signal.domain.toLowerCase().replace(/^www\./, '') === domain)
      || (key.length >= 4 && companyKey(signal.company) === key))
    .sort((a, b) => time(b.seenAt) - time(a.seenAt))[0] || null;
}

/** The alerts for one person, one per email address, signals first and then the longest waiting. */
export function buildReconnectAlerts(input: {
  rows: ReconnectRow[];
  marks?: ReconnectMark[];
  signals?: ReconnectSignal[];
  settings?: ReconnectSettings;
  now: Date;
}): ReconnectAlert[] {
  const settings = input.settings || RECONNECT_DEFAULTS;
  const nowMs = input.now.getTime();
  const hidden = new Set((input.marks || [])
    .filter(mark => mark.state === 'dismissed' || time(mark.until) > nowMs)
    .map(mark => mark.contactedId));
  // The most recent conversation with each address speaks for it: an older one closed as «Sin acuerdo» does not
  // bring back someone who answered last week.
  const latest = new Map<string, ReconnectRow>();
  for (const row of input.rows) {
    const email = String(row.email || '').trim().toLowerCase();
    if (!email) continue;
    const current = latest.get(email);
    if (!current || lastContactAt(row) > lastContactAt(current)) latest.set(email, row);
  }
  const blocked = new Set(input.rows.filter(neverReconnect).map(row => String(row.email || '').trim().toLowerCase()));

  const alerts: ReconnectAlert[] = [];
  for (const [email, row] of latest) {
    if (blocked.has(email) || hidden.has(row.id) || waitingForAnswer(row)) continue;
    const last = lastContactAt(row);
    if (!last) continue;
    const daysSince = Math.floor((nowMs - last) / DAY);
    const base = {
      contactedId: row.id, leadId: row.lead_id || null, name: String(row.name || '').trim() || email,
      company: String(row.company || '').trim(), lastContactAt: new Date(last).toISOString(), daysSince,
    };
    const signal = settings.afterClosedDays > 0 && daysSince >= RECONNECT_SIGNAL_MIN_DAYS ? findSignal(row, input.signals || [], nowMs) : null;
    if (signal) {
      const who = base.company || 'Su empresa';
      alerts.push({ ...base, kind: 'signal', signal: { kind: signal.kind, title: signal.title },
        reason: `${who} ${SIGNAL_WORDS[signal.kind]}: «${signal.title.slice(0, 120)}». Hablaron hace ${plural(daysSince, 'día', 'días')}.` });
      continue;
    }
    const closed = time(row.conversation_resolved_at) > 0 && time(row.conversation_resolved_at) >= time(row.replied_at);
    if (closed) {
      if (settings.afterClosedDays <= 0 || daysSince < settings.afterClosedDays) continue;
      const kept = row.conversation_close_outcome === 'keep';
      alerts.push({ ...base, kind: kept ? 'kept' : 'closed',
        reason: kept
          ? `La dejaste en «Lo retomo yo» hace ${plural(daysSince, 'día', 'días')}.`
          : `Cerraste sin acuerdo hace ${plural(daysSince, 'día', 'días')}. Las prioridades cambian: vale la pena preguntar de nuevo.` });
      continue;
    }
    if (settings.afterQuietDays <= 0 || daysSince < settings.afterQuietDays) continue;
    alerts.push(row.replied_at
      ? { ...base, kind: 'quiet', reason: `Te respondió, le contestaste y no volvió a escribir. Han pasado ${plural(daysSince, 'día', 'días')}.` }
      : { ...base, kind: 'no_reply', reason: `Le escribiste hace ${plural(daysSince, 'día', 'días')} y no respondió.` });
  }
  return alerts.sort((a, b) => Number(b.kind === 'signal') - Number(a.kind === 'signal') || b.daysSince - a.daysSince);
}

/** What the writer is told about this conversation, so the new email does not repeat the old one. */
export function reconnectInstruction(alert: Pick<ReconnectAlert, 'kind' | 'daysSince' | 'signal'>, subject?: string | null) {
  const previous = subject ? ` sobre «${String(subject).replace(/^(re:\s*)+/i, '').slice(0, 120)}»` : '';
  const since = `hace ${plural(alert.daysSince, 'día', 'días')}`;
  const situation = alert.kind === 'signal' && alert.signal
    ? `Hay algo nuevo en su empresa: ${SIGNAL_WORDS[alert.signal.kind]} («${alert.signal.title.slice(0, 160)}»). Úsalo como la razón para escribir hoy, sin decir cómo lo supiste más allá de que es público.`
    : alert.kind === 'closed' ? 'La conversación terminó sin acuerdo.'
      : alert.kind === 'kept' ? 'Quedamos en retomarlo más adelante.'
        : alert.kind === 'quiet' ? 'Respondió una vez y la conversación se enfrió.'
          : 'No respondió a los correos anteriores.';
  return (`Este correo retoma el contacto con alguien a quien ya le escribimos ${since}${previous}. ${situation} `
    + 'Escribe un correo nuevo y breve con un ángulo distinto al anterior: no repitas la propuesta ni el asunto, no culpes ni insistas '
    + '(nada de «solo quería hacer seguimiento» o «no he tenido respuesta»), nombra con naturalidad que ha pasado un tiempo y termina con '
    + 'una sola pregunta fácil de responder.').slice(0, 1000);
}

/**
 * Why to write to one conversation now, whatever the waiting time: «Retomar» can be pressed from the alert or from the
 * conversation itself. Null for the people who are never written to again.
 */
export function reconnectContextFor(rows: ReconnectRow[], contactedId: string, signals: ReconnectSignal[], now: Date) {
  const target = rows.find(row => row.id === contactedId);
  if (!target) return null;
  const email = String(target.email || '').trim().toLowerCase();
  if (rows.some(row => String(row.email || '').trim().toLowerCase() === email && neverReconnect(row))) return null;
  const alert = buildReconnectAlerts({ rows: [target], signals, settings: { afterClosedDays: 1, afterQuietDays: 1 }, now })[0];
  if (alert) return alert;
  const last = lastContactAt(target);
  return last ? { contactedId, kind: 'no_reply' as ReconnectKind, daysSince: Math.max(0, Math.floor((now.getTime() - last) / DAY)) } : null;
}
