import { NextRequest, NextResponse } from 'next/server';

import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';
import { matchesConfiguredSecret } from '@/lib/server/internal-api-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const ALLOWED_TABLES = new Set(['people_search_leads', 'enriched_leads']);

function isAuthorizedApolloWebhook(req: NextRequest) {
  const expectedSecret = String(process.env.APOLLO_WEBHOOK_SECRET || '').trim();
  if (!expectedSecret) return false;

  const url = new URL(req.url);
  const providedSecret =
    req.headers.get('x-webhook-secret') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    url.searchParams.get('webhook_secret');

  return matchesConfiguredSecret(expectedSecret, providedSecret);
}

function cleanDomain(urlLike?: string | null) {
  const raw = String(urlLike || '').trim();
  if (!raw) return null;

  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    const host = raw.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.+$/, '');
    return host.startsWith('www.') ? host.slice(4) : host;
  }
}

function pickPhones(person: any) {
  const items: any[] = [];

  const push = (value: unknown, type: string, status = 'unknown') => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    items.push({
      raw_number: normalized,
      sanitized_number: normalized,
      type,
      position: 'current',
      status,
    });
  };

  if (Array.isArray(person?.phone_numbers)) {
    for (const phone of person.phone_numbers) {
      const normalized = String(phone?.sanitized_number || phone?.number || phone?.raw_number || '').trim();
      if (!normalized) continue;
      items.push({
        raw_number: String(phone?.raw_number || phone?.number || normalized).trim(),
        sanitized_number: normalized,
        type: String(phone?.type || 'other').trim() || 'other',
        position: String(phone?.position || 'current').trim() || 'current',
        status: String(phone?.status || 'unknown').trim() || 'unknown',
      });
    }
  }

  push(person?.phone_number, 'phone');
  push(person?.mobile_phone, 'mobile');
  push(person?.work_phone, 'work');

  const unique = new Map<string, any>();
  for (const item of items) {
    const key = String(item?.sanitized_number || '').trim();
    if (!key || unique.has(key)) continue;
    unique.set(key, item);
  }

  const phoneNumbers = Array.from(unique.values());
  const primaryPhone = phoneNumbers[0]?.sanitized_number || null;

  return {
    phoneNumbers,
    primaryPhone,
    hasPhone: Boolean(primaryPhone) || phoneNumbers.length > 0,
  };
}

function getOrganizationName(person: any) {
  const direct = String(person?.organization?.name || '').trim();
  if (direct) return direct;

  if (Array.isArray(person?.employment_history)) {
    const current = person.employment_history.find((item: any) => item?.current);
    const currentName = String(current?.organization_name || '').trim();
    if (currentName) return currentName;
    const firstName = String(person.employment_history[0]?.organization_name || '').trim();
    if (firstName) return firstName;
  }

  return '';
}

function getOrganizationWebsite(person: any) {
  const direct = String(person?.organization?.website_url || person?.organization?.primary_domain || '').trim();
  if (direct) return direct.startsWith('http') ? direct : `https://${direct}`;

  const employmentWebsite = String(person?.employment_history?.[0]?.organization_website || '').trim();
  if (employmentWebsite) return employmentWebsite.startsWith('http') ? employmentWebsite : `https://${employmentWebsite}`;

  return null;
}

function getFullName(person: any) {
  const explicit = String(person?.name || '').trim();
  if (explicit) return explicit;
  return `${String(person?.first_name || '').trim()} ${String(person?.last_name || '').trim()}`.trim();
}

function extractApolloPerson(body: any) {
  if (!body || typeof body !== 'object') return null;
  if (body.person && typeof body.person === 'object') return body.person;
  if (Array.isArray(body.people) && body.people[0] && typeof body.people[0] === 'object') return body.people[0];
  return body;
}

function pickEmail(person: any) {
  const direct = String(person?.email || '').trim();
  if (direct) return direct;

  if (Array.isArray(person?.personal_emails)) {
    const personal = person.personal_emails
      .map((value: unknown) => String(value || '').trim())
      .find(Boolean);
    if (personal) return personal;
  }

  if (Array.isArray(person?.emails)) {
    const fromList = person.emails
      .map((entry: any) => String(entry?.email || entry?.address || entry || '').trim())
      .find(Boolean);
    if (fromList) return fromList;
  }

  return null;
}

function buildPeopleSearchUpdates(person: any) {
  const now = new Date().toISOString();
  const { phoneNumbers, primaryPhone, hasPhone } = pickPhones(person);
  const organizationName = getOrganizationName(person) || null;
  const organizationWebsite = getOrganizationWebsite(person);
  const email = pickEmail(person);

  return {
    linkedin_url: normalizeLinkedinProfileUrl(person?.linkedin_url) || null,
    email,
    name: getFullName(person) || null,
    org_name: organizationName,
    title: String(person?.title || person?.headline || '').trim() || null,
    organization_website: organizationWebsite,
    industry: String(person?.organization?.industry || '').trim() || null,
    photo_url: String(person?.photo_url || '').trim() || null,
    email_status: String(person?.email_status || '').trim() || null,
    first_name: String(person?.first_name || '').trim() || null,
    last_name: String(person?.last_name || '').trim() || null,
    organization_name: organizationName,
    updated_at: now,
    city: String(person?.city || '').trim() || null,
    state: String(person?.state || '').trim() || null,
    country: String(person?.country || '').trim() || null,
    headline: String(person?.headline || '').trim() || null,
    seniority: String(person?.seniority || '').trim() || null,
    departments: Array.isArray(person?.departments) ? person.departments : null,
    phone_numbers: phoneNumbers,
    primary_phone: primaryPhone,
    enrichment_status: hasPhone ? 'completed' : 'failed',
    organization_domain: cleanDomain(organizationWebsite || person?.organization?.primary_domain) || null,
    organization_industry: String(person?.organization?.industry || '').trim() || null,
    organization_size: typeof person?.organization?.estimated_num_employees === 'number'
      ? person.organization.estimated_num_employees
      : null,
  };
}

function buildEnrichedLeadUpdates(person: any) {
  const now = new Date().toISOString();
  const { phoneNumbers, primaryPhone, hasPhone } = pickPhones(person);
  const organizationName = getOrganizationName(person) || null;
  const organizationWebsite = getOrganizationWebsite(person);
  const email = pickEmail(person);

  return {
    full_name: getFullName(person) || null,
    first_name: String(person?.first_name || '').trim() || null,
    last_name: String(person?.last_name || '').trim() || null,
    email,
    email_status: String(person?.email_status || '').trim() || null,
    company_name: organizationName,
    organization_name: organizationName,
    title: String(person?.title || person?.headline || '').trim() || null,
    linkedin_url: normalizeLinkedinProfileUrl(person?.linkedin_url) || null,
    phone_numbers: phoneNumbers,
    primary_phone: primaryPhone,
    enrichment_status: hasPhone ? 'completed' : 'failed',
    updated_at: now,
    city: String(person?.city || '').trim() || null,
    state: String(person?.state || '').trim() || null,
    country: String(person?.country || '').trim() || null,
    headline: String(person?.headline || '').trim() || null,
    photo_url: String(person?.photo_url || '').trim() || null,
    seniority: String(person?.seniority || '').trim() || null,
    departments: Array.isArray(person?.departments) ? person.departments : null,
    organization_domain: cleanDomain(organizationWebsite || person?.organization?.primary_domain) || null,
    organization_industry: String(person?.organization?.industry || '').trim() || null,
    organization_size: typeof person?.organization?.estimated_num_employees === 'number'
      ? person.organization.estimated_num_employees
      : null,
  };
}

export async function POST(req: NextRequest) {
  try {
    if (!String(process.env.APOLLO_WEBHOOK_SECRET || '').trim()) {
      return NextResponse.json({ error: 'APOLLO_WEBHOOK_SECRET_NOT_CONFIGURED' }, { status: 503 });
    }

    if (!isAuthorizedApolloWebhook(req)) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    const url = new URL(req.url);
    const recordId = url.searchParams.get('record_id')?.trim() || '';
    const tableName = url.searchParams.get('table_name')?.trim() || 'people_search_leads';

    if (!recordId) {
      return NextResponse.json({ error: 'Missing record_id param' }, { status: 400 });
    }

    if (!ALLOWED_TABLES.has(tableName)) {
      return NextResponse.json({ error: 'Unsupported table_name' }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const person = extractApolloPerson(body);
    if (!person || typeof person !== 'object') {
      return NextResponse.json({ ok: true, ignored: 'missing_person_payload' }, { status: 200 });
    }

    const updates = tableName === 'enriched_leads'
      ? buildEnrichedLeadUpdates(person)
      : buildPeopleSearchUpdates(person);

    const admin = getSupabaseAdminClient();
    const { error } = await admin
      .from(tableName)
      .update(updates)
      .eq('id', recordId);

    if (error) {
      console.error('[apollo-webhook] Update error:', { tableName, recordId, error });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, tableName, recordId }, { status: 200 });
  } catch (error: any) {
    console.error('[apollo-webhook] Error:', error);
    return NextResponse.json({ error: error?.message || 'Unexpected Apollo webhook error' }, { status: 500 });
  }
}
