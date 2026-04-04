import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adaptLeadResearchResponseToReport } from '@/lib/lead-research';
import { storeLeadResearchReport } from '@/lib/server/lead-research-reports';

import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function hasN8nResearchWebhook() {
  return Boolean(
    String(process.env.N8N_RESEARCH_WEBHOOK_URL || '').trim() ||
    String(process.env.N8N_WEBHOOK_URL || '').trim()
  );
}

async function resolveUserId(req: NextRequest) {
  const userIdFromHeader = req.headers.get('x-user-id')?.trim() || '';
  if (userIdFromHeader) {
    if (!isTrustedInternalRequest(req)) {
      return { error: NextResponse.json({ error: 'UNAUTHORIZED_INTERNAL_REQUEST' }, { status: 401 }) };
    }
    return { userId: userIdFromHeader };
  }

  const supabase = createRouteHandlerClient({ cookies: (() => req.cookies) as any });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) {
    return { error: NextResponse.json({ error: 'UNAUTHORIZED', message: 'User must be logged in' }, { status: 401 }) };
  }

  return { userId: user.id };
}

function buildInternalN8nUrl(req: NextRequest) {
  const candidates = [
    process.env.CANONICAL_APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    (() => {
      const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
      const proto = req.headers.get('x-forwarded-proto') || 'https';
      return host ? `${proto}://${host}` : '';
    })(),
    req.url,
  ];

  for (const candidate of candidates) {
    const trimmed = String(candidate || '').trim();
    if (!trimmed) continue;
    try {
      return new URL('/api/research/n8n', trimmed);
    } catch {
      continue;
    }
  }

  return new URL('/api/research/n8n', req.url);
}

function buildLeadRef(body: any) {
  return String(
    body?.lead_ref ||
    body?.id ||
    body?.email ||
    body?.linkedinUrl ||
    body?.fullName ||
    body?.lead?.id ||
    body?.lead?.email ||
    body?.lead?.linkedin_url ||
    `${body?.lead?.full_name || ''}|${body?.company?.name || body?.company?.domain || ''}`
  ).trim();
}

function mapSource(source: any) {
  const url = String(source?.url || '').trim();
  if (!url) return null;
  return {
    title: String(source?.title || source?.name || '').trim() || undefined,
    url,
  };
}

function buildEmptyCross(body: any) {
  return {
    company: {
      name: String(body?.company?.name || 'Empresa').trim() || 'Empresa',
      domain: String(body?.company?.domain || '').trim() || undefined,
      linkedin: String(body?.company?.linkedin_url || '').trim() || undefined,
      industry: String(body?.company?.industry || '').trim() || undefined,
      country: String(body?.company?.country || '').trim() || undefined,
      website: String(body?.company?.website_url || '').trim() || undefined,
    },
    overview: '',
    pains: [],
    opportunities: [],
    risks: [],
    valueProps: [],
    useCases: [],
    talkTracks: [],
    subjectLines: [],
    emailDraft: { subject: '', body: '' },
    sources: [],
  };
}

function normalizeN8nResearchResponse(payload: any, originalBody: any) {
  const reports = Array.isArray(payload?.reports) ? payload.reports : [];
  const firstReport = reports[0] || null;
  const leadRef = buildLeadRef(originalBody);
  const rawCross = firstReport?.cross || firstReport?.report || firstReport?.data || null;
  const cross = rawCross && typeof rawCross === 'object'
    ? {
        ...buildEmptyCross(originalBody),
        ...rawCross,
        company: {
          ...buildEmptyCross(originalBody).company,
          ...(rawCross?.company || {}),
        },
        emailDraft: {
          subject: String(rawCross?.emailDraft?.subject || '').trim(),
          body: String(rawCross?.emailDraft?.body || '').trim(),
        },
        pains: Array.isArray(rawCross?.pains) ? rawCross.pains : [],
        opportunities: Array.isArray(rawCross?.opportunities) ? rawCross.opportunities : [],
        risks: Array.isArray(rawCross?.risks) ? rawCross.risks : [],
        valueProps: Array.isArray(rawCross?.valueProps) ? rawCross.valueProps : [],
        useCases: Array.isArray(rawCross?.useCases) ? rawCross.useCases : [],
        talkTracks: Array.isArray(rawCross?.talkTracks) ? rawCross.talkTracks : [],
        subjectLines: Array.isArray(rawCross?.subjectLines) ? rawCross.subjectLines : [],
        sources: Array.isArray(rawCross?.sources) ? rawCross.sources.map(mapSource).filter(Boolean) : [],
      }
    : buildEmptyCross(originalBody);

  const sources = Array.isArray(cross.sources) ? cross.sources : [];
  const warnings = [
    ...(Array.isArray(payload?.skipped) ? payload.skipped : []),
    ...(Array.isArray(payload?.warnings) ? payload.warnings : []),
    ...(payload?.error ? [String(payload.error)] : []),
  ].filter(Boolean);

  const hasMeaningfulContent = Boolean(
    cross.overview ||
    cross.pains.length ||
    cross.opportunities.length ||
    cross.talkTracks.length ||
    sources.length
  );

  return {
    report_id: String(firstReport?.id || `${leadRef || 'lead'}:${Date.now()}`),
    lead_ref: leadRef || null,
    status: hasMeaningfulContent ? 'completed' : 'insufficient_data',
    provider: 'n8n',
    generated_at: String(firstReport?.createdAt || new Date().toISOString()),
    cache_hit: false,
    warnings,
    company: {
      name: String(firstReport?.company?.name || cross.company.name || originalBody?.company?.name || 'Empresa'),
      domain: String(firstReport?.company?.domain || cross.company.domain || originalBody?.company?.domain || '').trim() || undefined,
      website_url: String(cross.company.website || originalBody?.company?.website_url || '').trim() || undefined,
      linkedin_url: String(cross.company.linkedin || originalBody?.company?.linkedin_url || '').trim() || undefined,
      industry: String(cross.company.industry || originalBody?.company?.industry || '').trim() || undefined,
      country: String(cross.company.country || originalBody?.company?.country || '').trim() || undefined,
      size: originalBody?.company?.size,
    },
    website_summary: {
      overview: cross.overview || null,
      services: Array.isArray(cross.useCases) ? cross.useCases : [],
      sources,
    },
    signals: [],
    existing_compat: {
      cross,
    },
    sources,
    diagnostics: {
      provider: 'n8n',
      report_count: reports.length,
    },
    raw: payload,
  };
}

function buildLegacyN8nPayload(body: any, userId: string) {
  const lead = body?.lead || {};
  const company = body?.company || {};
  const seller = body?.seller_context || {};
  const userContext = body?.user_context || body?.userContext || {};
  const leadRef = buildLeadRef(body);

  return {
    companies: [
      {
        leadRef,
        targetCompany: {
          name: company?.name || body?.companyName || null,
          domain: company?.domain || body?.companyDomain || null,
          linkedin: company?.linkedin_url || company?.linkedin || null,
          country: company?.country || null,
          industry: company?.industry || null,
          website: company?.website_url || company?.website || null,
        },
        lead: {
          id: lead?.id || null,
          fullName: lead?.full_name || lead?.fullName || null,
          title: lead?.title || null,
          email: lead?.email || null,
          linkedinUrl: lead?.linkedin_url || lead?.linkedinUrl || null,
        },
        meta: {
          leadRef,
        },
      },
    ],
    userCompanyProfile: {
      name: seller?.company_name || 'Mi Empresa',
      sector: seller?.sector || null,
      description: seller?.description || null,
      services: Array.isArray(seller?.services) ? seller.services : [],
      valueProposition: seller?.value_proposition || seller?.valueProposition || null,
      website: seller?.company_domain || null,
    },
    id: lead?.id || null,
    fullName: lead?.full_name || lead?.fullName || null,
    title: lead?.title || null,
    email: lead?.email || null,
    linkedinUrl: lead?.linkedin_url || lead?.linkedinUrl || null,
    companyName: company?.name || body?.companyName || null,
    companyDomain: company?.domain || body?.companyDomain || null,
    userContext: {
      id: userContext?.id || userId,
      name: userContext?.name || null,
      jobTitle: userContext?.job_title || userContext?.jobTitle || null,
      company: {
        name: seller?.company_name || null,
        domain: seller?.company_domain || null,
      },
    },
  };
}

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      endpoint: '/api/research/n8n',
      provider: 'n8n',
      hasUrl: hasN8nResearchWebhook(),
    },
    { status: 200 },
  );
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveUserId(req);
    if ('error' in ctx) return ctx.error;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
    }

    const outgoing = buildLegacyN8nPayload({
      ...body,
      user_id: body?.user_id || ctx.userId,
    }, ctx.userId);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    const cookie = req.headers.get('cookie');
    if (cookie) headers.cookie = cookie;
    headers['x-user-id'] = ctx.userId;
    const internalSecret = req.headers.get('x-internal-api-secret') || String(process.env.INTERNAL_API_SECRET || '').trim();
    if (internalSecret) headers['x-internal-api-secret'] = internalSecret;

    const res = await fetch(buildInternalN8nUrl(req), {
      method: 'POST',
      headers,
      cache: 'no-store',
      body: JSON.stringify(outgoing),
    });

    const text = await res.text();
    let payload: any = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text || 'INVALID_N8N_RESPONSE' };
    }

    if (!res.ok) {
      return NextResponse.json(payload, {
        status: res.status,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const normalized = normalizeN8nResearchResponse(payload, body);

    try {
      const { data: member } = await createRouteHandlerClient({ cookies: (() => req.cookies) as any })
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', ctx.userId)
        .limit(1)
        .maybeSingle();

      const report = adaptLeadResearchResponseToReport(normalized, normalized.lead_ref || buildLeadRef(body));
      await storeLeadResearchReport({
        userId: ctx.userId,
        organizationId: body?.organization_id || member?.organization_id || null,
        lead: {
          id: body?.lead?.id || body?.id || null,
          leadId: body?.lead?.id || body?.id || null,
          name: body?.lead?.full_name || body?.lead?.fullName || body?.fullName || null,
          email: body?.lead?.email || body?.email || null,
          company: body?.company?.name || body?.companyName || null,
          companyDomain: body?.company?.domain || body?.companyDomain || null,
        } as any,
        report,
      });
    } catch (cacheError) {
      console.warn('[lead-research] cache store failed:', cacheError);
    }

    return NextResponse.json(normalized, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: any) {
    console.error('[lead-research] n8n proxy error:', error);
    return NextResponse.json({ error: 'LEAD_RESEARCH_PROXY_ERROR', message: error?.message || 'Unknown proxy error' }, { status: 500 });
  }
}
