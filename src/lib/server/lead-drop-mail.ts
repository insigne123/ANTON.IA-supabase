import type { SupabaseClient } from '@supabase/supabase-js';
import { enrichmentRefusalMessage } from '@/lib/apollo-credit-allocation';
import { needsLookup, type DropItem } from '@/lib/lead-drops';
import { MAIL_PROVIDER_LABEL } from '@/lib/mail-sender';
import { AuthError, type AuthContext } from '@/lib/server/auth-utils';
import { getBulkCampaign, reviewBulkCampaign } from '@/lib/server/bulk-campaigns';
import { readDropLink } from '@/lib/server/lead-drop-link';
import { LeadDropsError, keepDropLead, linkDropLead, readDrop, type DropScope } from '@/lib/server/lead-drops';
import { readMailSenderPreference } from '@/lib/server/mail-sender-preference';

/**
 * «Contacto del día» used from the person's inbox, without signing in (13 Nov 2026, docs/contacto-del-dia.md). The emails of a drop
 * of several contacts link to a page of its own (src/app/contactos/[token]) with a signed link (lead-drop-link.ts); there each
 * button does on the server what the app does from the browser: look a contact's email up (1 credit, the same lookup and the same
 * quota), change the emails, approve the campaign from their Gmail or Outlook, and stop it. The link acts as the drop's own person,
 * for that drop only, while they are still on the team.
 */

type Client = SupabaseClient;
const LOOKUP_TIMEOUT_MS = 100_000;
/** A lookup that never answered is given up for after this long: the next one is a new operation. */
const LOOKUP_STALE_MS = 15 * 60_000;

/** The member a link acts as, with the service client: every read and write below names their user and their team. */
export const linkAuth = (client: Client, scope: DropScope) =>
  ({ user: { id: scope.userId }, organizationId: scope.organizationId, organizationIds: [scope.organizationId], supabase: client }) as unknown as AuthContext;

/** The drop and the person a link is for. An expired link says so (410); anything else is not found. */
export async function resolveDropLink(client: Client, token: unknown, now = new Date()): Promise<{ dropId: string; scope: DropScope; expiresAt: Date }> {
  const link = readDropLink(token, { now });
  if (link === 'expired') throw new LeadDropsError('Este enlace venció. Abre el correo más reciente de tus contactos.', 410);
  if (!link) throw new LeadDropsError('Este enlace no es válido.', 404);
  const row: any = await client.from('lead_drops').select('id,user_id,organization_id,status').eq('id', link.dropId).maybeSingle();
  if (row.error) throw new LeadDropsError('No pudimos abrir tus contactos. Inténtalo de nuevo.', 503);
  if (!row.data || !['ready', 'sent'].includes(row.data.status)) throw new LeadDropsError('Este enlace ya no está disponible.', 404);
  const scope = { organizationId: String(row.data.organization_id), userId: String(row.data.user_id) };
  const member: any = await client.from('organization_members').select('organization_id').eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (member.error) throw new LeadDropsError('No pudimos abrir tus contactos. Inténtalo de nuevo.', 503);
  if (!member.data) throw new LeadDropsError('Este enlace ya no está disponible.', 404);
  return { dropId: link.dropId, scope, expiresAt: link.expiresAt };
}

/** What the page shows: the contacts, the address of each one already looked up, and the mailbox the campaigns leave from. */
export type MailDropView = { date: string; items: DropItem[]; emails: Record<string, string>; mailbox: string | null };

export async function mailDropView(client: Client, scope: DropScope, dropId: string): Promise<MailDropView> {
  const drop = await readDrop(client, scope, dropId);
  const saved = drop.items.map(item => item.savedLeadId).filter((id): id is string => Boolean(id));
  const [rows, mailbox]: [any, { resolved: 'google' | 'outlook' | null }] = await Promise.all([
    saved.length ? client.from('enriched_leads').select('id,email').in('id', saved).eq('organization_id', scope.organizationId).eq('user_id', scope.userId) : { data: [] },
    readMailSenderPreference(client, scope.userId).catch(() => ({ resolved: null })),
  ]);
  const byId = new Map<string, string>(((rows.data || []) as Array<{ id: unknown; email: unknown }>).map(row => [String(row.id), String(row.email || '').trim().toLowerCase()]));
  const emails: Record<string, string> = {};
  for (const item of drop.items) {
    const email = item.savedLeadId ? byId.get(item.savedLeadId) : '';
    if (email) emails[item.leadId] = email;
  }
  return { date: drop.drop_date, items: drop.items, emails, mailbox: mailbox.resolved ? MAIL_PROVIDER_LABEL[mailbox.resolved] : null };
}

/** Read again, then change one contact: another button may have written the drop meanwhile. */
async function patchItem(client: Client, scope: DropScope, dropId: string, leadId: string, change: (item: DropItem) => DropItem) {
  const fresh = await readDrop(client, scope, dropId);
  const items = fresh.items.map(entry => entry.leadId === leadId ? change(entry) : entry);
  const written = await client.from('lead_drops').update({ items, updated_at: new Date().toISOString() }).eq('id', dropId);
  if (written.error) throw new LeadDropsError('No pudimos guardar el cambio. Inténtalo de nuevo.', 503);
}

const internalBaseUrl = (env: Record<string, string | undefined>) =>
  [env.CANONICAL_APP_URL, env.NEXT_PUBLIC_APP_URL, env.NEXT_PUBLIC_BASE_URL, env.APP_URL].map(value => String(value || '').trim().replace(/\/$/, '')).find(Boolean) || '';
const domainOf = (website: unknown) => {
  const raw = String(website || '').trim();
  if (!raw) return undefined;
  try { return new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.replace(/^www\./, '') || undefined; } catch { return undefined; }
};

export type EnrichDeps = { fetch?: typeof fetch; baseUrl?: string; internalSecret?: string; now?: Date };
export type EnrichOutcome = {
  /** `found`: its email is here. `pending`: the provider is still looking, it lands by itself. `not_found`: searched, nothing. */
  outcome: 'found' | 'pending' | 'not_found';
  email: string | null;
  /** Credits this lookup used: none when it found nothing or repeated one already made. */
  consumed: number;
};

/**
 * «Enriquecer» from the inbox: the contact is kept, its email looked up and the contact tied to the drop, as the app does in three
 * steps from the browser. The lookup is the app's own route, asked by the server as that member (same quota, same share of the
 * team's credits, same record), under an operation named after the drop and the contact: a second tap while the first is still
 * out repeats that operation and pays nothing. Only a lookup that ended without an email, or failed, or never answered, lets the
 * next tap start a new one.
 */
export async function enrichDropLead(client: Client, scope: DropScope, dropId: string, leadId: string, deps: EnrichDeps = {}): Promise<EnrichOutcome> {
  const now = deps.now ?? new Date();
  const drop = await readDrop(client, scope, dropId);
  const item = drop.items.find(entry => entry.leadId === leadId);
  if (!item) throw new LeadDropsError('No encontramos ese contacto.', 404);
  if (item.savedLeadId) return { outcome: 'found', email: null, consumed: 0 };
  if (!needsLookup(item)) throw new LeadDropsError('Este contacto ya trae su correo: guárdalo.', 409);
  const baseUrl = (deps.baseUrl ?? internalBaseUrl(process.env)).replace(/\/$/, '');
  const secret = (deps.internalSecret ?? String(process.env.INTERNAL_API_SECRET || '')).trim();
  if (!baseUrl || !secret) throw new LeadDropsError('No pudimos buscar su correo ahora. Inténtalo más tarde.', 503);

  const kept = await keepDropLead(linkAuth(client, scope), client, dropId, leadId, now);
  if (kept.savedLeadId || !kept.keptLeadId) return { outcome: 'found', email: null, consumed: 0 };
  const saved: any = await client.from('leads').select('id,name,company,company_website,linkedin_url')
    .eq('id', kept.keptLeadId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (saved.error || !saved.data) throw new LeadDropsError('No pudimos buscar su correo ahora. Inténtalo de nuevo.', 503);

  const stale = item.lookup && now.getTime() - Date.parse(item.lookup.at) > LOOKUP_STALE_MS;
  const attempt = (item.lookup?.attempt ?? 0) + (stale ? 1 : 0);
  await patchItem(client, scope, dropId, leadId, entry => ({ ...entry, lookup: { attempt, at: now.toISOString() } }));
  /** This lookup is over without an email: the next tap is a new operation. */
  const close = (missed: boolean) => patchItem(client, scope, dropId, leadId, entry => entry.savedLeadId ? entry
    : { ...entry, lookup: { attempt: attempt + 1, at: now.toISOString(), ...(missed ? { missed: true } : {}) } }).catch(() => undefined);

  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(`${baseUrl}/api/opportunities/enrich-apollo`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json', 'Idempotency-Key': `lead-drop:${dropId}:${leadId}:email:${attempt}`,
        'x-user-id': scope.userId, 'x-organization-id': scope.organizationId, 'x-internal-api-secret': secret,
      },
      body: JSON.stringify({
        leads: [{
          fullName: String(saved.data.name || item.name || ''), linkedinUrl: saved.data.linkedin_url || undefined, companyName: saved.data.company || item.company || undefined,
          companyDomain: domainOf(saved.data.company_website) ?? item.domain ?? undefined, clientRef: String(saved.data.id), id: String(saved.data.id), sourceProviderId: leadId,
        }],
        revealEmail: true, revealPhone: false, tableName: 'enriched_leads',
      }),
    });
  } catch {
    // No answer: the lookup may still be running. The same operation is asked again by the next tap, and found if it finished.
    throw new LeadDropsError('La búsqueda tarda más de lo normal. Vuelve a intentarlo en un minuto: no se cobra dos veces.', 504);
  }
  const body: any = await response.json().catch(() => null);
  if (!response.ok) {
    await close(false);
    const refusal = enrichmentRefusalMessage(body);
    if (refusal) throw new LeadDropsError(refusal, 409);
    if (response.status === 429) throw new LeadDropsError('Se alcanzó el cupo de búsquedas de hoy. Se renueva mañana.', 429);
    throw new LeadDropsError('No pudimos buscar su correo ahora. Inténtalo de nuevo en unos minutos.', 503);
  }
  const results: any[] = Array.isArray(body?.enriched) ? body.enriched : [];
  const result = results.find(row => String(row?.clientRef || '') === String(saved.data.id)) ?? results[0] ?? null;
  const email = String(result?.email || '').trim().toLowerCase();
  const pending = response.status === 202 || String(result?.enrichmentStatus || '').toLowerCase().startsWith('pending');
  const consumed = body?.usage?.reused ? 0 : Math.max(0, Number(body?.usage?.consumed ?? 0) || 0);
  if (!email && !pending) {
    // Searched and nothing found: the saved contact says so («Sin correo»), as it does after a search in the app.
    await client.from('leads').update({ email_enrichment: { enriched: false, status: 'not_found', attemptedAt: now.toISOString() } })
      .eq('id', saved.data.id).eq('user_id', scope.userId).eq('organization_id', scope.organizationId);
    await close(true);
    return { outcome: 'not_found', email: null, consumed };
  }
  const linked = await linkDropLead(client, scope, dropId, leadId, now);
  // In «Por escribir» now: it leaves the saved ones, as a contact that got its email does in the app.
  if (linked.linked) await client.from('leads').delete().eq('id', saved.data.id).eq('user_id', scope.userId).eq('organization_id', scope.organizationId);
  return { outcome: email && linked.linked ? 'found' : 'pending', email: email || null, consumed };
}

export type CampaignSwitchDeps = { get?: typeof getBulkCampaign; review?: typeof reviewBulkCampaign; now?: Date };

/**
 * «Detener» and «Reanudar» for a campaign approved from the drop: whoever approved with one tap in an email stops it the same way.
 * Stopped, nothing else goes out; resumed, it goes on from where it was. Asked twice, it answers as it is.
 */
export async function switchDropCampaign(client: Client, scope: DropScope, dropId: string, leadId: string, to: 'pause' | 'resume', deps: CampaignSwitchDeps = {}) {
  const drop = await readDrop(client, scope, dropId);
  const item = drop.items.find(entry => entry.leadId === leadId);
  if (!item?.campaign) throw new LeadDropsError('Este contacto todavía no tiene una campaña aprobada.', 409);
  const auth = linkAuth(client, scope);
  try {
    const campaign = await (deps.get ?? getBulkCampaign)(auth, item.campaign.id);
    const wanted = to === 'pause' ? 'paused' : 'approved';
    if (campaign.status !== wanted) {
      if (campaign.status !== (to === 'pause' ? 'approved' : 'paused')) throw new LeadDropsError('Esta campaña ya terminó o cambió. Ábrela en ANTON.IA para verla.', 409);
      await (deps.review ?? reviewBulkCampaign)(auth, item.campaign.id, { action: to, revision: campaign.revision, reviewHash: campaign.review_hash });
    }
  } catch (error) {
    if (error instanceof LeadDropsError) throw error;
    if (error instanceof AuthError) throw new LeadDropsError(error.message, error.status);
    throw new LeadDropsError(to === 'pause' ? 'No pudimos detener la campaña. Inténtalo de nuevo.' : 'No pudimos reanudar la campaña. Inténtalo de nuevo.', 503);
  }
  const at = (deps.now ?? new Date()).toISOString();
  await patchItem(client, scope, dropId, leadId, entry => entry.campaign ? { ...entry, campaign: { ...entry.campaign, pausedAt: to === 'pause' ? at : null } } : entry);
}
