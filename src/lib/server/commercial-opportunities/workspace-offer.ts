import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@/lib/server/auth-utils';
import type { DocumentChunk, OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import { cleanOfferPrices, companyProfileExtras, offerAnnexesPrompt, offerDraftChunkIds, offerDraftPrompt, offerDraftSchema, officialTenderItems, validateOfferDraft, withOfferAnnexes,
  type OfferDraft, type OfficialItem, type SavedOfferDraft } from '@/lib/commercial-opportunities/offer-draft';
import { offerAnnexesSchema, offerFormExcerpts, type OfferAnnex } from '@/lib/commercial-opportunities/offer-annexes';
import { OPPORTUNITY_BUCKET, type WorkScope } from '@/lib/commercial-opportunities/workspace';
import { assertOpportunityRead } from './workspace-access';
import { addOpportunityActivity, opportunityDb } from './workspace-store';
import { opportunityGenerate, type OpportunityJob } from './workspace-ai';
import { loadCompanyForModel } from './tender-profile-read';

/** The kinds with bases to answer: public tenders, Compra Ágil and the purchases a company receives (private). */
export const OFFER_KINDS = ['tender', 'compra_agil', 'private'];
const DRAFTS = 'opportunity_offer_drafts';

/**
 * Queues the draft of the offer, on the latest report. `requestId` comes from the click: a double click asks once, a new
 * click («Preparar otra versión») asks again, with the team's indications if any.
 */
export async function enqueueOpportunityOffer(client: SupabaseClient, scope: WorkScope, id: string, input: { requestId: string; instructions?: string }) {
  await assertOpportunityRead(client, scope, id);
  const item = opportunityDb(await client.from('commercial_opportunities').select('kind').eq('organization_id', scope.organizationId).eq('id', id).single());
  if (!OFFER_KINDS.includes(item?.kind)) throw new AuthError('El borrador de oferta es para licitaciones, Compra Ágil y oportunidades con bases.', 400);
  const report = opportunityDb(await client.from('opportunity_reports').select('id').eq('organization_id', scope.organizationId).eq('opportunity_id', id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle());
  if (!report) throw new AuthError('Genera primero el informe: el borrador se arma con lo que la IA leyó de las bases.', 409);
  const key = `offer:${id}:${input.requestId}`;
  const payload = { reportId: report.id, instructions: (input.instructions || '').trim().slice(0, 1500) };
  const row = opportunityDb(await client.from('opportunity_jobs').upsert({ organization_id: scope.organizationId, opportunity_id: id, requested_by: scope.userId,
    kind: 'offer', dedupe_key: key, payload }, { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true }).select('id').maybeSingle());
  if (row?.id) return row.id as string;
  const found = opportunityDb(await client.from('opportunity_jobs').select('id').eq('organization_id', scope.organizationId).eq('dedupe_key', key).single());
  if (!found) throw new AuthError('No se pudo recuperar el trabajo.', 503);
  return found.id as string;
}

/** The lines of the tender from the official file the report saved («Ficha oficial <código>.txt»), when it is there. */
async function readOfficialItems(client: SupabaseClient, job: OpportunityJob): Promise<OfficialItem[]> {
  const doc = opportunityDb(await client.from('opportunity_documents').select('storage_path').eq('organization_id', job.organization_id).eq('opportunity_id', job.opportunity_id)
    .eq('source_kind', 'official').like('name', 'Ficha oficial %').order('created_at', { ascending: false }).limit(1).maybeSingle());
  if (!doc?.storage_path) return [];
  try {
    const { data } = await client.storage.from(OPPORTUNITY_BUCKET).download(doc.storage_path);
    return data ? officialTenderItems(JSON.parse(await data.text())) : [];
  } catch { return []; }
}

/** The text of the forms of the bases (the «Anexo» files and the annexes inside the bases), to copy them faithfully. */
async function readFormExcerpts(client: SupabaseClient, job: OpportunityJob) {
  const documents = (opportunityDb(await client.from('opportunity_documents').select('id,name').eq('organization_id', job.organization_id).eq('opportunity_id', job.opportunity_id).limit(200)) || []) as Array<{ id: string; name: string }>;
  const chunks: Array<{ document_id: string; ordinal: number; content: string }> = [];
  for (let page = 0; page < 8; page++) {
    const batch = (opportunityDb(await client.from('opportunity_document_chunks').select('document_id,ordinal,content').eq('organization_id', job.organization_id).eq('opportunity_id', job.opportunity_id)
      .order('document_id').order('ordinal').range(page * 1000, page * 1000 + 999)) || []) as typeof chunks;
    chunks.push(...batch);
    if (batch.length < 1000) break;
  }
  return offerFormExcerpts(chunks, documents);
}

export async function runOpportunityOffer(client: SupabaseClient, job: OpportunityJob) {
  const scope: WorkScope = { organizationId: job.organization_id, userId: job.requested_by };
  const id = job.opportunity_id!;
  await assertOpportunityRead(client, scope, id);
  const [itemRow, contextRow, reportRow, profileRow] = await Promise.all([
    client.from('commercial_opportunities').select('kind,title,buyer_name,company_name,deadline_at,amount,currency,data').eq('organization_id', job.organization_id).eq('id', id).single(),
    client.from('opportunity_company_context').select('offer,services,territories,exclusions').eq('organization_id', job.organization_id).maybeSingle(),
    client.from('opportunity_reports').select('id,report').eq('organization_id', job.organization_id).eq('opportunity_id', id).eq('id', job.payload.reportId).maybeSingle(),
    client.from('profiles').select('company_profile,signatures').eq('id', job.requested_by).maybeSingle(),
  ]);
  const ficha = await loadCompanyForModel(client, job.organization_id, { legal: true });
  const item = opportunityDb(itemRow); const context = opportunityDb(contextRow); const saved = opportunityDb(reportRow); const profile = opportunityDb(profileRow);
  if (!item) throw new AuthError('No encontramos esa oportunidad.', 404);
  if (!context) throw new AuthError('Un administrador debe confirmar primero la oferta del workspace.', 409);
  if (!saved) throw new AuthError('El informe cambió. Prepara el borrador de nuevo.', 409);
  const report = saved.report as OpportunityReport;
  const prompt = offerDraftPrompt({
    opportunity: { title: item.title, buyer: item.buyer_name || item.company_name, code: item.data?.observed?.code ?? null, deadline: item.deadline_at, amount: item.amount, currency: item.currency },
    company: { offer: String(context.offer || ''), services: context.services || [], territories: context.territories || [], exclusions: context.exclusions || [],
      profile: typeof profile?.company_profile === 'string' ? profile.company_profile : undefined, extras: companyProfileExtras(profile?.signatures?.profile_extended),
      ...(ficha ? { ficha } : {}) },
    report, officialItems: await readOfficialItems(client, job), instructions: job.payload.instructions,
  });
  const raw = await opportunityGenerate(client, job, { step: `offer:${createHash('sha256').update(prompt).digest('hex')}`, category: 'research', role: 'report',
    schema: offerDraftSchema, output: 14_000, prompt }) as OfferDraft;
  const ids = offerDraftChunkIds(raw);
  const chunks = ids.length ? (opportunityDb(await client.from('opportunity_document_chunks').select('id,document_id,ordinal,locator,content')
    .eq('organization_id', job.organization_id).eq('opportunity_id', id).in('id', ids)) || []) as DocumentChunk[] : [];
  const base = validateOfferDraft(raw, chunks);
  if (!base.technical.length && !base.economic.lines.length) throw new AuthError('La IA no encontró en el informe lo necesario para armar la oferta. Sube las bases y actualiza el informe.', 422);
  // The forms of the bases are written apart, from their own text: a form is long, and it wants the exact words of the bases. If they
  // cannot be written (the budget, an odd answer), the offer still goes out, saying so, and the team can ask for another version.
  let annexes: OfferAnnex[] = []; let annexMissing: string[] = [];
  try {
    const annexPrompt = offerAnnexesPrompt({ opportunity: { title: item.title, buyer: item.buyer_name || item.company_name, code: item.data?.observed?.code ?? null },
      company: { offer: String(context.offer || ''), services: context.services || [], territories: context.territories || [], exclusions: context.exclusions || [], ...(ficha ? { ficha } : {}) },
      report, forms: await readFormExcerpts(client, job), economicLines: base.economic.lines.map(line => ({ description: line.description, unit: line.unit, quantity: line.quantity })) });
    const result = await opportunityGenerate(client, job, { step: `offer-annexes:${createHash('sha256').update(annexPrompt).digest('hex')}`, category: 'research', role: 'report',
      schema: offerAnnexesSchema, output: 14_000, prompt: annexPrompt });
    annexes = result.annexes; annexMissing = result.missing;
  } catch (error) {
    if (error instanceof AuthError && error.status === 409) throw error;
    annexMissing = ['No pudimos preparar los formularios de las bases: descárgalos en «Documentos» y llénalos con los datos de la oferta (o prepara otra versión).'];
  }
  const draft = withOfferAnnexes(base, annexes, annexMissing);
  opportunityDb(await client.from(DRAFTS).upsert({ organization_id: job.organization_id, opportunity_id: id, report_id: saved.id, job_id: job.id,
    created_by: job.requested_by, draft }, { onConflict: 'job_id', ignoreDuplicates: true }));
  await addOpportunityActivity(client, scope, id, 'offer', 'Borrador de oferta preparado', { jobId: job.id }, `offer:${job.id}`).catch(() => undefined);
  await client.from('opportunity_notifications').upsert({ organization_id: job.organization_id, opportunity_id: id, user_id: job.requested_by,
    title: `Borrador de oferta listo: ${String(item.title || 'oportunidad').slice(0, 460)}`, kind: 'report', event_key: `offer:${job.id}` },
    { onConflict: 'organization_id,user_id,event_key', ignoreDuplicates: true }).then(() => undefined, () => undefined);
  return { offerReady: true, sections: draft.technical.length, lines: draft.economic.lines.length, annexes: annexes.length };
}

/** The latest draft of an opportunity, with the prices the team typed; null before the first one (or before the table exists). */
export async function readOpportunityOffer(client: SupabaseClient, scope: WorkScope, id: string): Promise<{ available: boolean; latest: SavedOfferDraft | null }> {
  const { data, error } = await client.from(DRAFTS).select('id,report_id,draft,prices,revision,created_at,updated_at').eq('organization_id', scope.organizationId)
    .eq('opportunity_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) return { available: false, latest: null };
  return { available: true, latest: data ? { ...data, prices: data.prices || {} } as SavedOfferDraft : null };
}

/** Saves the unit prices of the latest draft, only if nobody changed them since the page read them. */
export async function saveOpportunityOfferPrices(client: SupabaseClient, scope: WorkScope, id: string, input: { draftId: string; expectedRevision: number; prices: Record<string, unknown> }) {
  await assertOpportunityRead(client, scope, id);
  const row = opportunityDb(await client.from(DRAFTS).select('draft').eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('id', input.draftId).maybeSingle());
  if (!row) throw new AuthError('No encontramos ese borrador.', 404);
  const prices = cleanOfferPrices(input.prices, (row.draft as OfferDraft).economic.lines.length);
  const saved = opportunityDb(await client.from(DRAFTS).update({ prices, revision: input.expectedRevision + 1, prices_updated_by: scope.userId, updated_at: new Date().toISOString() })
    .eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('id', input.draftId).eq('revision', input.expectedRevision).select('revision,prices').maybeSingle());
  if (!saved) throw new AuthError('Otra persona cambió los precios mientras escribías. Te mostramos los suyos: revísalos y guarda de nuevo.', 409);
  return saved as { revision: number; prices: Record<string, number> };
}
