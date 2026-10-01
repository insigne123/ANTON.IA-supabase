import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LINKEDIN_JOB_EXPIRY_DAYS, LINKEDIN_MESSAGE_MAX } from './linkedin-bridge';
import { companyKeysFor } from './send-cadence';

/**
 * Invitations or messages for several people on LinkedIn, approved with one decision («aprobar en lote»). Only the rules live
 * here: what the model may propose, who goes today and who waits, the hash of the list and how the result reads. The server
 * checks each person again (server/cowork/linkedin-batch.ts) and the extension runs each job in the person's browser.
 */

export type CoworkLinkedinBatchKind = 'invite' | 'message';
export const LINKEDIN_BATCH_INVITES_MAX = 25;
export const LINKEDIN_BATCH_MESSAGES_MAX = 15;

/** The effect kinds of the two batches, as the approval queue names them. */
export const COWORK_LINKEDIN_BATCH_EFFECT = { invite: 'linkedin_invite_batch', message: 'linkedin_message_batch' } as const;
export const coworkLinkedinBatchKindOf = (effectKind: unknown): CoworkLinkedinBatchKind | null =>
  effectKind === 'linkedin_invite_batch' ? 'invite' : effectKind === 'linkedin_message_batch' ? 'message' : null;

/** linkedin.invite_batch / linkedin.message_batch: the saved contacts observed in this thread, and for messages the text each one gets. */
export const coworkLinkedinBatchSchema = z.object({
  leads: z.array(z.object({
    leadId: z.string().uuid(),
    message: z.string().trim().min(1).max(LINKEDIN_MESSAGE_MAX).nullable().optional(),
  }).strict()).min(1).max(LINKEDIN_BATCH_INVITES_MAX),
}).strict();
export type CoworkLinkedinBatchInput = z.infer<typeof coworkLinkedinBatchSchema>;

/** The people of a proposal, checked against what its kind needs. Throws in the words the model can pass on. */
export function coworkLinkedinBatchLeads(kind: CoworkLinkedinBatchKind, input: unknown): Array<{ leadId: string; message: string | null }> {
  const parsed = coworkLinkedinBatchSchema.parse(input);
  const ids = parsed.leads.map(lead => lead.leadId);
  if (new Set(ids).size !== ids.length) throw new Error('Hay personas repetidas en el lote: cada una va una sola vez.');
  if (kind === 'invite') {
    if (parsed.leads.some(lead => lead.message)) throw new Error('Las invitaciones van sin nota: quita el texto de cada persona, o propón un lote de mensajes.');
    return parsed.leads.map(lead => ({ leadId: lead.leadId, message: null }));
  }
  if (parsed.leads.length > LINKEDIN_BATCH_MESSAGES_MAX) throw new Error(`Un lote de mensajes lleva hasta ${LINKEDIN_BATCH_MESSAGES_MAX} personas: propón el resto en otro lote.`);
  if (parsed.leads.some(lead => !lead.message)) throw new Error('Cada persona de un lote de mensajes necesita su propio texto.');
  return parsed.leads.map(lead => ({ leadId: lead.leadId, message: lead.message! }));
}

/** The keys that say two people are of the same company (send-cadence), without the empty ones: someone whose company is unknown stands alone. */
export function coworkBatchCompanyKeys(person: { id: string; email?: string | null; company?: string | null }): string[] {
  const keys = companyKeysFor(String(person.email || ''), person.company).keys.filter(key => key !== 'email:');
  return keys.length ? keys : [`lead:${person.id}`];
}

export type CoworkLinkedinBatchItem = {
  id: string; name: string | null; company: string | null; title: string | null; canonicalUrl: string;
  /** Messages only: the text this person gets. Invitations carry no such key at all. */
  message?: string;
};
export type CoworkLinkedinBatchDeferred = { id: string; name: string | null; company: string | null; reason: string };

export type CoworkLinkedinBatchCandidate = CoworkLinkedinBatchItem & {
  /** Keys of the company of this person (coworkBatchCompanyKeys). */
  keys: string[];
  /** Why the guards of a single action stop this person, when they do. */
  blocked?: string | null;
};

export const COWORK_BATCH_REASON = {
  companyToday: 'Ya hay una acción para esa empresa hoy (correo o LinkedIn): una empresa por día.',
  companyInBatch: 'Otra persona de esa empresa va hoy en este lote: una empresa por día.',
  quota: 'El cupo semanal de invitaciones ya está cubierto.',
} as const;

/**
 * Who goes today and who waits, in the order given. A person the guards of a single action stop waits with that reason; one
 * company a day, counting what already went out today by email or LinkedIn and the people of this same batch; and invitations
 * only up to what is left of the weekly quota. Nobody is dropped silently: each person who does not go says why.
 */
export function planLinkedinBatch(kind: CoworkLinkedinBatchKind, candidates: CoworkLinkedinBatchCandidate[],
  options: { quotaLeft?: number | null; companiesToday?: ReadonlySet<string> } = {}) {
  const today = options.companiesToday ?? new Set<string>();
  const taken = new Set<string>();
  const items: CoworkLinkedinBatchItem[] = [];
  const deferred: CoworkLinkedinBatchDeferred[] = [];
  for (const { keys, blocked, ...item } of candidates) {
    const wait = (reason: string) => deferred.push({ id: item.id, name: item.name, company: item.company, reason });
    if (blocked) wait(blocked);
    else if (keys.some(key => today.has(key))) wait(COWORK_BATCH_REASON.companyToday);
    else if (keys.some(key => taken.has(key))) wait(COWORK_BATCH_REASON.companyInBatch);
    else if (kind === 'invite' && options.quotaLeft !== null && options.quotaLeft !== undefined && items.length >= options.quotaLeft) wait(COWORK_BATCH_REASON.quota);
    else {
      items.push(kind === 'message' ? item : { id: item.id, name: item.name, company: item.company, title: item.title, canonicalUrl: item.canonicalUrl });
      for (const key of keys) taken.add(key);
    }
  }
  return { items, deferred };
}

/** What the approval binds: the run, the kind and, for each person, who, which profile and which text. Names are for the card only. */
export function hashCoworkLinkedinBatch(runId: string, kind: CoworkLinkedinBatchKind, items: Array<Pick<CoworkLinkedinBatchItem, 'id' | 'canonicalUrl' | 'message'>>) {
  return createHash('sha256')
    .update(JSON.stringify(['cowork|linkedin-batch', runId, kind, items.map(item => [item.id, item.canonicalUrl, item.message ?? null])])).digest('hex');
}

export const coworkLinkedinBatchLabel = (kind: CoworkLinkedinBatchKind, count: number) =>
  `${kind === 'invite' ? 'Invitar a' : 'Escribir a'} ${count} ${count === 1 ? 'persona' : 'personas'} en LinkedIn`;

export type CoworkLinkedinBatchResult = { id: string; name: string | null; status: 'queued' | 'reused' | 'skipped' | 'removed'; reason?: string };

/** The reply after running a batch: counts first, then what each person that did not go needs to be told. */
/**
 * How a queued LinkedIn job goes out, in steps the person can follow: nothing is sent by itself. The extension runs it on the
 * profile's own page (Plan 5, PR-8; docs/linkedin-prueba-guiada.md).
 */
export function coworkLinkedinRunSteps(what: string, profileUrl?: string | null) {
  const open = profileUrl ? `abre su perfil (${profileUrl})` : 'abre cada perfil en LinkedIn';
  return `Para enviar ${what}: ${open}, abre la extensión de ANTON.IA, toca «Consultar trabajos» y luego «Ejecutar». Nada sale solo; vence en ${LINKEDIN_JOB_EXPIRY_DAYS} días si no lo ejecutas.`;
}

export function coworkLinkedinBatchSummary(kind: CoworkLinkedinBatchKind, results: CoworkLinkedinBatchResult[]) {
  const count = (status: CoworkLinkedinBatchResult['status']) => results.filter(result => result.status === status).length;
  const queued = count('queued') + count('reused');
  const noun = kind === 'invite' ? 'invitaciones' : 'mensajes';
  const left = count('skipped');
  const removed = count('removed');
  return `Quedaron listas ${queued} de ${results.length} ${noun}.${queued ? ` ${coworkLinkedinRunSteps(kind === 'invite' ? 'cada invitación' : 'cada mensaje')}` : ''}`
    + `${left ? ` ${left === 1 ? '1 no salió' : `${left} no salieron`}: el motivo está en cada persona.` : ''}${removed ? ` ${removed === 1 ? 'Quitaste a 1 persona' : `Quitaste a ${removed} personas`} de la lista.` : ''}`;
}
