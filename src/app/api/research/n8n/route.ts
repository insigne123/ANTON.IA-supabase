import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

import { getEffectiveDailyQuotaLimits } from '@/lib/server/daily-quota-store';
import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';
import { deriveLeadResearchAccess } from '@/lib/server/lead-research-access';
import {
  claimLeadResearchRequest,
  completeLeadResearchRequestClaim,
  consumeLeadResearchRequestQuota,
  failLeadResearchRequestClaim,
  markLeadResearchRequestProviderOutcomeUnknown,
  markLeadResearchRequestProviderSubmitting,
  releaseLeadResearchRequestClaim,
  updateLeadResearchJobStatus,
} from '@/lib/server/lead-research-jobs';
import {
  executeLegacyN8nResearchRequest,
  type LegacyN8nForwardContext,
  type LegacyN8nResolvedAccess,
} from '@/lib/server/legacy-n8n-research-route';
import { requestN8nResearch } from '@/lib/server/n8n-research-client';
import { getAvailableSerpApiCredits, getSerpApiAccountStatus } from '@/lib/server/serpapi-account';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function getWebhookTimeoutMs() {
  const raw = Number(process.env.N8N_RESEARCH_TIMEOUT_MS || process.env.LEADS_N8N_TIMEOUT_MS || 120000);
  if (!Number.isFinite(raw)) return 120000;
  return Math.min(240000, Math.max(10000, Math.trunc(raw)));
}

async function resolveAccess(req: Request): Promise<LegacyN8nResolvedAccess | null> {
  const sessionSupabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await sessionSupabase.auth.getUser();
  const access = await deriveLeadResearchAccess({
    sessionUserId: user?.id,
    trustedInternal: isTrustedInternalRequest(req),
    internalUserId: req.headers.get('x-user-id'),
    internalOrganizationId: req.headers.get('x-organization-id'),
  });
  if (!access) return null;
  return {
    access,
    supabase: access.trustedInternal ? getSupabaseAdminClient() : sessionSupabase,
  };
}

async function resolveForwardContext(input: {
  supabase: any;
  userId: string;
  organizationId: string;
  suppliedUserContext: any;
}): Promise<LegacyN8nForwardContext> {
  let userContext = input.suppliedUserContext;
  let useSocialContext = false;
  let socialCreditSource: LegacyN8nForwardContext['socialCreditSource'] = 'none';
  let profile: any = null;

  try {
    const { data } = await input.supabase
      .from('profiles')
      .select('full_name, job_title, company_name, company_domain')
      .eq('id', input.userId)
      .single();
    profile = data;

    const { data: organization } = await input.supabase
      .from('organizations')
      .select('social_search_credits, feature_social_search_enabled')
      .eq('id', input.organizationId)
      .single();
    if (!organization) {
      console.warn('[research:n8n] Organization not found for ID:', input.organizationId);
    } else if (organization.feature_social_search_enabled ?? true) {
      try {
        const serpApi = await getSerpApiAccountStatus();
        if (serpApi.configured) {
          useSocialContext = Math.max(0, getAvailableSerpApiCredits(serpApi)) > 0;
          socialCreditSource = 'serpapi';
        } else if ((organization.social_search_credits ?? 0) > 0) {
          useSocialContext = true;
          socialCreditSource = 'organization';
        }
      } catch (error) {
        console.warn('[research:n8n] SerpApi account lookup failed; disabling social context:', error);
      }
    }
  } catch (error) {
    console.warn('[research:n8n] Failed to fetch user/org profile:', error);
  }

  if (!userContext) {
    userContext = {
      id: input.userId,
      name: profile?.full_name || null,
      jobTitle: profile?.job_title || null,
      company: {
        name: profile?.company_name || null,
        domain: profile?.company_domain || null,
      },
    };
  }
  return { userContext, useSocialContext, socialCreditSource };
}

export async function GET(): Promise<Response> {
  const hasUrl = Boolean(process.env.N8N_RESEARCH_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL);
  return Response.json({ ok: true, hasUrl }, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(req: Request): Promise<Response> {
  try {
    return await executeLegacyN8nResearchRequest(req, {
      webhook: process.env.N8N_RESEARCH_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL || null,
      apiKey: process.env.N8N_API_KEY,
      timeoutMs: getWebhookTimeoutMs(),
      resolveAccess,
      resolveForwardContext,
      getResearchLimit: async ({ userId, organizationId }) => {
        const limits = await getEffectiveDailyQuotaLimits({ userId, organizationId });
        return limits.research;
      },
      consumeQuota: consumeLeadResearchRequestQuota,
      claimRequest: claimLeadResearchRequest,
      markProviderSubmitting: markLeadResearchRequestProviderSubmitting,
      completeClaim: completeLeadResearchRequestClaim,
      releaseClaim: releaseLeadResearchRequestClaim,
      failClaim: failLeadResearchRequestClaim,
      markProviderUnknown: markLeadResearchRequestProviderOutcomeUnknown,
      persistTerminalResult: async ({ providerReportId, access, report }) => {
        await updateLeadResearchJobStatus(providerReportId, access, 'completed', report);
      },
      requestProvider: requestN8nResearch,
      now: () => new Date(),
    });
  } catch (error: any) {
    console.error('[research:n8n] request failed:', error);
    return Response.json({ error: 'RESEARCH_PROXY_ERROR', message: error?.message || 'Unknown error' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
