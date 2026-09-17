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
  const lead = await auth.supabase.from('leads')
    .select('id,name,email,title,company,company_website,company_linkedin,linkedin_url,industry,city,country')
    .eq('id', leadId).eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
  if (lead.error || !lead.data) throw new Error('COWORK_RESEARCH_TARGET_UNAVAILABLE');
  return lead.data;
}

export async function startCoworkResearch(auth: AuthContext, runId: string, leadId: string) {
  const row = await coworkResearchTarget(auth, runId, leadId);
  const lead = NativeResearchLeadSchema.parse({ id: row.id, fullName: row.name || null, email: row.email || null,
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
