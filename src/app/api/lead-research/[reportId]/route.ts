import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';
import { deriveLeadResearchAccess } from '@/lib/server/lead-research-access';
import { findAuthorizedLeadResearchJob, updateLeadResearchJobStatus } from '@/lib/server/lead-research-jobs';
import {
  buildTerminalLeadResearchReport,
  getLeadResearchProviderStatus,
  storeLeadResearchReport,
} from '@/lib/server/lead-research-reports';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const DEFAULT_LEAD_RESEARCH_URL = 'https://backend-antonia--backend-apollo-leads-prod.us-central1.hosted.app/api/lead-research';

function buildLeadResearchPollUrl(reportId: string) {
  const base = String(
    process.env.ANTONIA_LEAD_RESEARCH_URL ||
    process.env.LEAD_RESEARCH_URL ||
    DEFAULT_LEAD_RESEARCH_URL,
  ).trim();

  if (!base) return '';

  try {
    const url = new URL(base);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(reportId)}`;
    url.search = '';
    return url.toString();
  } catch {
    return '';
  }
}

function parseJson(text: string) {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || 'INVALID_JSON_RESPONSE' };
  }
}

function withResearchSnapshotId(payload: any, researchSnapshotId: string | null) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const next = { ...payload };
  delete next.research_snapshot_id;
  if (next.report && typeof next.report === 'object' && !Array.isArray(next.report)) {
    next.report = { ...next.report };
    delete next.report.research_snapshot_id;
    if (researchSnapshotId) next.report.research_snapshot_id = researchSnapshotId;
  }
  if (researchSnapshotId) next.research_snapshot_id = researchSnapshotId;
  return next;
}

export async function GET(_req: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  try {
    const { reportId } = await context.params;
    const normalizedReportId = String(reportId || '').trim();
    const supabase = createRouteHandlerClient({ cookies: (() => _req.cookies) as any });
    const { data: { user } } = await supabase.auth.getUser();
    const access = await deriveLeadResearchAccess({
      sessionUserId: user?.id,
      trustedInternal: isTrustedInternalRequest(_req),
      internalUserId: _req.headers.get('x-user-id'),
      internalOrganizationId: _req.headers.get('x-organization-id'),
    });
    if (!access) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const job = await findAuthorizedLeadResearchJob(normalizedReportId, access);
    if (!job) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const endpoint = buildLeadResearchPollUrl(normalizedReportId);
    if (!endpoint) {
      return NextResponse.json({ error: 'LEAD_RESEARCH_URL_MISSING' }, { status: 500 });
    }

    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    const text = await res.text();
    const payload = parseJson(text);
    let researchSnapshotId: string | null = null;
    if (res.ok) {
      const status = getLeadResearchProviderStatus(payload, job.status || 'running');
      const terminal = buildTerminalLeadResearchReport(payload, job.leadRef, job.status || 'running');
      if (terminal) {
        const persisted = await storeLeadResearchReport({
          userId: job.userId,
          organizationId: job.organizationId,
          lead: {
            id: job.leadId,
            leadId: job.leadId,
            email: job.email,
            company: job.companyName,
            companyDomain: job.companyDomain,
          } as any,
          report: terminal.report,
        });
        if (!persisted) throw new Error('LEAD_RESEARCH_REPORT_PERSIST_FAILED');
      }
      researchSnapshotId = await updateLeadResearchJobStatus(normalizedReportId, access, status, terminal?.report);
    }
    return NextResponse.json(withResearchSnapshotId(payload, researchSnapshotId), {
      status: res.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: any) {
    return NextResponse.json({ error: 'LEAD_RESEARCH_POLL_ERROR', message: error?.message || 'Unknown poll error' }, { status: 500 });
  }
}
