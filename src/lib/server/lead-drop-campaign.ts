import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { CampaignInputSchema, defaultAudience } from '@/lib/bulk-campaigns';
import { dropCampaignMessages, dropName, dropSchedule, type DropItem } from '@/lib/lead-drops';
import { deterministicMessagingUuid } from '@/lib/messaging-contracts';
import { MAIL_PROVIDER_LABEL } from '@/lib/mail-sender';
import { AuthError, type AuthContext } from '@/lib/server/auth-utils';
import { reviewBulkCampaign, saveBulkCampaign } from '@/lib/server/bulk-campaigns';
import { LeadDropsError, readDrop, type DropScope } from '@/lib/server/lead-drops';
import { readMailSenderPreference } from '@/lib/server/mail-sender-preference';

/**
 * What a person does with a contact of their «Contacto del día» besides saving it (12 Nov 2026, docs/contacto-del-dia.md): change its
 * emails, say whether it is useful to them, and approve its campaign. «Aprobar y programar» makes a campaign of one person with the
 * first email and its follow-ups, as «Campañas» would, and starts it from the mailbox that sends (Gmail or Outlook, the one chosen
 * in «Conexiones»): the first email goes out with the next send run, each follow-up so many days after the one before, and all stop
 * at a reply, an unsubscribe or a bounce, as every campaign does.
 */

type Client = SupabaseClient;
const text = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const emailSchema = z.object({ subject: z.string().trim().min(1, 'Escribe un asunto.').max(200), body: z.string().trim().min(1, 'Escribe el correo.').max(4000) }).strict();
export const dropEmailsSchema = z.object({ draft: emailSchema, followUps: z.array(emailSchema).max(6) }).strict();
export const dropFeedbackSchema = z.object({ useful: z.boolean(), reason: z.string().trim().max(160).nullable().optional() }).strict();

async function itemOf(client: Client, scope: DropScope, dropId: string, leadId: string) {
  const drop = await readDrop(client, scope, dropId);
  const item = drop.items.find(entry => entry.leadId === leadId);
  if (!item) throw new LeadDropsError('No encontramos ese contacto.', 404);
  return { drop, item };
}
async function writeItem(client: Client, dropId: string, items: DropItem[], leadId: string, change: (item: DropItem) => DropItem) {
  const next = items.map(entry => entry.leadId === leadId ? change(entry) : entry);
  const written = await client.from('lead_drops').update({ items: next, updated_at: new Date().toISOString() }).eq('id', dropId);
  if (written.error) throw new LeadDropsError('No pudimos guardar el cambio. Inténtalo de nuevo.', 503);
  return next;
}

/**
 * The person's own text for the first email and its follow-ups. Only subjects and bodies change: how many there are and the day of
 * each stay. Once the campaign is approved the emails are the campaign's, and are changed there.
 */
export async function editDropEmails(client: Client, scope: DropScope, dropId: string, leadId: string, input: unknown) {
  const edit = dropEmailsSchema.safeParse(input);
  if (!edit.success) throw new LeadDropsError(edit.error.issues[0]?.message || 'Revisa los correos.', 400);
  const { drop, item } = await itemOf(client, scope, dropId, leadId);
  if (item.campaign) throw new LeadDropsError('Esta campaña ya está aprobada: sus correos se cambian en «Campañas».', 409);
  const steps = item.followUps || [];
  if (!item.draft || edit.data.followUps.length !== steps.length) throw new LeadDropsError('Los correos cambiaron. Vuelve a abrir el contacto.', 409);
  const items = await writeItem(client, dropId, drop.items, leadId, entry => ({
    ...entry, draft: edit.data.draft, edited: true,
    ...(steps.length ? { followUps: steps.map((step, index) => ({ day: step.day, ...edit.data.followUps[index] })) } : {}),
  }));
  return { items };
}

/** «Me sirve» or «No me sirve», with the reason when the person gives one: what the finder learns from (lead-drop-finder.ts, dropLessons). */
export async function saveDropFeedback(client: Client, scope: DropScope, dropId: string, leadId: string, input: unknown, now = new Date()) {
  const feedback = dropFeedbackSchema.safeParse(input);
  if (!feedback.success) throw new LeadDropsError('Solicitud no válida.', 400);
  const { drop } = await itemOf(client, scope, dropId, leadId);
  const items = await writeItem(client, dropId, drop.items, leadId, entry => ({
    ...entry, feedback: { useful: feedback.data.useful, reason: text(feedback.data.reason, 160) || null, at: now.toISOString() },
  }));
  return { items };
}

export type ApproveDeps = {
  save?: typeof saveBulkCampaign; review?: typeof reviewBulkCampaign;
  mailbox?: (client: Client, userId: string) => Promise<{ resolved: 'google' | 'outlook' | null }>;
  enabled?: boolean; now?: Date;
};

/**
 * «Aprobar y programar»: the contact's emails become a campaign of one person and it starts. Asked twice, it answers the campaign
 * it already made. Needs the contact in «Por escribir» with its email (after «Enriquecer») and a connected mailbox.
 */
export async function approveDropCampaign(auth: Pick<AuthContext, 'supabase' | 'user' | 'organizationId'>, client: Client, dropId: string, leadId: string, deps: ApproveDeps = {}) {
  const scope = { organizationId: auth.organizationId, userId: String(auth.user.id) };
  const now = deps.now ?? new Date();
  const { drop, item } = await itemOf(client, scope, dropId, leadId);
  const answer = (items: DropItem[], campaign: NonNullable<DropItem['campaign']>) => ({ items, campaign, provider: MAIL_PROVIDER_LABEL[campaign.provider],
    schedule: dropSchedule(item, new Date(campaign.approvedAt)) });
  if (item.campaign) return answer(drop.items, item.campaign);
  if (!(deps.enabled ?? process.env.BULK_CAMPAIGNS_ENABLED === 'true')) throw new LeadDropsError('Las campañas no están habilitadas en esta cuenta.', 409);
  const messages = dropCampaignMessages(item);
  if (!messages.length) throw new LeadDropsError('Este contacto no tiene un correo escrito. Escríbele desde «Por escribir».', 409);
  if (!item.savedLeadId) throw new LeadDropsError('Primero enriquece el contacto: necesitamos su correo para programar la campaña.', 409);
  const saved: any = await client.from('enriched_leads').select('id,email').eq('id', item.savedLeadId).eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle();
  if (saved.error) throw new LeadDropsError('No pudimos leer el contacto.', 503);
  const email = String(saved.data?.email || '').trim().toLowerCase();
  if (!email) throw new LeadDropsError('Este contacto todavía no tiene correo. Búscalo desde «Por escribir» y vuelve.', 409);
  const mailbox = await (deps.mailbox ?? readMailSenderPreference)(client, scope.userId);
  if (!mailbox.resolved) throw new LeadDropsError('Conecta Gmail u Outlook en «Conexiones», o elige con cuál envías, para programar la campaña.', 409);
  const who = [dropName(item), item.company].filter(Boolean).join(' · ');
  const definition = CampaignInputSchema.safeParse({
    name: text(`Contacto del día · ${who}`, 120), description: 'Un contacto recomendado, con su primer correo y sus seguimientos.',
    objective: text(`Primer contacto con ${[item.title, item.company].filter(Boolean).join(' de ') || who}.`, 400),
    criteria: defaultAudience, emails: [email], messages, provider: mailbox.resolved, overrides: [],
  });
  if (!definition.success) throw new LeadDropsError('Revisa los correos: falta un asunto o un texto.', 400);
  const authContext = { ...auth, organizationIds: [auth.organizationId] } as AuthContext;
  let campaignId: string;
  try {
    // The same contact of the same drop is always the same campaign: a second click, or a retry after a timeout, finds it.
    const created = await (deps.save ?? saveBulkCampaign)(authContext, definition.data, undefined, 0, deterministicMessagingUuid(`lead-drop:${dropId}:${leadId}:campaign`));
    campaignId = String(created.id);
    if (created.status !== 'approved') {
      await (deps.review ?? reviewBulkCampaign)(authContext, campaignId, { action: 'approve', revision: created.revision, reviewHash: created.review_hash });
    }
  } catch (error) {
    // What the campaign says of the recipient or of a variable is said as it is («… ya no está disponible para esta audiencia», «Falta nombre para …»).
    if (error instanceof AuthError) throw new LeadDropsError(error.message, error.status);
    if (error instanceof Error && /^(Falta |La variable |Revisa el asunto)/.test(error.message)) throw new LeadDropsError(error.message, 422);
    throw new LeadDropsError('No pudimos programar la campaña. Inténtalo de nuevo.', 503);
  }
  const campaign = { id: campaignId, provider: mailbox.resolved, approvedAt: now.toISOString() };
  const items = await writeItem(client, dropId, drop.items, leadId, entry => ({ ...entry, campaign }));
  return answer(items, campaign);
}
