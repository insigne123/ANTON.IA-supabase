import { z } from 'zod';

const terms = z.array(z.string().trim().min(1).max(100)).max(12).default([]);
export const AudienceCriteriaSchema = z.object({
  relationship: z.enum(['never_contacted', 'previously_contacted']),
  titles: terms, industries: terms, countries: terms,
  sizes: terms, seniorities: terms,
  minimumDaysSinceSent: z.number().int().min(0).max(3650),
  excludeReplied: z.boolean(),
}).strict();
export type AudienceCriteria = z.infer<typeof AudienceCriteriaSchema>;
export const defaultAudience: AudienceCriteria = {
  relationship: 'never_contacted', titles: [], industries: [], countries: [],
  sizes: [], seniorities: [],
  minimumDaysSinceSent: 0, excludeReplied: true,
};
export const CampaignMessageSchema = z.object({
  subject: z.string().trim().min(1, 'Escribe un asunto.').max(300),
  body: z.string().trim().min(1, 'Escribe el correo.').max(12000),
  delayDays: z.number().int().min(0).max(90),
}).strict();
export const CampaignInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000),
  objective: z.string().trim().max(2000),
  criteria: AudienceCriteriaSchema,
  emails: z.array(z.string().trim().email().transform(v => v.toLowerCase())).min(1).max(100),
  messages: z.array(CampaignMessageSchema).min(1).max(5),
  provider: z.enum(['google', 'outlook']),
  overrides: z.array(z.object({
    email: z.string().trim().email().transform(value => value.toLowerCase()),
    messageIndex: z.number().int().min(0).max(4),
    subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(12000),
  }).strict()).max(500).default([]),
}).strict().superRefine((value, ctx) => {
  const overrideKeys = new Set<string>();
  for (const override of value.overrides) {
    const key = `${override.email}:${override.messageIndex}`;
    if (!value.emails.includes(override.email) || override.messageIndex >= value.messages.length || overrideKeys.has(key)) {
      ctx.addIssue({ code: 'custom', path: ['overrides'], message: 'Una edición individual no corresponde a la audiencia o está duplicada.' });
    }
    overrideKeys.add(key);
  }
  if (new Set(value.emails).size !== value.emails.length) ctx.addIssue({ code: 'custom', path: ['emails'], message: 'Hay destinatarios duplicados.' });
  value.messages.forEach((message, index) => {
    if ((index === 0 && message.delayDays !== 0) || (index > 0 && message.delayDays < 1)) {
      ctx.addIssue({ code: 'custom', path: ['messages', index, 'delayDays'], message: 'El primer correo es inmediato; los seguimientos esperan al menos un día.' });
    }
  });
});
export type CampaignInput = z.infer<typeof CampaignInputSchema>;
export type CampaignMessage = z.infer<typeof CampaignMessageSchema>;
export const AudienceSearchSchema = z.object({
  criteria: AudienceCriteriaSchema,
  search: z.string().trim().max(200).default(''),
  page: z.number().int().min(0).max(1000).default(0),
  pageSize: z.number().int().min(5).max(100).default(25),
}).strict();
export type AudienceSearch = z.infer<typeof AudienceSearchSchema>;
export const AudienceProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  criteria: AudienceCriteriaSchema,
}).strict();
export type AudienceProfile = { id: string; name: string; criteria: AudienceCriteria; created_at: string };
export type AudiencePerson = {
  email: string; name: string; company: string; title: string; industry: string; country: string;
  size: string; seniority: string;
  leadRef: string; lastSentAt: string | null; contacted: boolean; replied: boolean;
  blockedReason: string | null; reasons: string[];
};
export type CampaignRecipient = AudiencePerson & {
  messages: Array<CampaignMessage & { draftId: string; versionId: string }>;
};
export type BulkCampaign = {
  id: string; organization_id: string; user_id: string; revision: number;
  status: 'draft' | 'rejected' | 'approved' | 'paused';
  definition: CampaignInput; recipients: CampaignRecipient[]; review_hash: string;
  approved_at: string | null; created_at: string; updated_at: string;
};
export type CampaignDelivery = { draft_id: string; status: string; completed_at: string | null; error_message: string | null };

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export function matchAudience(person: AudiencePerson, criteria: AudienceCriteria, now = Date.now()): string[] | null {
  if (criteria.relationship === 'never_contacted' ? person.contacted : !person.contacted) return null;
  if (criteria.excludeReplied && person.replied) return null;
  const reasons = [person.contacted ? 'Contactado anteriormente' : 'Sin envíos registrados'];
  for (const [field, choices, label] of [
    [person.title, criteria.titles, 'Cargo'], [person.industry, criteria.industries, 'Industria'],
    [person.country, criteria.countries, 'País'], [person.size, criteria.sizes, 'Tamaño'],
    [person.seniority, criteria.seniorities, 'Antigüedad'],
  ] as const) {
    if (!choices.length) continue;
    const matched = choices.find(term => field && normalize(field).includes(normalize(term)));
    if (!matched) return null; // Missing evidence is never a match.
    reasons.push(`${label}: ${field}`);
  }
  if (criteria.relationship === 'previously_contacted' && criteria.minimumDaysSinceSent > 0) {
    const timestamp = person.lastSentAt ? Date.parse(person.lastSentAt) : NaN;
    if (!Number.isFinite(timestamp) || now - timestamp < criteria.minimumDaysSinceSent * 86400000) return null;
    reasons.push(`Último envío hace ${Math.floor((now - timestamp) / 86400000)} días`);
  }
  return reasons;
}

/** Plain text only. React renders previews as text; the sender builds escaped HTML. */
export function renderCampaignMessage(message: CampaignMessage, person: AudiencePerson): CampaignMessage {
  const values: Record<string, string> = { nombre: person.name.split(/\s+/)[0] || '', empresa: person.company, cargo: person.title };
  const render = (text: string) => text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`La variable {{${key}}} no está disponible. Usa nombre, empresa o cargo.`);
    if (!values[key]) throw new Error(`Falta ${key} para ${person.email}. Ajusta el mensaje o la audiencia.`);
    return values[key];
  });
  const result = { ...message, subject: render(message.subject), body: render(message.body) };
  if (/[\r\n]/.test(result.subject) || /\{\{|\}\}/.test(result.subject + result.body)) throw new Error('Revisa el asunto y las variables del correo.');
  return CampaignMessageSchema.parse(result);
}

const LOCKED_DELIVERY_STATES = new Set(['sent', 'pending', 'sending', 'unknown', 'failed']);

/** Messages with a confirmed, in-flight or failed delivery are locked; only untouched or deferred ones can be revised. */
export function isCampaignMessageLocked(draftId: string, deliveries: CampaignDelivery[]): boolean {
  const delivery = deliveries.find(row => row.draft_id === draftId);
  return Boolean(delivery && LOCKED_DELIVERY_STATES.has(delivery.status));
}

export type CampaignHistoryEvent = {
  at: string | null;
  kind: 'campaign_sent' | 'campaign_waiting' | 'campaign_attention' | 'contacted' | 'reply' | 'dispatch';
  label: string;
  detail: string | null;
};

/** Unified per-recipient timeline: campaign messages, deliveries, attempts and legacy contact history. */
export function buildRecipientHistory(input: {
  recipient: CampaignRecipient;
  deliveries: CampaignDelivery[];
  attempts?: Array<{ draft_id: string; state: string; message: string; retry_at: string | null }>;
  contactedRows?: Array<{ status: string | null; sent_at: string | null; replied_at: string | null; subject: string | null }>;
  approvedAt: string | null;
  now?: number;
}): CampaignHistoryEvent[] {
  const events: CampaignHistoryEvent[] = [];
  const now = input.now ?? Date.now();
  for (const row of input.contactedRows || []) {
    if (row.sent_at) events.push({ at: row.sent_at, kind: 'contacted', label: 'Correo anterior', detail: row.subject });
    if (row.replied_at) events.push({ at: row.replied_at, kind: 'reply', label: 'Respondió', detail: null });
  }
  input.recipient.messages.forEach((message, index) => {
    const delivery = input.deliveries.find(row => row.draft_id === message.draftId);
    const attempt = (input.attempts || []).find(row => row.draft_id === message.draftId);
    const label = index === 0 ? 'Correo inicial de campaña' : `Seguimiento ${index} de campaña`;
    if (delivery?.status === 'sent' && delivery.completed_at) {
      events.push({ at: delivery.completed_at, kind: 'campaign_sent', label, detail: message.subject });
    } else if (delivery && delivery.status !== 'deferred') {
      events.push({ at: null, kind: delivery.status === 'unknown' ? 'campaign_attention' : 'campaign_attention', label, detail: delivery.error_message || attempt?.message || null });
    } else if (attempt && attempt.state !== 'sent') {
      events.push({ at: null, kind: 'campaign_attention', label, detail: attempt.message });
    } else if (input.approvedAt) {
      const previous = index ? input.deliveries.find(row => row.draft_id === input.recipient.messages[index - 1].draftId) : null;
      const base = previous?.completed_at || input.approvedAt;
      const dueAt = new Date(Date.parse(base) + message.delayDays * 86400000).toISOString();
      events.push({ at: dueAt, kind: 'campaign_waiting', label, detail: Date.parse(dueAt) <= now ? 'Listo para enviar' : null });
    }
  });
  return events.sort((a, b) => {
    if (!a.at && !b.at) return 0;
    if (!a.at) return 1;
    if (!b.at) return -1;
    return Date.parse(b.at) - Date.parse(a.at);
  });
}

export function nextCampaignMessage(recipient: CampaignRecipient, deliveries: CampaignDelivery[], approvedAt: string, now = Date.now()) {
  for (let index = 0; index < recipient.messages.length; index++) {
    const message = recipient.messages[index];
    const delivery = deliveries.find(row => row.draft_id === message.draftId);
    if (delivery?.status === 'sent') continue;
    if (delivery && delivery.status !== 'deferred') return { index, message, state: delivery.status, dueAt: null };
    const previous = index ? deliveries.find(row => row.draft_id === recipient.messages[index - 1].draftId) : null;
    if (index && (previous?.status !== 'sent' || !previous.completed_at)) return { index, message, state: 'waiting', dueAt: null };
    const dueAt = new Date(Date.parse(previous?.completed_at || approvedAt) + message.delayDays * 86400000).toISOString();
    return { index, message, dueAt, state: Date.parse(dueAt) <= now ? 'ready' : 'waiting' };
  }
  return null;
}
