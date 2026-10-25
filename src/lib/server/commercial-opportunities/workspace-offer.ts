import { canSetPrices } from '@/lib/commercial-opportunities/member-work';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@/lib/server/auth-utils';
import type { DocumentChunk, OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import { cleanOfferPrices, companyProfileExtras, offerAnnexesPrompt, offerDraftChunkIds, offerDraftPrompt, offerDraftSchema, officialTenderItems, validateOfferDraft, withOfferAnnexes,
  type OfferDraft, type OfficialItem, type SavedOfferDraft } from '@/lib/commercial-opportunities/offer-draft';
import { offerAnnexesSchema, offerFormExcerpts, type OfferAnnex } from '@/lib/commercial-opportunities/offer-annexes';
import { editOfferPart, offerPartEdit, offerPartPrompt, offerPartSchema, offerPartText, withOfferEdits, type EditedOfferDraft } from '@/lib/commercial-opportunities/offer-edits';
import { OPPORTUNITY_BUCKET, type WorkScope } from '@/lib/commercial-opportunities/workspace';
import { assertOpportunityRead } from './workspace-access';
import { addOpportunityActivity, opportunityDb } from './workspace-store';
import { opportunityGenerate, type OpportunityJob } from './workspace-ai';
import { loadCompanyForModel } from './tender-profile-read';
import { withCompanyProfile } from '@/lib/profile/company-profile';
import { readCompanyFields } from '@/lib/server/company-profile';

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
  if (typeof job.payload.part === 'string') return rewriteOfferPart(client, job, id);
  const [itemRow, contextRow, reportRow, profileRow, company] = await Promise.all([
    client.from('commercial_opportunities').select('kind,title,buyer_name,company_name,deadline_at,amount,currency,data').eq('organization_id', job.organization_id).eq('id', id).single(),
    client.from('opportunity_company_context').select('offer,services,territories,exclusions').eq('organization_id', job.organization_id).maybeSingle(),
    client.from('opportunity_reports').select('id,report').eq('organization_id', job.organization_id).eq('opportunity_id', id).eq('id', job.payload.reportId).maybeSingle(),
    client.from('profiles').select('company_profile,signatures').eq('id', job.requested_by).maybeSingle(),
    readCompanyFields(client, job.organization_id),
  ]);
  const ficha = await loadCompanyForModel(client, job.organization_id, { legal: true });
  const item = opportunityDb(itemRow); const context = opportunityDb(contextRow); const saved = opportunityDb(reportRow); const profile = withCompanyProfile(opportunityDb(profileRow), company);
  if (!item) throw new AuthError('No encontramos esa oportunidad.', 404);
  if (!context) throw new AuthError('Un administrador debe confirmar primero la oferta de la empresa.', 409);
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

/**
 * The latest draft of an opportunity, with the prices the team typed, and when the ones before it were prepared (their Word is
 * still there, to compare: OPP-24); null before the first one (or before the table exists).
 */
export async function readOpportunityOffer(client: SupabaseClient, scope: WorkScope, id: string): Promise<{ available: boolean; latest: SavedOfferDraft | null; versions: Array<{ id: string; created_at: string }> }> {
  const [{ data, error }, older] = await Promise.all([
    client.from(DRAFTS).select('id,report_id,draft,prices,revision,created_at,updated_at').eq('organization_id', scope.organizationId)
      .eq('opportunity_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    client.from(DRAFTS).select('id,created_at').eq('organization_id', scope.organizationId).eq('opportunity_id', id).order('created_at', { ascending: false }).range(1, 6),
  ]);
  if (error) return { available: false, latest: null, versions: [] };
  return { available: true, latest: data ? { ...data, prices: data.prices || {} } as SavedOfferDraft : null, versions: (older.data || []) as Array<{ id: string; created_at: string }> };
}

/** One draft by its id: an older version, for its Word. */
export async function readOpportunityOfferVersion(client: SupabaseClient, scope: WorkScope, id: string, draftId: string): Promise<SavedOfferDraft | null> {
  const { data, error } = await client.from(DRAFTS).select('id,report_id,draft,prices,revision,created_at,updated_at').eq('organization_id', scope.organizationId)
    .eq('opportunity_id', id).eq('id', draftId).maybeSingle();
  return error || !data ? null : { ...data, prices: data.prices || {} } as SavedOfferDraft;
}

/** Saves the unit prices of the latest draft, only if nobody changed them since the page read them. */
export async function saveOpportunityOfferPrices(client: SupabaseClient, scope: WorkScope, id: string, input: { draftId: string; expectedRevision: number; prices: Record<string, unknown> }) {
  await assertOpportunityRead(client, scope, id);
  // The prices are the company's commitment: whoever is in charge or an administrator sets them (member-work.ts).
  const work = opportunityDb(await client.from('opportunity_work').select('responsible_id').eq('organization_id', scope.organizationId).eq('opportunity_id', id).maybeSingle()) as { responsible_id: string | null } | null;
  if (!canSetPrices(scope.role, scope.userId, work?.responsible_id)) throw new AuthError('Los precios los fija quien está a cargo de la oportunidad o un administrador.', 403);
  const row = opportunityDb(await client.from(DRAFTS).select('draft').eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('id', input.draftId).maybeSingle());
  if (!row) throw new AuthError('No encontramos ese borrador.', 404);
  const prices = cleanOfferPrices(input.prices, (row.draft as OfferDraft).economic.lines.length);
  const saved = opportunityDb(await client.from(DRAFTS).update({ prices, revision: input.expectedRevision + 1, prices_updated_by: scope.userId, updated_at: new Date().toISOString() })
    .eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('id', input.draftId).eq('revision', input.expectedRevision).select('revision,prices').maybeSingle());
  if (!saved) throw new AuthError('Otra persona cambió los precios mientras escribías. Te mostramos los suyos: revísalos y guarda de nuevo.', 409);
  return saved as { revision: number; prices: Record<string, number> };
}

/** The company as the model reads it for the offer: what an administrator confirmed, «Perfil» and the «Ficha para licitaciones». */
async function offerCompany(client: SupabaseClient, job: OpportunityJob) {
  const [contextRow, profileRow, company] = await Promise.all([
    client.from('opportunity_company_context').select('offer,services,territories,exclusions').eq('organization_id', job.organization_id).maybeSingle(),
    client.from('profiles').select('company_profile,signatures').eq('id', job.requested_by).maybeSingle(),
    readCompanyFields(client, job.organization_id),
  ]);
  const context = opportunityDb(contextRow); const profile = withCompanyProfile(opportunityDb(profileRow), company);
  if (!context) throw new AuthError('Un administrador debe confirmar primero la oferta de la empresa.', 409);
  const ficha = await loadCompanyForModel(client, job.organization_id, { legal: true });
  return { offer: String(context.offer || ''), services: context.services || [], territories: context.territories || [], exclusions: context.exclusions || [],
    profile: typeof profile?.company_profile === 'string' ? profile.company_profile : undefined, extras: companyProfileExtras(profile?.signatures?.profile_extended),
    ...(ficha ? { ficha } : {}) };
}

/**
 * Changes one draft in place, only over the row the change was read from: two people saving different parts at once both keep
 * theirs (the second reads the row again and applies its change on top). The prices keep their own revision (saveOpportunityOfferPrices).
 */
async function changeOfferDraft(client: SupabaseClient, organizationId: string, id: string, draftId: string, change: (draft: EditedOfferDraft) => EditedOfferDraft) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = opportunityDb(await client.from(DRAFTS).select('draft,updated_at').eq('organization_id', organizationId).eq('opportunity_id', id).eq('id', draftId).maybeSingle()) as { draft: EditedOfferDraft; updated_at: string } | null;
    if (!row) throw new AuthError('No encontramos ese borrador.', 404);
    const draft = change(row.draft);
    if (JSON.stringify(draft).length > 480_000) throw new AuthError('El borrador quedó demasiado largo. Acorta alguna parte y vuelve a guardar.', 413);
    const at = new Date().toISOString();
    const saved = opportunityDb(await client.from(DRAFTS).update({ draft, updated_at: at }).eq('organization_id', organizationId).eq('opportunity_id', id)
      .eq('id', draftId).eq('updated_at', row.updated_at).select('id').maybeSingle());
    if (saved) return draft;
  }
  throw new AuthError('El borrador cambió mientras guardabas. Vuelve a intentarlo.', 409);
}

/** The part as the person saw it when they started: its edit, or the AI's text (null). Someone else saved it since: theirs stays. */
const assertPartBase = (draft: EditedOfferDraft, part: string, base: string | null, message: string) => {
  if (offerPartText(draft, part) === null) throw new AuthError('Esa parte ya no está en el borrador.', 404);
  if ((offerPartEdit(draft, part)?.at ?? null) !== base) throw new AuthError(message, 409);
};

/** A part of the offer in the team's words, or back to the AI's text (OPP-24). Anyone who works the opportunity can write it. */
export async function saveOpportunityOfferPart(client: SupabaseClient, scope: WorkScope, id: string, input: { draftId: string; part: string; text: string | null; base: string | null }) {
  await assertOpportunityRead(client, scope, id);
  const at = new Date().toISOString();
  const draft = await changeOfferDraft(client, scope.organizationId, id, input.draftId, current => {
    assertPartBase(current, input.part, input.base, 'Otra persona cambió esta parte mientras escribías. Ya ves su versión: revísala y vuelve a guardar.');
    return editOfferPart(current, input.part, { text: input.text, by: scope.userId, at });
  });
  return { edit: offerPartEdit(draft, input.part), draft };
}

/** «Revisado por»: whoever is in charge or an administrator reads the whole offer before it is handed in, and says so. */
export async function reviewOpportunityOffer(client: SupabaseClient, scope: WorkScope, id: string, input: { draftId: string; reviewed: boolean }) {
  await assertOpportunityRead(client, scope, id);
  const work = opportunityDb(await client.from('opportunity_work').select('responsible_id').eq('organization_id', scope.organizationId).eq('opportunity_id', id).maybeSingle()) as { responsible_id: string | null } | null;
  if (!canSetPrices(scope.role, scope.userId, work?.responsible_id)) throw new AuthError('Da por revisada la oferta quien está a cargo de la oportunidad o un administrador.', 403);
  const at = new Date().toISOString();
  const draft = await changeOfferDraft(client, scope.organizationId, id, input.draftId, current => ({ ...current, review: input.reviewed ? { by: scope.userId, at } : null }));
  if (input.reviewed) await addOpportunityActivity(client, scope, id, 'offer', 'Oferta revisada antes de presentarla', { draftId: input.draftId }, `offer-review:${input.draftId}:${at}`).catch(() => undefined);
  return { review: draft.review ?? null, draft };
}

/** «Pedir cambios a la IA» on one part: queued like the draft, and written over that part when it is ready. */
export async function enqueueOpportunityOfferRewrite(client: SupabaseClient, scope: WorkScope, id: string, input: { draftId: string; part: string; instructions: string; base: string | null; requestId: string }) {
  await assertOpportunityRead(client, scope, id);
  const row = opportunityDb(await client.from(DRAFTS).select('draft').eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('id', input.draftId).maybeSingle()) as { draft: EditedOfferDraft } | null;
  if (!row) throw new AuthError('No encontramos ese borrador.', 404);
  assertPartBase(row.draft, input.part, input.base, 'Otra persona cambió esta parte. Ya ves su versión: pide los cambios sobre ella.');
  const key = `offer-part:${id}:${input.requestId}`;
  const payload = { draftId: input.draftId, part: input.part, instructions: input.instructions.trim().slice(0, 800), base: input.base };
  const job = opportunityDb(await client.from('opportunity_jobs').upsert({ organization_id: scope.organizationId, opportunity_id: id, requested_by: scope.userId,
    kind: 'offer', dedupe_key: key, payload }, { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true }).select('id').maybeSingle());
  if (job?.id) return job.id as string;
  const found = opportunityDb(await client.from('opportunity_jobs').select('id').eq('organization_id', scope.organizationId).eq('dedupe_key', key).single());
  if (!found) throw new AuthError('No se pudo recuperar el trabajo.', 503);
  return found.id as string;
}

async function rewriteOfferPart(client: SupabaseClient, job: OpportunityJob, id: string) {
  const { draftId, part, instructions } = job.payload as { draftId: string; part: string; instructions: string; base: string | null };
  const base = (job.payload.base ?? null) as string | null;
  const row = opportunityDb(await client.from(DRAFTS).select('draft,report_id').eq('organization_id', job.organization_id).eq('opportunity_id', id).eq('id', draftId).maybeSingle()) as { draft: EditedOfferDraft; report_id: string | null } | null;
  if (!row) throw new AuthError('Ese borrador ya no está.', 409);
  const changed = 'Otra persona cambió esta parte antes de que la IA la reescribiera. Pide los cambios de nuevo sobre su versión.';
  assertPartBase(row.draft, part, base, changed);
  const [itemRow, reportRow, company] = await Promise.all([
    client.from('commercial_opportunities').select('title,buyer_name,company_name').eq('organization_id', job.organization_id).eq('id', id).single(),
    row.report_id ? client.from('opportunity_reports').select('report').eq('organization_id', job.organization_id).eq('id', row.report_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    offerCompany(client, job),
  ]);
  const item = opportunityDb(itemRow); const report = (opportunityDb(reportRow) as { report?: OpportunityReport } | null)?.report ?? null;
  if (!item) throw new AuthError('No encontramos esa oportunidad.', 404);
  const current = withOfferEdits(row.draft);
  const prompt = offerPartPrompt({ opportunity: { title: item.title, buyer: item.buyer_name || item.company_name }, draft: current, part,
    text: offerPartText(current, part) ?? '', instructions, company, report });
  const result = await opportunityGenerate(client, job, { step: `offer-part:${createHash('sha256').update(prompt).digest('hex')}`, category: 'research', role: 'report',
    schema: offerPartSchema, output: 4000, prompt });
  const text = result.text.trim();
  if (!text) throw new AuthError('La IA no devolvió texto para esa parte. Pide los cambios de nuevo.', 422);
  await changeOfferDraft(client, job.organization_id, id, draftId, latest => {
    assertPartBase(latest, part, base, changed);
    return editOfferPart(latest, part, { text, by: job.requested_by, at: new Date().toISOString(), ai: true });
  });
  return { offerPart: part };
}
