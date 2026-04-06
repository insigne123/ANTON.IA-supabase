import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';
import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PendingLeadRow = {
  id: string;
  user_id?: string | null;
  organization_id?: string | null;
  full_name?: string | null;
  company_name?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  phone_numbers?: any;
  primary_phone?: string | null;
  enrichment_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  data?: Record<string, any> | null;
};

const STALE_PENDING_PHONE_MS = 20 * 60 * 1000;

type PeopleSearchRow = {
  id?: string | null;
  name?: string | null;
  org_name?: string | null;
  organization_name?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  phone_numbers?: any;
  primary_phone?: string | null;
  enrichment_status?: string | null;
};

function normalizeEmail(value?: string | null) {
  const email = String(value || '').trim().toLowerCase();
  return email && email.includes('@') ? email : '';
}

function normalizeNameCompany(name?: string | null, company?: string | null) {
  const left = String(name || '').trim().toLowerCase();
  const right = String(company || '').trim().toLowerCase();
  return left && right ? `${left}::${right}` : '';
}

function buildLinkedinUrlVariants(value?: string | null) {
  const normalized = normalizeLinkedinProfileUrl(value);
  if (!normalized) return [] as string[];

  try {
    const url = new URL(normalized);
    const path = url.pathname.replace(/\/$/, '');
    return Array.from(new Set([
      normalized,
      `https://www.linkedin.com${path}`,
      `http://www.linkedin.com${path}`,
      `https://linkedin.com${path}`,
      `http://linkedin.com${path}`,
    ]));
  } catch {
    return [normalized];
  }
}

function parsePhoneNumbers(value: any) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function pickPrimaryPhone(row: PeopleSearchRow) {
  const direct = String(row.primary_phone || '').trim();
  if (direct) return direct;
  const phoneNumbers = parsePhoneNumbers(row.phone_numbers);
  const first = phoneNumbers.find((phone: any) => String(phone?.sanitized_number || '').trim()) || phoneNumbers[0];
  return String(first?.sanitized_number || first?.raw_number || '').trim() || null;
}

function getApolloId(row: PendingLeadRow) {
  return String(row.data?.apolloId || row.data?.apollo_id || '').trim();
}

function isLeadPendingTooLong(row: PendingLeadRow) {
  const reference = new Date(row.updated_at || row.created_at || 0).getTime();
  if (!Number.isFinite(reference) || reference <= 0) return false;
  return Date.now() - reference >= STALE_PENDING_PHONE_MS;
}

async function resolveUserContext(req: NextRequest) {
  const headerUserId = req.headers.get('x-user-id')?.trim() || '';
  if (headerUserId) {
    if (!isTrustedInternalRequest(req)) {
      return { error: NextResponse.json({ error: 'UNAUTHORIZED_INTERNAL_REQUEST' }, { status: 401 }) };
    }
    return { userId: headerUserId };
  }

  const supabase = createRouteHandlerClient({ cookies: (() => req.cookies) as any });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  }

  return { userId: user.id };
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveUserContext(req);
    if ('error' in ctx) return ctx.error;

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const requestedIds = Array.isArray(body?.ids)
      ? body.ids.map((value: any) => String(value || '').trim()).filter(Boolean)
      : [];

    const admin = getSupabaseAdminClient();

    const { data: memberships } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', ctx.userId);

    const orgIds = Array.from(new Set(
      ((memberships || []) as Array<{ organization_id?: string | null }>)
        .map((row) => String(row.organization_id || '').trim())
        .filter(Boolean)
    ));

    let pendingQuery = admin
      .from('enriched_leads')
      .select('id, user_id, organization_id, full_name, company_name, email, linkedin_url, phone_numbers, primary_phone, enrichment_status, created_at, updated_at, data')
      .eq('enrichment_status', 'pending_phone')
      .limit(requestedIds.length > 0 ? Math.max(requestedIds.length, 1) : 50);

    if (requestedIds.length > 0) {
      pendingQuery = pendingQuery.in('id', requestedIds);
    }

    if (orgIds.length > 0) {
      pendingQuery = pendingQuery.or(`user_id.eq.${ctx.userId},organization_id.in.(${orgIds.join(',')}),organization_id.is.null`);
    } else {
      pendingQuery = pendingQuery.eq('user_id', ctx.userId);
    }

    const { data: pendingRows, error: pendingError } = await pendingQuery;
    if (pendingError) {
      throw pendingError;
    }

    const pending = (pendingRows || []) as PendingLeadRow[];
    if (pending.length === 0) {
      return NextResponse.json({ checked: 0, updated: 0, completedWithoutPhone: 0, stillPending: 0, updatedIds: [] }, { status: 200 });
    }

    const apolloIds = Array.from(new Set(pending.map(getApolloId).filter(Boolean)));
    const linkedinUrls = Array.from(new Set(
      pending.flatMap((row) => buildLinkedinUrlVariants(row.linkedin_url)).filter(Boolean)
    ));
    const emails = Array.from(new Set(pending.map((row) => normalizeEmail(row.email)).filter(Boolean)));

    let peopleRows: PeopleSearchRow[] = [];

    if (apolloIds.length > 0) {
      const { data, error } = await admin
        .from('people_search_leads')
        .select('id, name, org_name, organization_name, email, linkedin_url, phone_numbers, primary_phone, enrichment_status')
        .in('id', apolloIds);
      if (error) throw error;
      peopleRows = peopleRows.concat((data || []) as PeopleSearchRow[]);
    }

    if (linkedinUrls.length > 0) {
      const { data, error } = await admin
        .from('people_search_leads')
        .select('id, name, org_name, organization_name, email, linkedin_url, phone_numbers, primary_phone, enrichment_status')
        .in('linkedin_url', linkedinUrls);
      if (error) throw error;
      peopleRows = peopleRows.concat((data || []) as PeopleSearchRow[]);
    }

    if (emails.length > 0) {
      const { data, error } = await admin
        .from('people_search_leads')
        .select('id, name, org_name, organization_name, email, linkedin_url, phone_numbers, primary_phone, enrichment_status')
        .in('email', emails);
      if (error) throw error;
      peopleRows = peopleRows.concat((data || []) as PeopleSearchRow[]);
    }

    const uniquePeople = new Map<string, PeopleSearchRow>();
    for (const row of peopleRows) {
      const key = String(row.id || row.linkedin_url || row.email || Math.random()).trim();
      if (!uniquePeople.has(key)) uniquePeople.set(key, row);
    }

    const byApolloId = new Map<string, PeopleSearchRow>();
    const byLinkedin = new Map<string, PeopleSearchRow>();
    const byEmail = new Map<string, PeopleSearchRow>();
    const byNameCompany = new Map<string, PeopleSearchRow>();

    for (const row of uniquePeople.values()) {
      const apolloId = String(row.id || '').trim();
      const linkedinUrl = normalizeLinkedinProfileUrl(row.linkedin_url);
      const email = normalizeEmail(row.email);
      const nameCompany = normalizeNameCompany(row.name, row.org_name || row.organization_name);

      if (apolloId && !byApolloId.has(apolloId)) byApolloId.set(apolloId, row);
      if (linkedinUrl && !byLinkedin.has(linkedinUrl)) byLinkedin.set(linkedinUrl, row);
      if (email && !byEmail.has(email)) byEmail.set(email, row);
      if (nameCompany && !byNameCompany.has(nameCompany)) byNameCompany.set(nameCompany, row);
    }

    const now = new Date().toISOString();
    const updatedIds: string[] = [];
    let completedWithoutPhone = 0;

    for (const lead of pending) {
      const apolloId = getApolloId(lead);
      const linkedinUrl = normalizeLinkedinProfileUrl(lead.linkedin_url);
      const email = normalizeEmail(lead.email);
      const nameCompany = normalizeNameCompany(lead.full_name, lead.company_name);

      const match =
        (apolloId ? byApolloId.get(apolloId) : undefined) ||
        (linkedinUrl ? byLinkedin.get(linkedinUrl) : undefined) ||
        (email ? byEmail.get(email) : undefined) ||
        (nameCompany ? byNameCompany.get(nameCompany) : undefined);

      if (!match) continue;

      const phoneNumbers = parsePhoneNumbers(match.phone_numbers);
      const primaryPhone = pickPrimaryPhone(match);
      const remoteStatus = String(match.enrichment_status || '').trim();
      const nextStatus = remoteStatus && remoteStatus !== 'pending_phone'
        ? remoteStatus
        : (primaryPhone || phoneNumbers.length > 0 ? 'completed' : 'pending_phone');

      if (nextStatus === 'pending_phone' && !primaryPhone && phoneNumbers.length === 0) {
        if (isLeadPendingTooLong(lead)) {
          const data = { ...(lead.data || {}), phoneSyncSource: 'people_search_leads', phoneSyncedAt: now, phoneSyncResolution: 'completed_without_phone' };
          const { error: staleUpdateError } = await admin
            .from('enriched_leads')
            .update({
              enrichment_status: 'completed',
              updated_at: now,
              data,
            })
            .eq('id', lead.id);

          if (staleUpdateError) throw staleUpdateError;
          updatedIds.push(lead.id);
          completedWithoutPhone += 1;
        }
        continue;
      }

      if (!primaryPhone && phoneNumbers.length === 0) {
        completedWithoutPhone += 1;
      }

      const data = { ...(lead.data || {}) };
      if (apolloId || match.id) data.apolloId = apolloId || String(match.id || '').trim() || null;
      data.phoneSyncSource = 'people_search_leads';
      data.phoneSyncedAt = now;

      const { error: updateError } = await admin
        .from('enriched_leads')
        .update({
          phone_numbers: phoneNumbers,
          primary_phone: primaryPhone,
          enrichment_status: nextStatus,
          updated_at: now,
          data,
        })
        .eq('id', lead.id);

      if (updateError) {
        throw updateError;
      }

      updatedIds.push(lead.id);
    }

    const unresolvedStaleLeads = pending.filter((lead) => {
      if (updatedIds.includes(lead.id)) return false;
      return isLeadPendingTooLong(lead);
    });

    for (const lead of unresolvedStaleLeads) {
      const data = { ...(lead.data || {}), phoneSyncedAt: now, phoneSyncResolution: 'no_match_timeout' };
      const { error: staleUpdateError } = await admin
        .from('enriched_leads')
        .update({
          enrichment_status: 'completed',
          updated_at: now,
          data,
        })
        .eq('id', lead.id);

      if (staleUpdateError) throw staleUpdateError;
      updatedIds.push(lead.id);
      completedWithoutPhone += 1;
    }

    return NextResponse.json({
      checked: pending.length,
      updated: updatedIds.length,
      completedWithoutPhone,
      stillPending: Math.max(0, pending.length - updatedIds.length),
      updatedIds,
    }, { status: 200 });
  } catch (error: any) {
    console.error('[enriched-leads/phone-sync] Error:', error);
    return NextResponse.json({
      error: 'PHONE_SYNC_ERROR',
      message: error?.message || 'Unexpected phone sync error',
    }, { status: 500 });
  }
}
