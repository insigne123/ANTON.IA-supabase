import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getCoworkRun } from './runs';
import { collectCoworkLeadRows } from '@/lib/cowork/lead-export';
import { enqueueNativeResearch, findNativeResearchJob } from '@/lib/server/native-research';
import { NativeResearchLeadSchema } from '@/lib/native-research-contracts';
import { requireCoworkWorkerAccess } from './access';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export async function coworkResearchTarget(auth: AuthContext, runId: string, leadId: string) {
  z.string().uuid().parse(leadId);
  const state = await getCoworkRun(auth, runId);
  // Effects execute while the proposing run waits for approval; target scope
  // and observation checks below remain the real guards.
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) throw new Error('COWORK_RESEARCH_TARGET_UNAVAILABLE');
  const rows = collectCoworkLeadRows(state.events.filter((event: { kind: string }) => event.kind === 'tool.completed')
    .map((event: { payload: unknown }) => event.payload));
  if (!rows.some(row => row.id === leadId)) throw new Error('COWORK_RESEARCH_TARGET_UNAVAILABLE');
  return savedResearchLead(auth, leadId);
}

async function savedResearchLead(auth: AuthContext, leadId: string) {
  const lead = await auth.supabase.from('leads')
    .select('id,name,email,title,company,company_website,company_linkedin,linkedin_url,industry,city,country,apollo_id,source_provider_id')
    .eq('id', leadId).eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
  if (lead.error || !lead.data) throw new Error('COWORK_RESEARCH_TARGET_UNAVAILABLE');
  return lead.data;
}

export async function startCoworkResearch(auth: AuthContext, runId: string, leadId: string) {
  return enqueueCoworkResearch(auth, runId, await coworkResearchTarget(auth, runId, leadId));
}

/** For a saved contact the caller already tied to this work (a batch checks who is in it): same rules and the same request per work and contact. */
export async function startCoworkResearchForLead(auth: AuthContext, runId: string, leadId: string) {
  z.string().uuid().parse(leadId);
  return enqueueCoworkResearch(auth, runId, await savedResearchLead(auth, leadId));
}

async function enqueueCoworkResearch(auth: AuthContext, runId: string, row: Awaited<ReturnType<typeof savedResearchLead>>) {
  const leadId = String(row.id);
  // Regla de producto: sin correo no se investiga. Acepta correo directo o un
  // enriquecimiento ya intentado (aunque no haya encontrado nada): lo que se
  // exige es enriquecer primero, no un resultado perfecto.
  let lookupEmail: string | null = null;
  if (!row.email) {
    const lookups = () => auth.supabase.from('enriched_leads').select('id,email')
      .eq('user_id', auth.user.id).eq('organization_id', auth.organizationId);
    let attempted = await lookups().filter('data->>sourceSavedLeadId', 'eq', leadId).limit(1).maybeSingle();
    if (attempted.error) throw attempted.error;
    // A lookup made from the app («Buscar correo») is tied to the person by the provider's id, not to the saved contact.
    const providers = [row.apollo_id, row.source_provider_id].filter((key): key is string => typeof key === 'string' && key.length > 0);
    if (!attempted.data && providers.length) {
      attempted = await lookups().in('source_provider_id', [...new Set(providers)]).limit(1).maybeSingle();
      if (attempted.error) throw attempted.error;
    }
    if (!attempted.data) throw new Error('COWORK_RESEARCH_EMAIL_REQUIRED');
    lookupEmail = typeof attempted.data.email === 'string' && attempted.data.email ? attempted.data.email : null;
  }
  const lead = NativeResearchLeadSchema.parse({ id: row.id, fullName: row.name || null, email: row.email || lookupEmail,
    title: row.title || null, companyName: row.company || null, companyWebsite: row.company_website || null,
    companyLinkedinUrl: row.company_linkedin || null, linkedinUrl: row.linkedin_url || null,
    industry: row.industry || null, city: row.city || null, country: row.country || null });
  if (!lead.fullName && !lead.companyName && !lead.linkedinUrl && !lead.companyWebsite) throw new Error('COWORK_RESEARCH_IDENTITY_INSUFFICIENT');
  const access = { userId: auth.user.id, organizationId: auth.organizationId };
  await requireCoworkWorkerAccess(getSupabaseAdminClient(), access);
  const result = await enqueueNativeResearch({ access, lead, options: { depth: 'standard', language: 'es', refresh: false },
    requestIdempotencyKey: `cowork:${runId}:lead:${leadId}:research-v1` });
  await requireCoworkWorkerAccess(getSupabaseAdminClient(), access);
  return { reportId: result.reportId, status: result.status, reused: result.reused };
}

export async function getCoworkResearchStatus(auth: AuthContext, runId: string, leadId: string) {
  await coworkResearchTarget(auth, runId, leadId);
  const row = await auth.supabase.from('lead_research_jobs').select('provider_report_id')
    .eq('request_idempotency_key', `cowork:${runId}:lead:${leadId}:research-v1`)
    .eq('user_id', auth.user.id).eq('organization_id', auth.organizationId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (row.error) throw row.error;
  if (!row.data?.provider_report_id) return { status: 'not_started', reportId: null };
  const job = await findNativeResearchJob({ reportId: row.data.provider_report_id,
    access: { userId: auth.user.id, organizationId: auth.organizationId } });
  if (!job) return { status: 'not_started', reportId: null };
  return { status: job.status, reportId: job.providerReportId, snapshotId: job.researchSnapshotId };
}
