/** Pure stage-7 builders: rates with explicit denominators, hypothesis tests
 * without invented causality, channel comparison that refuses to generalize,
 * and systemic-failure detection. No I/O; readers supply rows. */

export const HUMAN_REPLY_EXCLUDED = ['auto_reply', 'delivery_failure'] as const;
export const POSITIVE_INTENTS = ['positive', 'meeting_request'] as const;
export const MIN_SEGMENT_N = 10;
export const BOUNCE_ALERT_THRESHOLD = 0.02;

export type MetricsContactRow = {
  id: string;
  sent_at?: string | null;
  replied_at?: string | null;
  reply_intent?: string | null;
  bounced_at?: string | null;
  delivery_status?: string | null;
  provider?: string | null;
  evaluation_status?: string | null;
  conversation_outbound_at?: string | null;
};

export type Rate = {
  value: number | null;
  numerator: number;
  denominator: number;
  unit: 'per_contact';
  period: string;
  source: string;
};

function rate(numerator: number, denominator: number, period: string, source: string): Rate {
  return { value: denominator > 0 ? numerator / denominator : null, numerator, denominator, unit: 'per_contact', period, source };
}

function inWindow(at: string | null | undefined, startMs: number, nowMs: number) {
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) && ms >= startMs && ms <= nowMs;
}

export type PeriodRates = {
  period: string;
  days: number;
  sent: number;
  humanReplies: number;
  positives: number;
  meetingsRequested: number;
  autoReplies: number;
  bounces: number;
  unsubscribed: number;
  meetingsConfirmed: number;
  rates: { reply: Rate; positive: Rate; meeting: Rate; bounce: Rate; unsubscribe: Rate };
};

export function assembleRates(input: {
  contacts: MetricsContactRow[];
  unsubscribedAt: Array<string | null | undefined>;
  meetingsAt: Array<string | null | undefined>;
  nowMs?: number;
}): { last_7_days: PeriodRates; last_30_days: PeriodRates } {
  const nowMs = input.nowMs ?? Date.now();
  const build = (days: number): PeriodRates => {
    const period = days === 7 ? 'last_7_days' : 'last_30_days';
    const startMs = nowMs - days * 24 * 60 * 60 * 1000;
    const sent = input.contacts.filter((row) => inWindow(row.sent_at, startMs, nowMs)).length;
    const humanReplies = input.contacts.filter((row) =>
      inWindow(row.replied_at, startMs, nowMs) && !(HUMAN_REPLY_EXCLUDED as readonly string[]).includes(String(row.reply_intent || ''))).length;
    const positives = input.contacts.filter((row) =>
      inWindow(row.replied_at, startMs, nowMs) && (POSITIVE_INTENTS as readonly string[]).includes(String(row.reply_intent || ''))).length;
    const meetingsRequested = input.contacts.filter((row) =>
      inWindow(row.replied_at, startMs, nowMs) && String(row.reply_intent || '') === 'meeting_request').length;
    const autoReplies = input.contacts.filter((row) =>
      inWindow(row.replied_at, startMs, nowMs) && String(row.reply_intent || '') === 'auto_reply').length;
    const bounces = input.contacts.filter((row) => inWindow(row.bounced_at, startMs, nowMs)).length;
    const unsubscribed = input.unsubscribedAt.filter((at) => inWindow(at, startMs, nowMs)).length;
    const meetingsConfirmed = input.meetingsAt.filter((at) => inWindow(at, startMs, nowMs)).length;
    return {
      period, days, sent, humanReplies, positives, meetingsRequested, autoReplies, bounces, unsubscribed, meetingsConfirmed,
      rates: {
        reply: rate(humanReplies, sent, period, 'contacted_leads'),
        positive: rate(positives, sent, period, 'contacted_leads'),
        meeting: rate(meetingsConfirmed, sent, period, 'contacted_leads:data.commitment'),
        bounce: rate(bounces, sent, period, 'contacted_leads'),
        unsubscribe: rate(unsubscribed, sent, period, 'unsubscribed_emails'),
      },
    };
  };
  return { last_7_days: build(7), last_30_days: build(30) };
}

export function extractMeetingCompletions(rows: Array<{ data?: { commitment?: { kind?: string; completedAt?: string | null } | null } | null }>): Array<string | null> {
  return rows
    .map((row) => row.data?.commitment)
    .filter((commitment) => commitment?.kind === 'meeting' && commitment.completedAt)
    .map((commitment) => commitment!.completedAt ?? null);
}

export type HypothesisVerdict = 'supported' | 'contradicted' | 'inconclusive' | 'untestable';
export type Hypothesis = {
  id: string;
  claim: string;
  verdict: HypothesisVerdict;
  evidence: Record<string, number | string | null>;
  warning: string | null;
};

const CORRELATION_WARNING = 'Correlación observada, no causa demostrada.';

export function diagnoseHypotheses(input: { contacts: MetricsContactRow[]; stalledPositives: number; nowMs?: number }): Hypothesis[] {
  const nowMs = input.nowMs ?? Date.now();
  const startMs = nowMs - 30 * 24 * 60 * 60 * 1000;
  const sent = input.contacts.filter((row) => inWindow(row.sent_at, startMs, nowMs));
  const bounces = input.contacts.filter((row) => inWindow(row.bounced_at, startMs, nowMs)).length;
  const bounceRate = sent.length > 0 ? bounces / sent.length : null;
  const auto = input.contacts.filter((row) => inWindow(row.replied_at, startMs, nowMs) && String(row.reply_intent || '') === 'auto_reply').length;
  const human = input.contacts.filter((row) =>
    inWindow(row.replied_at, startMs, nowMs) && !(HUMAN_REPLY_EXCLUDED as readonly string[]).includes(String(row.reply_intent || ''))).length;
  const positives = input.contacts.filter((row) =>
    inWindow(row.replied_at, startMs, nowMs) && (POSITIVE_INTENTS as readonly string[]).includes(String(row.reply_intent || ''))).length;

  const hypotheses: Hypothesis[] = [];
  hypotheses.push({
    id: 'deliverability',
    claim: 'La entregabilidad limita las respuestas.',
    verdict: bounceRate === null || sent.length < MIN_SEGMENT_N ? 'inconclusive'
      : bounceRate > BOUNCE_ALERT_THRESHOLD ? 'supported' : 'contradicted',
    evidence: { sent: sent.length, bounces, bounceRate, threshold: BOUNCE_ALERT_THRESHOLD, minSegment: MIN_SEGMENT_N },
    warning: CORRELATION_WARNING,
  });
  hypotheses.push({
    id: 'auto_noise',
    claim: 'Las automáticas inflan el total de respuestas.',
    verdict: human + auto === 0 ? 'inconclusive' : auto / (human + auto) > 0.2 ? 'supported' : 'contradicted',
    evidence: { human, auto, autoShare: human + auto > 0 ? auto / (human + auto) : null },
    warning: CORRELATION_WARNING,
  });
  const byProvider: Record<string, { sent: number; replies: number }> = {};
  for (const row of sent) {
    const provider = String(row.provider || 'unknown');
    byProvider[provider] = byProvider[provider] || { sent: 0, replies: 0 };
    byProvider[provider].sent += 1;
    if (inWindow(row.replied_at, startMs, nowMs) && !(HUMAN_REPLY_EXCLUDED as readonly string[]).includes(String(row.reply_intent || ''))) {
      byProvider[provider].replies += 1;
    }
  }
  const providers = Object.entries(byProvider);
  const comparable = providers.length >= 2 && providers.every(([, stats]) => stats.sent >= MIN_SEGMENT_N);
  const providerRates = providers.map(([, stats]) => stats.replies / stats.sent);
  const gap = comparable ? Math.max(...providerRates) - Math.min(...providerRates) : null;
  hypotheses.push({
    id: 'provider_gap',
    claim: 'Un proveedor rinde peor que el otro.',
    verdict: !comparable || gap === null ? 'inconclusive' : gap >= 0.03 ? 'supported' : 'contradicted',
    evidence: { ...Object.fromEntries(providers.map(([provider, stats]) =>
      [provider, `${stats.replies}/${stats.sent}`])) as Record<string, string>, gap, gapThreshold: 0.03, minSegment: MIN_SEGMENT_N },
    warning: comparable ? 'La brecha describe segmentos, no prueba que el proveedor sea la causa.' : `Se exigen ${MIN_SEGMENT_N} envíos por proveedor en 30 días; con menos, cualquier brecha es ruido.`,
  });
  hypotheses.push({
    id: 'followup_gap',
    claim: 'Hay interés sin seguimiento que explica reuniones perdidas.',
    verdict: positives === 0 ? 'inconclusive' : input.stalledPositives > 0 ? 'supported' : 'contradicted',
    evidence: { positives, stalled: input.stalledPositives },
    warning: CORRELATION_WARNING,
  });
  hypotheses.push({
    id: 'message_length',
    claim: 'El largo del mensaje explica el bajo rendimiento.',
    verdict: 'untestable',
    evidence: { reason: 'no_length_outcome_link' },
    warning: 'No hay vínculo entre largo de borrador y respuesta por contacto; no se puede probar ni descartar con estos datos.',
  });
  return hypotheses;
}

export type ChannelBlock = {
  channel: 'email' | 'linkedin';
  period: string;
  sent: number;
  replies: number;
  positives: number;
  meetings: number;
  pending: number;
  sources: string[];
};

export function compareChannels(input: { email: ChannelBlock; linkedin: ChannelBlock }): {
  email: ChannelBlock; linkedin: ChannelBlock;
  verdict: 'not_comparable' | 'comparable_with_cautions';
  reasons: string[];
  attribution: { rule: string; gaps: string[] };
} {
  const reasons: string[] = [];
  if (input.linkedin.sent === 0) reasons.push('linkedin_sin_envios_confirmados');
  if (input.email.sent < MIN_SEGMENT_N) reasons.push('email_muestra_pequena');
  if (input.linkedin.sent > 0 && input.linkedin.sent < MIN_SEGMENT_N) reasons.push('linkedin_muestra_pequena');
  reasons.push('audiencias_distintas_no_verificadas');
  const comparable = reasons.filter((reason) => reason !== 'audiencias_distintas_no_verificadas').length === 0
    && input.email.sent >= MIN_SEGMENT_N && input.linkedin.sent >= MIN_SEGMENT_N;
  return {
    email: input.email, linkedin: input.linkedin,
    verdict: comparable ? 'comparable_with_cautions' : 'not_comparable',
    reasons,
    attribution: {
      rule: 'Una reunión se atribuye al canal del último entrante antes del compromiso; sin entrante vinculado, la atribución queda sin verificar.',
      gaps: ['linkedin_sin_hilo_vinculado_a_compromiso', 'respuestas_fuera_de_app_no_observadas'],
    },
  };
}

export type IncidentCheck = {
  check: string;
  severity: 'high' | 'medium' | 'info';
  found: number;
  total: number;
  items: Array<Record<string, unknown>>;
  action: string;
};

const PENDING_STEP_STATES = ['not_due', 'approved', 'review_required', 'deferred', 'pending_initial_send'];

export function detectIncidents(input: {
  steps: Array<{ id: string; enrollment_id?: string | null; state?: string | null; due_at?: string | null }>;
  enrollments: Array<{ id: string; recipient_email?: string | null; status?: string | null }>;
  contactsByEmail: Map<string, { replied_at?: string | null; evaluation_status?: string | null }>;
  unclassified: Array<{ id: string; name?: string | null; email?: string | null; replied_at?: string | null }>;
  sweepErrors: Array<{ provider: string; last_error: string | null }>;
  syncErrorCounts: Array<{ state: string; count: number }>;
  openExceptions: Array<{ id: string; title?: string | null; category?: string | null; severity?: string | null }>;
}): IncidentCheck[] {
  const enrollmentById = new Map(input.enrollments.map((enrollment) => [enrollment.id, enrollment]));
  const repliedEmails = new Set([...input.contactsByEmail.entries()].filter(([, contact]) => contact.replied_at).map(([email]) => email));
  const doNotContactEmails = new Set([...input.contactsByEmail.entries()].filter(([, contact]) => contact.evaluation_status === 'do_not_contact').map(([email]) => email));

  const stepsForReplied = input.steps
    .filter((step) => PENDING_STEP_STATES.includes(String(step.state || '')))
    .map((step) => ({ step, email: String(enrollmentById.get(String(step.enrollment_id || ''))?.recipient_email || '').toLowerCase() }))
    .filter(({ email }) => email && repliedEmails.has(email))
    .slice(0, 10);

  const activeForDoNotContact = input.enrollments
    .filter((enrollment) => enrollment.status === 'active' && doNotContactEmails.has(String(enrollment.recipient_email || '').toLowerCase()))
    .slice(0, 10)
    .map((enrollment) => ({ enrollmentId: enrollment.id, email: enrollment.recipient_email }));

  return [
    {
      check: 'steps_scheduled_for_replied', severity: 'high',
      found: stepsForReplied.length, total: input.steps.length,
      items: stepsForReplied.map(({ step, email }) => ({ stepId: step.id, email, state: step.state })),
      action: 'Detener o reprogramar: un contacto con respuesta no debe recibir toques automáticos.',
    },
    {
      check: 'active_enrollments_do_not_contact', severity: 'high',
      found: activeForDoNotContact.length, total: input.enrollments.filter((enrollment) => enrollment.status === 'active').length,
      items: activeForDoNotContact,
      action: 'Detener la inscripción: la evaluación vigente prohíbe contactar.',
    },
    {
      check: 'unclassified_backlog', severity: 'medium',
      found: input.unclassified.length, total: input.unclassified.length,
      items: input.unclassified.slice(0, 10),
      action: 'Clasificar para que el turno y las tasas reflejen la realidad.',
    },
    {
      check: 'sweep_errors', severity: 'medium',
      found: input.sweepErrors.length, total: input.sweepErrors.length,
      items: input.sweepErrors,
      action: 'Revisar la conexión del buzón; el barrido reanuda solo.',
    },
    {
      check: 'sync_error_states', severity: 'info',
      found: input.syncErrorCounts.reduce((sum, row) => sum + row.count, 0), total: input.syncErrorCounts.reduce((sum, row) => sum + row.count, 0),
      items: input.syncErrorCounts,
      action: 'Los estados con enfriamiento se reintentan solos; connection_required pide reconectar.',
    },
    {
      check: 'open_exceptions', severity: 'info',
      found: input.openExceptions.length, total: input.openExceptions.length,
      items: input.openExceptions.slice(0, 10),
      action: 'Atender por severidad desde la cola de excepciones.',
    },
  ];
}
