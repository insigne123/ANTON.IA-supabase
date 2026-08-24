import { createHash } from 'node:crypto';

import { buildResearchRequestIdempotencyKeyV1 } from '@/lib/research-contracts';
import {
  NativeResearchBatchRequestSchema,
  NativeResearchLeadSchema,
  type NativeResearchLead,
  type NativeResearchOptions,
} from '@/lib/native-research-contracts';
import {
  abortHeldNativeResearchClaim,
  deriveNativeResearchLeadRef,
  enqueueHeldNativeResearch,
  releaseHeldNativeResearchClaim,
  settleNativeResearchRunItems,
} from '@/lib/server/native-research';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export type NativeResearchRunAccess = {
  organizationId: string;
  userId: string;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function leadKey(lead: NativeResearchLead, fallback: string) {
  return text(lead.id || lead.email || lead.linkedinUrl || fallback).toLowerCase();
}

function stableHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex').slice(0, 32);
}

function uniqueLeads(leads: NativeResearchLead[]) {
  const seen = new Set<string>();
  return leads.filter((lead) => {
    const key = deriveNativeResearchLeadRef(lead).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nativeResearchRunRequestKey(input: {
  access: NativeResearchRunAccess;
  leads: NativeResearchLead[];
  options: NativeResearchOptions;
  now?: number;
}) {
  const windowMs = input.options.refresh ? 2 * 60_000 : 24 * 60 * 60_000;
  const freshnessBucket = Math.floor((input.now ?? Date.now()) / windowMs);
  return `native-run:v1:${stableHash({
    organizationId: input.access.organizationId,
    userId: input.access.userId,
    options: input.options,
    freshnessBucket,
    leads: input.leads.map((lead) => deriveNativeResearchLeadRef(lead).toLowerCase()).sort(),
  })}`;
}

async function existingActiveRun(input: {
  admin: ReturnType<typeof getSupabaseAdminClient>;
  access: NativeResearchRunAccess;
  requestKey: string;
}) {
  const { data: runs, error: runError } = await input.admin
    .from('research_runs')
    .select('id')
    .eq('organization_id', input.access.organizationId)
    .eq('user_id', input.access.userId)
    .in('status', ['queued', 'running'])
    .contains('request_payload', { request_key: input.requestKey })
    .order('created_at', { ascending: false })
    .limit(1);
  if (runError) throw runError;
  const runId = text(runs?.[0]?.id);
  if (!runId) return null;

  const { data: items, error: itemsError } = await input.admin
    .from('research_run_items')
    .select('job_id,lead_ref,position,status')
    .eq('run_id', runId)
    .eq('organization_id', input.access.organizationId)
    .eq('user_id', input.access.userId)
    .order('position', { ascending: true });
  if (itemsError) throw itemsError;
  return {
    runId,
    items: (items || []).map((item: any) => ({
      jobId: text(item.job_id),
      leadRef: text(item.lead_ref),
      position: Number(item.position) || 0,
      status: text(item.status) || 'queued',
      reused: true,
    })),
  };
}

function storedLead(row: Record<string, any>): NativeResearchLead | null {
  const fallback = {
    id: text(row.lead_id) || null,
    email: text(row.email) || null,
    companyName: text(row.company_name) || null,
    companyDomain: text(row.company_domain) || null,
  };
  const candidates = [
    object(object(row.request_payload).lead),
    object(object(row.result_payload).lead),
    fallback,
  ];
  for (const candidate of candidates) {
    const parsed = NativeResearchLeadSchema.safeParse(candidate);
    if (!parsed.success) continue;
    if (text(parsed.data.id || parsed.data.email || parsed.data.linkedinUrl || parsed.data.companyDomain || parsed.data.companyName)) return parsed.data;
  }
  return null;
}

function latestReprocessableLeads(rows: unknown[], limit: number) {
  const seen = new Set<string>();
  const leads: NativeResearchLead[] = [];
  for (const value of rows) {
    const row = object(value);
    const lead = storedLead(row);
    if (!lead) continue;
    const key = leadKey(lead, text(row.lead_ref));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    leads.push(lead);
    if (leads.length >= limit) break;
  }
  return leads;
}

export async function enqueueNativeResearchRun(input: {
  access: NativeResearchRunAccess;
  leads: NativeResearchLead[];
  options?: Partial<NativeResearchOptions>;
}) {
  const parsed = NativeResearchBatchRequestSchema.parse({ leads: input.leads, options: input.options || {} });
  const leads = uniqueLeads(parsed.leads);
  const requestKey = nativeResearchRunRequestKey({ access: input.access, leads, options: parsed.options });
  const admin = getSupabaseAdminClient();
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const { error: runError } = await admin.from('research_runs').insert({
    id: runId,
    organization_id: input.access.organizationId,
    user_id: input.access.userId,
    status: 'queued',
    total_count: leads.length,
    request_payload: { options: parsed.options, request_key: requestKey },
    created_at: now,
    updated_at: now,
  });
  if (runError) {
    if (String((runError as any).code || '') !== '23505') throw runError;
    const existing = await existingActiveRun({ admin, access: input.access, requestKey });
    if (existing) return { ...existing, options: parsed.options };
    throw runError;
  }

  const held: Array<Awaited<ReturnType<typeof enqueueHeldNativeResearch>>> = [];
  const items: Array<{ jobId: string; reportId: string; status: string; reused: boolean; leadRef: string; position: number }> = [];
  try {
    for (const [position, lead] of leads.entries()) {
      const leadRef = deriveNativeResearchLeadRef(lead);
      const requestIdempotencyKey = buildResearchRequestIdempotencyKeyV1({
        ownerId: input.access.userId,
        leadRef,
        email: lead.email || null,
        companyDomain: lead.companyDomain || lead.companyWebsite || null,
        provider: 'native-research-v1',
        jobIdentity: requestKey,
      });
      const job = await enqueueHeldNativeResearch({
        access: input.access,
        lead,
        options: parsed.options,
        requestIdempotencyKey,
        runId,
      });
      held.push(job);
      const { error: itemError } = await admin.from('research_run_items').upsert({
        run_id: runId,
        organization_id: input.access.organizationId,
        user_id: input.access.userId,
        job_id: job.jobId,
        lead_ref: leadRef,
        position,
        status: job.status,
        created_at: now,
        updated_at: now,
      }, { onConflict: 'run_id,job_id' });
      if (itemError) throw itemError;
      items.push({
        jobId: job.jobId,
        reportId: job.reportId,
        status: job.status,
        reused: job.reused,
        leadRef,
        position,
      });
    }

    for (const job of held) {
      if (!job.claimToken) continue;
      const released = await releaseHeldNativeResearchClaim({
        ...input.access,
        jobId: job.jobId,
        claimToken: job.claimToken,
      });
      if (!released) {
        console.warn('[native-research] run claim release was deferred to worker recovery', { jobId: job.jobId, runId });
      }
    }
  } catch (error) {
    await Promise.allSettled(held
      .filter((job) => Boolean(job.claimToken))
      .map((job) => abortHeldNativeResearchClaim({
        ...input.access,
        jobId: job.jobId,
        claimToken: job.claimToken!,
      })));
    await admin
      .from('research_runs')
      .delete()
      .eq('id', runId)
      .eq('organization_id', input.access.organizationId)
      .eq('user_id', input.access.userId);
    throw error;
  }

  await Promise.all(items
    .filter((item) => ['completed', 'partial', 'insufficient_data', 'failed', 'cancelled'].includes(item.status))
    .map((item) => settleNativeResearchRunItems({
      jobId: item.jobId,
      organizationId: input.access.organizationId,
      userId: input.access.userId,
      status: item.status,
    })));

  return { runId, items, options: parsed.options };
}

/** Requeues the latest terminal report per lead, leaving every old job and snapshot untouched. */
export async function reprocessCurrentNativeResearch(input: {
  access: NativeResearchRunAccess;
  limit: number;
}) {
  const limit = Math.max(1, Math.min(50, Math.floor(input.limit)));
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('lead_research_jobs')
    .select('lead_id,lead_ref,email,company_name,company_domain,request_payload,result_payload,updated_at')
    .eq('provider', 'native-research-v1')
    .eq('organization_id', input.access.organizationId)
    .eq('user_id', input.access.userId)
    .in('status', ['completed', 'partial', 'insufficient_data'])
    .order('updated_at', { ascending: false })
    .limit(Math.min(500, limit * 10));
  if (error) throw error;

  const leads = latestReprocessableLeads(data || [], limit);
  if (leads.length === 0) return { runId: null, items: [], count: 0 };

  const run = await enqueueNativeResearchRun({
    access: input.access,
    leads,
    options: { depth: 'deep', language: 'es', refresh: true },
  });
  return { ...run, count: leads.length };
}

export const nativeResearchRunInternals = {
  latestReprocessableLeads,
  nativeResearchRunRequestKey,
  uniqueLeads,
};
