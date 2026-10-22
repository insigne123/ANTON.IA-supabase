// «¿Cumplimos?»: the requirements of an opportunity's latest report read against the company's tender profile, and the
// answers to the AI's questions saved back into that profile for the next tenders.
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@/lib/server/auth-utils';
import type { WorkScope } from '@/lib/commercial-opportunities/workspace';
import type { OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import { femaleLedSeal, readTenderProfile, tenderProfileForModel } from '@/lib/commercial-opportunities/tender-profile';
import { requirementFitPrompt, requirementFitSchema, resolveRequirementFit, type ReportFit } from '@/lib/commercial-opportunities/requirement-fit';
import { opportunityDb } from './workspace-store';
import { assertOpportunityRead } from './workspace-access';
import { opportunityGenerate, type OpportunityJob } from './workspace-ai';
import { loadCompanyDocuments } from './tender-profile-read';
import { companyDocumentsForModel } from '@/lib/commercial-opportunities/company-documents';

const TABLE = 'opportunity_requirement_fit';
/** The kinds whose reports carry requirements to meet: a LinkedIn signal has things to validate, not bases. */
const FIT_KINDS = ['tender', 'compra_agil', 'private'];

const fitFromRow = (row: any): ReportFit => ({ items: row.items || {}, noRestsOnRequirements: Boolean(row.no_rests_on_requirements),
  profileRevision: Number(row.profile_revision), createdAt: row.created_at });

/** What the report shows: the latest reading of its requirements, and the profile's revision to tell if it is current. */
export async function readOpportunityFit(client: SupabaseClient, organizationId: string, reportId: string | null | undefined) {
  const [fit, profile] = await Promise.all([
    reportId ? client.from(TABLE).select('items,no_rests_on_requirements,profile_revision,created_at').eq('organization_id', organizationId).eq('report_id', reportId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null, error: null }),
    client.from('opportunity_tender_profile').select('revision,answers').eq('organization_id', organizationId).maybeSingle(),
  ]);
  // Before its migration the table is missing: the report reads as before.
  if (fit.error) return { available: false, latest: null, profileRevision: null, seal: null };
  const stored = profile.error || !profile.data ? null : profile.data;
  return { available: true, latest: fit.data ? fitFromRow(fit.data) : null, profileRevision: stored ? Number(stored.revision) : null,
    seal: stored ? femaleLedSeal(readTenderProfile(stored.answers)) : null };
}

/** A reading of the latest report with the current profile, once per report and profile version. Returns the job's key. */
export async function enqueueRequirementFit(client: SupabaseClient, scope: WorkScope, opportunityId: string) {
  await assertOpportunityRead(client, scope, opportunityId);
  return enqueueFitFor(client, scope.organizationId, scope.userId, opportunityId);
}
async function enqueueFitFor(client: SupabaseClient, organizationId: string, userId: string, opportunityId: string) {
  const [item, report, profile] = await Promise.all([
    client.from('commercial_opportunities').select('kind').eq('organization_id', organizationId).eq('id', opportunityId).maybeSingle().then(opportunityDb),
    client.from('opportunity_reports').select('id').eq('organization_id', organizationId).eq('opportunity_id', opportunityId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle().then(opportunityDb),
    client.from('opportunity_tender_profile').select('revision').eq('organization_id', organizationId).maybeSingle(),
  ]);
  if (!item || !FIT_KINDS.includes(item.kind)) throw new AuthError('Esta oportunidad no tiene requisitos de bases que revisar.', 409);
  if (!report) throw new AuthError('Genera primero el informe.', 409);
  if (profile.error || !profile.data) throw new AuthError('Un administrador debe completar primero la ficha para licitaciones.', 409);
  const revision = Number(profile.data.revision);
  const key = `fit:${report.id}:${revision}`;
  opportunityDb(await client.from('opportunity_jobs').upsert({ organization_id: organizationId, opportunity_id: opportunityId, requested_by: userId, kind: 'fit',
    dedupe_key: key, payload: { reportId: report.id, profileRevision: revision } }, { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true }));
  return key;
}
/** After a report is ready: its requirements are read against the profile, when there is one. Never fails the report. */
export async function enqueueFitAfterReport(client: SupabaseClient, job: OpportunityJob) {
  if (!job.opportunity_id) return null;
  return enqueueFitFor(client, job.organization_id, job.requested_by, job.opportunity_id).catch(() => null);
}

/** The worker's side: one Haiku reading, kept honest (resolveRequirementFit), saved for the report and the profile version. */
export async function runRequirementFit(client: SupabaseClient, job: OpportunityJob) {
  await assertOpportunityRead(client, { organizationId: job.organization_id, userId: job.requested_by }, job.opportunity_id!);
  const [saved, profileRow, context, documents] = await Promise.all([
    client.from('opportunity_reports').select('id,report').eq('organization_id', job.organization_id).eq('opportunity_id', job.opportunity_id).eq('id', job.payload.reportId)
      .maybeSingle().then(opportunityDb),
    client.from('opportunity_tender_profile').select('answers,revision').eq('organization_id', job.organization_id).maybeSingle().then(opportunityDb),
    client.from('opportunity_company_context').select('offer').eq('organization_id', job.organization_id).maybeSingle().then(opportunityDb),
    loadCompanyDocuments(client, job.organization_id),
  ]);
  if (!saved) throw new AuthError('El informe cambió. Vuelve a revisarlo con tu ficha.', 409);
  if (!profileRow || Number(profileRow.revision) !== Number(job.payload.profileRevision)) throw new AuthError('La ficha cambió. Vuelve a revisarlo con tu ficha.', 409);
  const report = saved.report as OpportunityReport;
  const answer = await opportunityGenerate(client, job, { step: 'fit', category: 'research', role: 'specialist', schema: requirementFitSchema, output: 6000,
    prompt: requirementFitPrompt({ report, offer: String(context?.offer || ''), ficha: { ...tenderProfileForModel(readTenderProfile(profileRow.answers)),
      // A current F30 or ISO certificate in the folder is a fact too; a lapsed one says so.
      ...(documents.length ? { documentosDeLaEmpresa: companyDocumentsForModel(documents) } : {}) } }) });
  const fit = resolveRequirementFit(report, answer, Number(profileRow.revision));
  opportunityDb(await client.from(TABLE).upsert({ organization_id: job.organization_id, opportunity_id: job.opportunity_id, report_id: saved.id,
    profile_revision: fit.profileRevision, items: fit.items, no_rests_on_requirements: fit.noRestsOnRequirements },
    { onConflict: 'report_id,profile_revision', ignoreDuplicates: true }));
  return { requirements: Object.keys(fit.items).length };
}

/**
 * An answer to one of the AI's questions («¿Pueden entregar una boleta por $4.500.000?» → «Sí»), saved in the profile so
 * the next tenders know it. Anyone working the opportunity may answer; the profile's revision guards concurrent writes.
 */
export async function answerFitQuestion(client: SupabaseClient, scope: WorkScope, opportunityId: string, input: { question: string; answer: string }) {
  await assertOpportunityRead(client, scope, opportunityId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = opportunityDb(await client.from('opportunity_tender_profile').select('answers,revision').eq('organization_id', scope.organizationId).maybeSingle());
    if (!row) throw new AuthError('Un administrador debe completar primero la ficha para licitaciones.', 409);
    const profile = readTenderProfile(row.answers);
    const question = input.question.replace(/\s+/g, ' ').trim().slice(0, 320);
    // The same question answered again replaces the earlier answer; the oldest go first past 60.
    const notes = [...profile.notes.filter(note => note.question !== question), { question, answer: input.answer.replace(/\s+/g, ' ').trim().slice(0, 500), at: new Date().toISOString() }].slice(-60);
    const updated = opportunityDb(await client.from('opportunity_tender_profile').update({ answers: { ...profile, notes }, revision: Number(row.revision) + 1,
      updated_by: scope.userId, updated_at: new Date().toISOString() }).eq('organization_id', scope.organizationId).eq('revision', row.revision).select('revision').maybeSingle());
    if (updated) return Number(updated.revision);
  }
  throw new AuthError('La ficha cambió mientras respondías. Intenta de nuevo.', 409);
}
