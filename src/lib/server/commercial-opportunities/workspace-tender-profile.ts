// «Ficha para licitaciones»: read and saved by admins, suggested by the AI from what the company already wrote, and read by
// every prompt that decides about a tender (screening, chat, assistant, offer draft).
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@/lib/server/auth-utils';
import type { WorkScope } from '@/lib/commercial-opportunities/workspace';
import { cleanTenderProfileSuggestion, readTenderProfile, tenderProfileProgress, tenderProfileSchema, tenderProfileSuggestionPrompt, tenderProfileSuggestionSchema,
  type TenderProfileSuggestion } from '@/lib/commercial-opportunities/tender-profile';
import { opportunityDb } from './workspace-store';
import { assertOpportunityAdmin } from './workspace-access';
import { opportunityGenerate, type OpportunityJob } from './workspace-ai';
import { downloadOpportunitySource } from './workspace-download';
import { webPageBody } from './workspace-documents';
import { loadTenderProfile } from './tender-profile-read';

const TABLE = 'opportunity_tender_profile';
/** The motives of a discard that the profile can disprove: something «required» or out of «scale». */
const PROFILE_MOTIVES = ['requisito', 'escala'];

/** What the page shows: the profile, its revision for a safe save, and how many discards it could reopen. */
export async function readTenderProfileView(client: SupabaseClient, scope: WorkScope) {
  assertOpportunityAdmin(scope);
  const result = await client.from(TABLE).select('answers,revision,updated_at').eq('organization_id', scope.organizationId).maybeSingle();
  if (result.error) return { available: false, profile: readTenderProfile({}), revision: 0, updatedAt: null, progress: tenderProfileProgress(readTenderProfile({})), reconsiderable: 0 };
  const profile = readTenderProfile(result.data?.answers);
  return { available: true, profile, revision: Number(result.data?.revision || 0), updatedAt: result.data?.updated_at ?? null, progress: tenderProfileProgress(profile),
    reconsiderable: (await profileDiscards(client, scope.organizationId)).length };
}

/** Saved whole, with the revision read: another admin's save in between is not overwritten. */
export async function saveTenderProfile(client: SupabaseClient, scope: WorkScope, input: { profile: unknown; expectedRevision: number }) {
  assertOpportunityAdmin(scope);
  const profile = tenderProfileSchema.parse(input.profile);
  const now = new Date().toISOString();
  if (input.expectedRevision === 0) {
    const created = await client.from(TABLE).insert({ organization_id: scope.organizationId, answers: profile, revision: 1, updated_by: scope.userId, updated_at: now })
      .select('revision').maybeSingle();
    if (created.error?.code === '23505') throw new AuthError('Otra persona guardó la ficha recién. Revisa sus respuestas y vuelve a guardar.', 409);
    return { revision: Number(opportunityDb(created)?.revision || 1), profile, progress: tenderProfileProgress(profile) };
  }
  const updated = opportunityDb(await client.from(TABLE).update({ answers: profile, revision: input.expectedRevision + 1, updated_by: scope.userId, updated_at: now })
    .eq('organization_id', scope.organizationId).eq('revision', input.expectedRevision).select('revision').maybeSingle());
  if (!updated) throw new AuthError('Otra persona guardó la ficha recién. Revisa sus respuestas y vuelve a guardar.', 409);
  return { revision: Number(updated.revision), profile, progress: tenderProfileProgress(profile) };
}

/** The open opportunities discarded for something the profile could disprove (a requirement, the scale), up to 200. */
async function profileDiscards(client: SupabaseClient, organizationId: string) {
  const rows = (opportunityDb(await client.from('commercial_opportunities').select('id,deadline_at,data').eq('organization_id', organizationId)
    .eq('data->>evaluation', 'excluded').in('data->>excludedMotive', PROFILE_MOTIVES).limit(500)) || []) as Array<{ id: string; deadline_at: string | null; data: any }>;
  const now = Date.now();
  return rows.filter(row => !row.deadline_at || Date.parse(row.deadline_at) > now).slice(0, 200);
}

/** «Revisar de nuevo con la ficha»: the AI reads those discards again, now with the profile, in batches of 40. */
export async function reconsiderWithTenderProfile(client: SupabaseClient, scope: WorkScope) {
  assertOpportunityAdmin(scope);
  const context = opportunityDb(await client.from('opportunity_company_context').select('revision').eq('organization_id', scope.organizationId).maybeSingle());
  if (!context) throw new AuthError('Confirma primero la oferta del workspace.', 409);
  const stored = opportunityDb(await client.from(TABLE).select('revision').eq('organization_id', scope.organizationId).maybeSingle());
  if (!stored) throw new AuthError('Guarda primero la ficha.', 409);
  const ids = (await profileDiscards(client, scope.organizationId)).filter(row => String(row.data?.profileRevision) === String(context.revision)).map(row => row.id);
  for (let index = 0; index < ids.length; index += 40) {
    opportunityDb(await client.from('opportunity_jobs').upsert({ organization_id: scope.organizationId, requested_by: scope.userId, kind: 'evaluate',
      // One review per profile version: pressing twice does not pay twice.
      dedupe_key: `profile-review:${stored.revision}:${context.revision}:${index}`, payload: { ids: ids.slice(index, index + 40), revision: context.revision } },
      { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true }));
  }
  return ids.length;
}

/** «Completar con IA»: a job of its own (budget and receipts like any other), answered in the same request. */
export async function enqueueTenderProfileSuggestion(client: SupabaseClient, scope: WorkScope, requestId: string) {
  assertOpportunityAdmin(scope);
  const key = `profile:${scope.userId}:${requestId}`;
  opportunityDb(await client.from('opportunity_jobs').upsert({ organization_id: scope.organizationId, requested_by: scope.userId, kind: 'profile',
    dedupe_key: key, payload: { requestId } }, { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true }));
  return key;
}
export async function readTenderProfileSuggestion(client: SupabaseClient, organizationId: string, key: string) {
  const job = opportunityDb(await client.from('opportunity_jobs').select('state,error,result').eq('organization_id', organizationId).eq('dedupe_key', key).maybeSingle());
  return job ? { state: String(job.state), error: job.error as string | null, suggestion: (job.state === 'ready' ? job.result : null) as TenderProfileSuggestion | null } : null;
}

const foldCompany = (value: unknown) => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/\b(spa|s\.?a\.?|ltda\.?|limitada|eirl|e\.i\.r\.l\.?|sociedad|grupo|chile)\b/g, '').replace(/[^a-z0-9]/g, '');
/** «GrupoExpro» and «Grupo Expro SpA» are the same company; «Yago» is not. */
export function sameCompany(profileCompany: unknown, workspaceCompany: string | null) {
  const a = foldCompany(profileCompany); const b = foldCompany(workspaceCompany);
  return Boolean(a && b && (a === b || (a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b))));
}

/** The company's home page as text, when its domain is known and public; nothing when it cannot be read. */
async function websiteText(domain: string | null, download = downloadOpportunitySource) {
  const host = String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  try {
    const page = await download(`https://${host}`);
    if (!/html|text/.test(page.mime)) return null;
    const text = webPageBody(page.bytes.toString('utf8')).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    return text.length > 80 ? text.slice(0, 20_000) : null;
  } catch { return null; }
}

/** The worker's side: what the admins wrote about the company, its website and the offer, read once by the model. */
export async function runTenderProfileSuggestion(client: SupabaseClient, job: OpportunityJob, options: { download?: typeof downloadOpportunitySource } = {}) {
  const [context, leaders, current, organization] = await Promise.all([
    client.from('opportunity_company_context').select('offer,services,territories,exclusions').eq('organization_id', job.organization_id).maybeSingle().then(opportunityDb),
    client.from('organization_members').select('user_id').eq('organization_id', job.organization_id).in('role', ['owner', 'admin']).limit(10).then(opportunityDb),
    loadTenderProfile(client, job.organization_id),
    client.from('organizations').select('name').eq('id', job.organization_id).maybeSingle().then(opportunityDb),
  ]);
  const ids = ((leaders || []) as Array<{ user_id: string }>).map(row => row.user_id);
  // A personal «Perfil» may describe another company (a consultant who administers the workspace): only the ones whose
  // company is the workspace's are read, and the website only from them. In production a Yago admin of GrupoExpro
  // filled GrupoExpro's profile with Yago's name and products.
  const companyName = String(organization?.name || '').trim() || null;
  const profiles = (ids.length ? ((opportunityDb(await client.from('profiles').select('company_name,company_domain,company_profile,signatures').in('id', ids))) || []) as any[] : [])
    .filter(row => sameCompany(row.company_name, companyName));
  const domain = profiles.map(row => String(row.company_domain || '').trim()).find(Boolean) || null;
  const written = profiles.map(row => {
    const extended = row.signatures?.profile_extended && typeof row.signatures.profile_extended === 'object' ? row.signatures.profile_extended : {};
    const pick = (value: unknown) => (Array.isArray(value) ? value.join('; ') : typeof value === 'string' ? value : '');
    return Object.fromEntries(Object.entries({ empresa: row.company_profile, descripcion: extended.description, clientes: extended.referenceClients ?? extended.reference_clients,
      pruebas: extended.proofPoints ?? extended.proof_points, industria: extended.industry ?? extended.sector, servicios: extended.services })
      .map(([key, value]) => [key, pick(value).slice(0, 1500)]).filter(([, value]) => value));
  }).filter(entry => Object.keys(entry).length);
  const website = await websiteText(domain, options.download);
  const raw = await opportunityGenerate(client, job, { step: 'suggest', category: 'research', role: 'extract', schema: tenderProfileSuggestionSchema, output: 3000,
    prompt: tenderProfileSuggestionPrompt({ offer: String(context?.offer || ''), services: context?.services || [], territories: context?.territories || [],
      exclusions: context?.exclusions || [], profiles: written, website, companyName }) });
  return { ...cleanTenderProfileSuggestion(raw, current || readTenderProfile({})), website: Boolean(website) };
}
