import type { SupabaseClient } from '@supabase/supabase-js';
import { generateStructured } from '@/ai/openai-json';
import { enrichmentRefusalMessage } from '@/lib/apollo-credit-allocation';
import { DROP_CALL_SYSTEM, dropCallPrompt, dropCallScriptSchema, dropPhoneOf, type DropCallScript, type DropPhone } from '@/lib/lead-drop-call';
import { dropName, placeLabel, type DropItem } from '@/lib/lead-drops';
import { loadCoworkUserContext } from '@/lib/server/cowork/user-context';
import { internalBaseUrl, patchItem } from '@/lib/server/lead-drop-mail';
import { LeadDropsError, readDrop, type DropScope } from '@/lib/server/lead-drops';

/**
 * «Para llamar» in «Contacto del día» (src/lib/lead-drop-call.ts): the mobile of a contact the person already has in «Por escribir»,
 * looked up with the app's own lookup (same quota, same share of the team's credits, same record), and the script of its call,
 * prepared once by a small model from what the drop already knows of the contact and kept with it. Used the same way from the app
 * and from the page the emails open (lead-drop-mail.ts), so both go through the server. Server only.
 */

type Client = SupabaseClient;
type Generate = (options: any) => Promise<unknown>;
const LOOKUP_TIMEOUT_MS = 100_000;
const PHONE_COLUMNS = 'id,full_name,title,linkedin_url,company_name,organization_domain,source_provider,source_provider_id,primary_phone,phone_numbers,enrichment_status,updated_at,created_at';
const scriptModel = (env: Record<string, string | undefined> = process.env) => env.LEAD_DROPS_CALL_MODEL?.trim() || env.LEAD_DROPS_RESEARCH_MODEL?.trim() || 'claude-haiku-5-5';

/** The mobile of each saved contact of a drop, keyed by the contact: read from «Por escribir», never kept in the drop. */
export async function dropPhones(client: Client, scope: DropScope, items: DropItem[], now = new Date()): Promise<Record<string, DropPhone>> {
  const saved = items.filter(item => item.savedLeadId);
  if (!saved.length) return {};
  const rows: any = await client.from('enriched_leads').select('id,primary_phone,phone_numbers,enrichment_status,updated_at,created_at')
    .in('id', saved.map(item => String(item.savedLeadId))).eq('organization_id', scope.organizationId).eq('user_id', scope.userId);
  if (rows.error) return {};
  const byId = new Map<string, any>(((rows.data || []) as any[]).map(row => [String(row.id), row]));
  return Object.fromEntries(saved.map(item => [item.leadId, dropPhoneOf(byId.get(String(item.savedLeadId)), Boolean(item.phoneLookup), now.getTime())]));
}

/** The contacts as the card shows them: each saved one with where its mobile stands. What is written back never carries it. */
export async function withDropPhones<T extends DropItem>(client: Client, scope: DropScope, items: T[], now = new Date()): Promise<T[]> {
  const phones = await dropPhones(client, scope, items, now).catch(() => ({} as Record<string, DropPhone>));
  return items.map(item => phones[item.leadId] ? { ...item, phone: phones[item.leadId] } : item);
}

export type PhoneDeps = { fetch?: typeof fetch; baseUrl?: string; internalSecret?: string; now?: Date };
export type PhoneOutcome = { outcome: 'found' | 'pending' | 'not_found'; consumed: number };

/**
 * «Buscar su teléfono»: the mobile of a contact already in «Por escribir». The app's own route is asked by the server as that
 * member, under an operation named after the drop, the contact and the try: a second tap while the first is still out repeats it
 * and pays nothing. The provider answers a mobile in minutes, so the usual answer is `pending`: the card asks again by itself.
 */
export async function findDropPhone(client: Client, scope: DropScope, dropId: string, leadId: string, deps: PhoneDeps = {}): Promise<PhoneOutcome> {
  const now = deps.now ?? new Date();
  const drop = await readDrop(client, scope, dropId);
  const item = drop.items.find(entry => entry.leadId === leadId);
  if (!item) throw new LeadDropsError('No encontramos ese contacto.', 404);
  if (!item.savedLeadId) throw new LeadDropsError('Primero enriquece este contacto: su teléfono se busca después.', 409);
  const saved: any = await client.from('enriched_leads').select(PHONE_COLUMNS).eq('id', item.savedLeadId)
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle();
  if (saved.error || !saved.data) throw new LeadDropsError('No pudimos buscar su teléfono ahora. Inténtalo de nuevo.', 503);
  const current = dropPhoneOf(saved.data, Boolean(item.phoneLookup), now.getTime());
  if (current.state === 'found') return { outcome: 'found', consumed: 0 };
  if (current.state === 'pending') return { outcome: 'pending', consumed: 0 };
  const baseUrl = (deps.baseUrl ?? internalBaseUrl(process.env)).replace(/\/$/, '');
  const secret = (deps.internalSecret ?? String(process.env.INTERNAL_API_SECRET || '')).trim();
  if (!baseUrl || !secret) throw new LeadDropsError('No pudimos buscar su teléfono ahora. Inténtalo más tarde.', 503);

  // Every finished lookup is its own operation: one that found nothing does not answer for the next.
  const attempt = (item.phoneLookup?.attempt ?? -1) + 1;
  await patchItem(client, scope, dropId, leadId, entry => ({ ...entry, phoneLookup: { attempt, at: now.toISOString() } }));
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(`${baseUrl}/api/opportunities/enrich-apollo`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json', 'Idempotency-Key': `lead-drop:${dropId}:${leadId}:phone:${attempt}`,
        'x-user-id': scope.userId, 'x-organization-id': scope.organizationId, 'x-internal-api-secret': secret,
      },
      body: JSON.stringify({
        leads: [{
          fullName: String(saved.data.full_name || item.name || ''), linkedinUrl: saved.data.linkedin_url || undefined, title: saved.data.title || item.title || undefined,
          companyName: saved.data.company_name || item.company || undefined, companyDomain: saved.data.organization_domain || item.domain || undefined,
          clientRef: String(saved.data.id), existingRecordId: String(saved.data.id),
          sourceProvider: saved.data.source_provider || item.provider || undefined, sourceProviderId: saved.data.source_provider_id || leadId,
        }],
        revealEmail: false, revealPhone: true, tableName: 'enriched_leads',
      }),
    });
  } catch {
    throw new LeadDropsError('La búsqueda tarda más de lo normal. Vuelve a intentarlo en un minuto: no se cobra dos veces.', 504);
  }
  const body: any = await response.json().catch(() => null);
  if (!response.ok) {
    const refusal = enrichmentRefusalMessage(body);
    if (refusal) throw new LeadDropsError(refusal, 409);
    if (response.status === 429) throw new LeadDropsError('Se alcanzó el cupo de búsquedas de hoy. Se renueva mañana.', 429);
    throw new LeadDropsError('No pudimos buscar su teléfono ahora. Inténtalo de nuevo en unos minutos.', 503);
  }
  const consumed = body?.usage?.reused ? 0 : Math.max(0, Number(body?.usage?.consumed ?? 0) || 0);
  const after: any = await client.from('enriched_leads').select('primary_phone,phone_numbers,enrichment_status,updated_at,created_at').eq('id', item.savedLeadId)
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle();
  const state = dropPhoneOf(after.data, true, Date.now()).state;
  return { outcome: state === 'found' ? 'found' : state === 'pending' || response.status === 202 ? 'pending' : 'not_found', consumed };
}

/**
 * The script of the call to one contact, prepared once and kept with it (`item.call`); `fresh` asks for another. From what the drop
 * already knows: who they are, the research's lines, why they were recommended and the first email of their campaign.
 */
export async function prepareDropCall(client: Client, scope: DropScope, dropId: string, leadId: string,
  options: { fresh?: boolean; generate?: Generate; now?: Date } = {}): Promise<{ script: DropCallScript; items: DropItem[] }> {
  const drop = await readDrop(client, scope, dropId);
  const item = drop.items.find(entry => entry.leadId === leadId);
  if (!item) throw new LeadDropsError('No encontramos ese contacto.', 404);
  if (item.call && !options.fresh) return { script: item.call.script, items: drop.items };
  const context = await loadCoworkUserContext(client, scope, { memories: false, mailbox: false }).catch(() => null);
  const brief = item.brief;
  const prompt = dropCallPrompt({
    seller: { name: context?.fullName || null, company: context?.companyName || null, offer: context?.offer || null, services: context?.services, proofPoints: context?.proofPoints },
    contact: { name: dropName(item), title: item.title, company: item.company, industry: item.industry, size: item.size, place: placeLabel(item) || null, seniority: item.seniority, department: item.department },
    known: { company: brief?.company || item.summary || null, news: brief?.news?.text || null, fit: brief?.fit || null, role: brief?.role || null,
      opener: brief?.opener || item.approach || null, reasons: [...(item.reasons || []), item.why].filter(Boolean) },
    email: item.draft,
  });
  let script: DropCallScript;
  try {
    const answer = await (options.generate ?? (generateStructured as Generate))({ schema: dropCallScriptSchema, prompt, systemPrompt: DROP_CALL_SYSTEM, openAiModel: scriptModel(),
      reasoningEffort: 'low', maxOutputTokens: 1800, timeoutMs: 45_000, allowDefaultModelFallback: false, maxAttempts: 2 });
    script = dropCallScriptSchema.parse(answer);
  } catch {
    throw new LeadDropsError('No pudimos preparar el guion ahora. Inténtalo de nuevo.', 503);
  }
  const at = (options.now ?? new Date()).toISOString();
  await patchItem(client, scope, dropId, leadId, entry => ({ ...entry, call: { script, at } }));
  return { script, items: (await readDrop(client, scope, dropId)).items };
}
