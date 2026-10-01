/**
 * «¿Les está sirviendo?» for an organization's admin: who is set up to sell, who needs a hand, and what came back
 * (real replies, interest, meetings) against the previous period. Pure functions; the reads live in
 * src/lib/server/admin-value-data.ts.
 */

export type MemberSignals = {
  userId: string;
  name: string;
  email: string;
  role: string;
  invitedAt: string | null;
  lastSignInAt: string | null;
  lastActivityAt: string | null;
  mailConnected: boolean;
  profileReady: boolean;
  hasSent: boolean;
};

export type AdoptionStep = { id: 'invited' | 'signed_in' | 'active' | 'mail' | 'first_send'; label: string; value: number };

export type AdoptionSummary = {
  members: number;
  active7: number;
  active30: number;
  neverSignedIn: number;
  profileReady: number;
  funnel: AdoptionStep[];
};

export type HelpReason = 'never_signed_in' | 'no_mail' | 'no_profile' | 'inactive' | 'no_send';

export type HelpItem = {
  userId: string;
  name: string;
  email: string;
  reason: HelpReason;
  title: string;
  detail: string;
  /** What the admin can do from the panel: copy a message to send from their own mail, or open the person. */
  action: 'copy_invite' | 'copy_mail_reminder' | 'copy_profile_reminder' | 'open_person';
};

export type ReplyBreakdown = {
  /** Replies from a person: everything except automatic answers and bounces. */
  real: number;
  meeting: number;
  positive: number;
  neutral: number;
  negative: number;
  unsubscribe: number;
  automatic: number;
  bounced: number;
};

export type ResultsSnapshot = {
  sent: number;
  replies: ReplyBreakdown;
  /** Asked for a meeting or answered with interest. */
  interested: number;
  pipelineMeetings: number;
  savedContacts: number;
  researched: number;
};

export type MetricComparison = { value: number; previous: number; delta: number; trend: 'up' | 'down' | 'flat' };

const DAY_MS = 86_400_000;
export const INACTIVE_DAYS = 14;

function time(value: string | null | undefined) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/** The last time we know the person used the app: a sign-in or any recorded activity. */
export function lastSeenAt(member: Pick<MemberSignals, 'lastSignInAt' | 'lastActivityAt'>) {
  const values = [time(member.lastSignInAt), time(member.lastActivityAt)].filter((value): value is number => value !== null);
  return values.length > 0 ? Math.max(...values) : null;
}

function seenWithin(member: MemberSignals, days: number, now: Date) {
  const seen = lastSeenAt(member);
  return seen !== null && now.getTime() - seen <= days * DAY_MS;
}

export function buildAdoption(members: MemberSignals[], now = new Date()): AdoptionSummary {
  const signedIn = members.filter((member) => lastSeenAt(member) !== null);
  return {
    members: members.length,
    active7: members.filter((member) => seenWithin(member, 7, now)).length,
    active30: members.filter((member) => seenWithin(member, 30, now)).length,
    neverSignedIn: members.length - signedIn.length,
    profileReady: members.filter((member) => member.profileReady).length,
    funnel: [
      { id: 'invited', label: 'Invitadas', value: members.length },
      { id: 'signed_in', label: 'Entraron alguna vez', value: signedIn.length },
      { id: 'active', label: 'Activas en 30 días', value: members.filter((member) => seenWithin(member, 30, now)).length },
      { id: 'mail', label: 'Con correo conectado', value: members.filter((member) => member.mailConnected).length },
      { id: 'first_send', label: 'Enviaron su primer correo', value: members.filter((member) => member.hasSent).length },
    ],
  };
}

const REASON_ORDER: HelpReason[] = ['never_signed_in', 'no_mail', 'no_profile', 'inactive', 'no_send'];

function helpFor(member: MemberSignals, now: Date): Omit<HelpItem, 'userId' | 'name' | 'email'> | null {
  const seen = lastSeenAt(member);
  if (seen === null) {
    return { reason: 'never_signed_in', title: 'Nunca ha entrado', detail: 'Recibió la invitación, pero aún no inicia sesión.', action: 'copy_invite' };
  }
  if (!member.mailConnected) {
    return { reason: 'no_mail', title: 'Sin correo conectado', detail: 'No puede enviar desde su cuenta hasta conectar Gmail u Outlook.', action: 'copy_mail_reminder' };
  }
  if (!member.profileReady) {
    return { reason: 'no_profile', title: 'Perfil sin oferta', detail: 'Sin empresa ni oferta, la IA escribe correos genéricos.', action: 'copy_profile_reminder' };
  }
  const idleDays = Math.floor((now.getTime() - seen) / DAY_MS);
  if (idleDays >= INACTIVE_DAYS) {
    return { reason: 'inactive', title: `Sin actividad hace ${idleDays} días`, detail: 'Tiene todo listo, pero dejó de usar la app.', action: 'open_person' };
  }
  if (!member.hasSent) {
    return { reason: 'no_send', title: 'Aún no envía su primer correo', detail: 'Tiene correo y perfil listos: le falta el primer envío.', action: 'open_person' };
  }
  return null;
}

/** One line per person who is stuck, with the most blocking reason first: without a sign-in, nothing else matters. */
export function needsHelp(members: MemberSignals[], now = new Date()): HelpItem[] {
  return members
    .flatMap((member) => {
      const help = helpFor(member, now);
      return help ? [{ userId: member.userId, name: member.name, email: member.email, ...help }] : [];
    })
    .sort((left, right) => REASON_ORDER.indexOf(left.reason) - REASON_ORDER.indexOf(right.reason) || left.name.localeCompare(right.name, 'es'));
}

const INTENT_BUCKET: Record<string, keyof Omit<ReplyBreakdown, 'real'>> = {
  meeting_request: 'meeting',
  positive: 'positive',
  neutral: 'neutral',
  negative: 'negative',
  unsubscribe: 'unsubscribe',
  auto_reply: 'automatic',
  delivery_failure: 'bounced',
  bounce: 'bounced',
};

/** Replies by intent. An unclassified reply counts as neutral: a person answered, we just do not know how yet. */
export function classifyReplies(rows: Array<{ reply_intent?: string | null }>): ReplyBreakdown {
  const breakdown: ReplyBreakdown = { real: 0, meeting: 0, positive: 0, neutral: 0, negative: 0, unsubscribe: 0, automatic: 0, bounced: 0 };
  for (const row of rows) {
    const bucket = INTENT_BUCKET[String(row.reply_intent || '').trim().toLowerCase()] || 'neutral';
    breakdown[bucket] += 1;
    if (bucket !== 'automatic' && bucket !== 'bounced') breakdown.real += 1;
  }
  return breakdown;
}

export function compareMetric(value: number, previous: number): MetricComparison {
  const delta = value - previous;
  return { value, previous, delta, trend: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' };
}

export function compareResults(current: ResultsSnapshot, previous: ResultsSnapshot) {
  return {
    sent: compareMetric(current.sent, previous.sent),
    replies: compareMetric(current.replies.real, previous.replies.real),
    interested: compareMetric(current.interested, previous.interested),
    pipelineMeetings: compareMetric(current.pipelineMeetings, previous.pipelineMeetings),
    savedContacts: compareMetric(current.savedContacts, previous.savedContacts),
    researched: compareMetric(current.researched, previous.researched),
  };
}

export function replyRate(snapshot: ResultsSnapshot) {
  return snapshot.sent > 0 ? Math.round((snapshot.replies.real / snapshot.sent) * 1000) / 10 : 0;
}

function firstName(name: string) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

/** Text the admin copies and sends from their own mail or chat: the panel never sends anything by itself. */
export function helpMessage(item: Pick<HelpItem, 'name' | 'email' | 'action'>, origin: string, organizationName: string) {
  const hello = firstName(item.name) ? `Hola, ${firstName(item.name)}:` : 'Hola:';
  if (item.action === 'copy_invite') {
    return `${hello} te invitamos a ANTON.IA, donde ${organizationName} busca prospectos y les escribe con ayuda de IA. Entra en ${origin}/login con tu correo ${item.email}. El recorrido inicial toma 2 minutos.`;
  }
  if (item.action === 'copy_mail_reminder') {
    return `${hello} para enviar correos desde ANTON.IA con tu propia cuenta, conecta Gmail u Outlook en ${origin}/connections. Toma un minuto y las respuestas vuelven solas a la app.`;
  }
  if (item.action === 'copy_profile_reminder') {
    return `${hello} completa tu empresa y lo que ofreces en ${origin}/profile. Con eso la IA escribe correos a tu medida en vez de genéricos.`;
  }
  return '';
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const YES_NO = (value: boolean) => (value ? 'Sí' : 'No');

/** People and their setup, one row each, for a spreadsheet (UTF-8 with BOM so Excel keeps the accents). */
export function adoptionCsv(members: MemberSignals[], now = new Date()) {
  const header = ['Persona', 'Correo', 'Rol', 'Último uso', 'Correo conectado', 'Perfil con oferta', 'Primer envío', 'Qué le falta'];
  const rows = members.map((member) => {
    const seen = lastSeenAt(member);
    return [
      member.name,
      member.email,
      member.role,
      seen === null ? 'Nunca' : new Date(seen).toISOString().slice(0, 10),
      YES_NO(member.mailConnected),
      YES_NO(member.profileReady),
      YES_NO(member.hasSent),
      helpFor(member, now)?.title || 'Nada',
    ];
  });
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** The step where most people stop, to tell the admin where to push first. Null when nobody is lost. */
export function biggestDrop(funnel: AdoptionStep[]): { from: AdoptionStep; to: AdoptionStep; lost: number } | null {
  let best: { from: AdoptionStep; to: AdoptionStep; lost: number } | null = null;
  for (let index = 1; index < funnel.length; index += 1) {
    const lost = funnel[index - 1].value - funnel[index].value;
    if (lost > 0 && (!best || lost > best.lost)) best = { from: funnel[index - 1], to: funnel[index], lost };
  }
  return best;
}
