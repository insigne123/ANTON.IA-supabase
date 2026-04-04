import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuid } from 'uuid';
import { checkAndConsumeDailyQuota, getDailyQuotaStatus } from '@/lib/server/daily-quota-store';
import crypto from 'crypto';
import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';
import { enrichPersonWithPDL, pickPdlEmail, pickPdlPhones } from '@/lib/providers/pdl';
import { isPdlFallbackEnabled, resolveLeadProvider, resolveOrganizationIdForUser } from '@/lib/server/provider-routing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DAILY_LIMIT = 50;

const ALLOWED_TABLES = new Set(['enriched_opportunities', 'enriched_leads']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(x?: string | null) {
  const v = String(x || '').trim();
  return !!v && UUID_RE.test(v);
}
function resolveTableName(raw?: string) {
  const v = String(raw || '').trim();
  if (!v) return null;
  return ALLOWED_TABLES.has(v) ? v : null;
}

// Lazy initialization to avoid build-time evaluation of env vars
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const memQuota: Record<string, { count: number; day: string }> = {};
function todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
function memGet(userId: string) {
  const k = todayKey();
  const q = memQuota[userId];
  if (!q || q.day !== k) memQuota[userId] = { count: 0, day: k };
  return memQuota[userId];
}

type EnrichInput = {
  revealEmail?: boolean;
  revealPhone?: boolean;
  provider?: 'apollo' | 'pdl';
  leads: Array<{
    fullName: string;
    linkedinUrl?: string;
    companyName?: string;
    companyDomain?: string;
    title?: string;
    sourceOpportunityId?: string;
    clientRef?: string;
    email?: string;
    existingRecordId?: string;
    apolloId?: string;
    id?: string;
  }>;
};

export async function POST(req: NextRequest) {
  const userIdFromHeader = req.headers.get('x-user-id')?.trim() || '';

  let userId = userIdFromHeader;

  if (userIdFromHeader) {
    if (!isTrustedInternalRequest(req)) {
      return NextResponse.json({ error: 'unauthorized internal request' }, { status: 401 });
    }
  } else {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    userId = user.id;
  }

  try {
    const body = await req.json() as EnrichInput & { tableName?: string };
    const { leads, revealEmail = true, revealPhone = false } = body;
    const shouldRevealEmail = Boolean(revealEmail);
    const shouldRevealPhone = Boolean(revealPhone);
    const tableName = resolveTableName(body.tableName) || 'enriched_opportunities';
    if (body.tableName && !resolveTableName(body.tableName)) {
      return NextResponse.json({ error: `invalid tableName: ${String(body.tableName)}` }, { status: 400 });
    }
    if (!Array.isArray(leads) || leads.length === 0) return NextResponse.json({ error: 'leads requerido' }, { status: 400 });

    const organizationId = await resolveOrganizationIdForUser(userId);
    const providerDecision = resolveLeadProvider({
      requestedProvider: body.provider,
      organizationId,
      defaultProviderEnv: 'ENRICHMENT_PROVIDER_DEFAULT',
      fallbackDefaultProvider: 'apollo',
    });

    let providerUsed: 'apollo' | 'pdl' = providerDecision.provider;
    let fallbackApplied = false;
    let fallbackReason: string | undefined;

    if (providerDecision.provider === 'pdl') {
      try {
        return await handlePdlEnrichment({
          req,
          userId,
          body,
          tableName,
          providerDecision,
        });
      } catch (error: any) {
        if (!isPdlFallbackEnabled()) {
          return NextResponse.json(
            {
              error: 'PDL_ENRICHMENT_ERROR',
              message: error?.message || 'PDL enrichment failed',
              providerRequested: providerDecision.requestedProvider,
              providerUsed: 'pdl',
              fallbackApplied: false,
            },
            { status: 502 },
          );
        }
        providerUsed = 'apollo';
        fallbackApplied = true;
        fallbackReason = error?.message || 'pdl_enrichment_failed';
      }
    }

    const serverLogs: string[] = [];
    const log = (...args: any[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      console.log('[enrich-apollo]', msg);
      serverLogs.push(msg);
    };

    console.log('[enrich-hybrid] Start', {
      count: leads.length,
      revealEmail: shouldRevealEmail,
      revealPhone: shouldRevealPhone,
      enrichmentLevel: shouldRevealPhone ? 'deep' : 'basic',
      providerUsed,
      fallbackApplied,
    });

    // Quota Check
    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'APOLLO_API_KEY missing' }, { status: 500 });

    let quotaStatus = { count: 0, limit: DAILY_LIMIT };
    let useMemQuota = false;
    const dayKey = new Date().toISOString().slice(0, 10);
    const secret = process.env.QUOTA_FALLBACK_SECRET || '';
    const incomingTicket = req.headers.get('x-quota-ticket')?.trim() || '';

    try {
      quotaStatus = await getDailyQuotaStatus({ userId, resource: 'enrich', limit: DAILY_LIMIT });
    } catch (e) {
      useMemQuota = true;
      if (secret) {
        const parsed = verifyTicket(incomingTicket, secret);
        quotaStatus = parsed && parsed.userId === userId && parsed.dayKey === dayKey
          ? { count: parsed.count, limit: DAILY_LIMIT }
          : { count: 0, limit: DAILY_LIMIT };
      } else {
        quotaStatus = { count: memGet(userId).count, limit: DAILY_LIMIT };
      }
    }

    let stoppedByQuota = false;
    let consumed = 0;
    const enrichedOut: any[] = [];

    for (const l of leads) {
      if (quotaStatus.count >= quotaStatus.limit) { stoppedByQuota = true; break; }

      // Consume Quota
      if (!useMemQuota) {
        try {
          const { allowed } = await checkAndConsumeDailyQuota({ userId, resource: 'enrich', limit: DAILY_LIMIT });
          if (!allowed) { stoppedByQuota = true; break; }
          quotaStatus.count++; consumed++;
        } catch { useMemQuota = true; quotaStatus.count++; consumed++; }
      } else {
        if (quotaStatus.count >= DAILY_LIMIT) { stoppedByQuota = true; break; }
        quotaStatus.count++; consumed++;
      }

      const providedId = typeof l.id === 'string' ? l.id.trim() : '';
      const clientRef = typeof l.clientRef === 'string' ? l.clientRef.trim() : '';
      const existingRecordId = typeof l.existingRecordId === 'string' ? l.existingRecordId.trim() : '';

      // Retry/update mode: when we explicitly point to an existing DB row via existingRecordId
      // or when the caller only provides clientRef (common in the Enriched Leads UI).
      const isRetry = Boolean(existingRecordId || (!providedId && clientRef));
      const enrichedId =
        existingRecordId ||
        (isUuid(providedId) ? providedId : '') ||
        (isRetry ? clientRef : '') ||
        uuid();

      // Prefer explicit Apollo ID; fallback to providedId when it is not a UUID (often Apollo person id)
      let foundApolloId: string | undefined =
        (typeof l.apolloId === 'string' && l.apolloId.trim() ? l.apolloId.trim() : undefined) ||
        (!isUuid(providedId) && providedId ? providedId : undefined);
      let emailResult: any = null;

      // [STEP 1] Ensure Row Exists
      if (!isRetry) {
        const initialRow = {
          id: enrichedId,
          user_id: userId,
          full_name: l.fullName,
          email: l.email || undefined,
          company_name: l.companyName,
          title: l.title,
          linkedin_url: l.linkedinUrl,
          created_at: new Date().toISOString(),
          phone_numbers: [],
          primary_phone: null,
          enrichment_status: shouldRevealPhone ? 'pending_phone' : 'completed',
          data: {
            sourceOpportunityId: l.sourceOpportunityId,
            companyDomain: cleanDomain(l.companyDomain),
          }
        };
        const { error: insertError } = await getSupabaseAdmin().from(tableName).insert(initialRow);
        if (insertError) {
          const code = (insertError as any)?.code;
          if (code === '23505') {
            // Row already exists, continue with enrichment/update.
            log('[WARN] Initial row already exists. Continuing with enrichment:', enrichedId);
          } else {
            log('[FATAL] Failed to insert initial row:', insertError.message, JSON.stringify(insertError));
            // STOP processing this lead. If we can't save it, we can't enrich it.
            continue;
          }
        }
      } else {
        // If retrying phone, mark pending again
        if (shouldRevealPhone) {
          await getSupabaseAdmin().from(tableName).update({ enrichment_status: 'pending_phone' }).eq('id', enrichedId);
        }
      }

      // [STEP 2] CONSOLIDATED ENRICHMENT (New API)
      // The new API handles both email and phone enrichment in a single call
      try {
        const externalUrl = (process.env.ENRICHMENT_SERVICE_URL || '').trim();
        const backendSecret = (
          process.env.BACKEND_ENRICH_SECRET ||
          process.env.ENRICHMENT_SERVICE_SECRET ||
          process.env.API_SECRET_KEY ||
          ''
        ).trim();

        if (!externalUrl) {
          log('[ERROR] ENRICHMENT_SERVICE_URL not configured. Skipping enrichment.');
          continue;
        }

        if (!backendSecret) {
          log('[ERROR] BACKEND_ENRICH_SECRET/ENRICHMENT_SERVICE_SECRET not configured. Skipping enrichment.');
          continue;
        }

        // Prepare request payload for new API
        const parts = l.fullName.trim().split(/\s+/);
        const firstName = parts.length > 0 ? parts[0] : '';
        const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';

        const enrichmentPayload: any = {
          record_id: enrichedId,
          table_name: tableName,
          lead: {
            first_name: firstName,
            last_name: lastName,
            organization_name: l.companyName,
            organization_domain: cleanDomain(l.companyDomain)
          },
          reveal_email: shouldRevealEmail,
          reveal_phone: shouldRevealPhone,
          revealEmail: shouldRevealEmail,
          revealPhone: shouldRevealPhone,
          enrichment_level: shouldRevealPhone ? 'deep' : 'basic',
          requested_data: {
            email: shouldRevealEmail,
            phone: shouldRevealPhone,
          },
          requested_fields: shouldRevealPhone
            ? (shouldRevealEmail ? ['email', 'phone'] : ['phone'])
            : (shouldRevealEmail ? ['email'] : []),
        };

        // Add optional fields if available
        if (foundApolloId) {
          enrichmentPayload.lead.id = foundApolloId;
          enrichmentPayload.lead.apollo_id = foundApolloId;
        } else {
          log('[WARN] Missing Apollo person id for enrichment lead:', enrichedId);
        }

        log('[enrich-consolidated] Calling new enrichment API:', externalUrl);
        log('[enrich-consolidated] Payload:', JSON.stringify(enrichmentPayload));

        // Call the new consolidated enrichment API
        const enrichRes = await fetch(externalUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-secret-key': backendSecret,
          },
          body: JSON.stringify(enrichmentPayload)
        });

        log('[enrich-consolidated] Response status:', enrichRes.status);

        if (enrichRes.ok) {
          const enrichData = await enrichRes.json();
          log('[enrich-consolidated] Success:', JSON.stringify(enrichData));

          if (enrichData.success && enrichData.extracted_data) {
            const extracted = enrichData.extracted_data;
            const normalizedPhoneNumbers = shouldRevealPhone ? (extracted.phone_numbers || []) : [];
            const normalizedPrimaryPhone = shouldRevealPhone ? (extracted.primary_phone || null) : null;
            const normalizedEnrichmentStatus = shouldRevealPhone
              ? (extracted.enrichment_status || 'pending_phone')
              : 'completed';

            // Map the response to our database structure
            const updateData: any = {
              full_name: extracted.first_name && extracted.last_name
                ? `${extracted.first_name} ${extracted.last_name}`
                : l.fullName,
              email: extracted.email || l.email,
              email_status: extracted.email_status || 'unknown',
              title: extracted.title || l.title,
              linkedin_url: extracted.linkedin_url || l.linkedinUrl,
              company_name: extracted.organization_name || l.companyName,

              // Location fields
              city: extracted.city,
              state: extracted.state,
              country: extracted.country,

              // Professional details
              headline: extracted.headline,
              photo_url: extracted.photo_url,
              seniority: extracted.seniority,
              departments: extracted.departments ?? null,

              // Organization details
              organization_domain: extracted.organization_domain || cleanDomain(l.companyDomain),
              organization_industry: extracted.organization_industry,
              organization_size: extracted.organization_size,

              // Phone data
              phone_numbers: normalizedPhoneNumbers,
              primary_phone: normalizedPrimaryPhone,

              // Status and metadata
              enrichment_status: normalizedEnrichmentStatus,
              updated_at: new Date().toISOString(),

              // Preserve existing data and add new fields
              data: {
                sourceOpportunityId: l.sourceOpportunityId,
                companyDomain: extracted.organization_domain || cleanDomain(l.companyDomain),
                emailStatus: extracted.email_status,
                apolloId: foundApolloId,
                requestedEnrichmentLevel: shouldRevealPhone ? 'deep' : 'basic',
                requestedRevealPhone: shouldRevealPhone,
                requestedRevealEmail: shouldRevealEmail,
              }
            };

            // Update database with enriched data
            const { error: updateError } = await getSupabaseAdmin()
              .from(tableName)
              .update(updateData)
              .eq('id', enrichedId);

            if (updateError) {
              log('[ERROR] Failed to update enriched data:', updateError.message);
            } else {
              log('[SUCCESS] Lead enriched and saved:', enrichedId);
            }

            // Prepare response data
            emailResult = {
              fullName: updateData.full_name,
              email: extracted.email,
              emailStatus: extracted.email_status,
              linkedinUrl: extracted.linkedin_url,
              companyName: extracted.organization_name,
              title: extracted.title,
              companyDomain: extracted.organization_domain,
              industry: extracted.organization_industry,
              location: extracted.country ? `${extracted.city || ''}, ${extracted.state || ''}, ${extracted.country}`.replace(/^,\s*|,\s*,/g, ',').trim() : (extracted.city || ''),
              phoneNumbers: normalizedPhoneNumbers,
              primaryPhone: normalizedPrimaryPhone,
              seniority: extracted.seniority,
              departments: extracted.departments,
              headline: extracted.headline,
              photoUrl: extracted.photo_url,
              enrichmentStatus: normalizedEnrichmentStatus || updateData.enrichment_status
            };
          } else {
            log('[WARNING] Enrichment API returned no data');
          }
        } else {
          const errorText = await enrichRes.text();
          log('[ERROR] Enrichment API failed:', enrichRes.status, errorText);
        }
      } catch (e: any) {
        log('[ERROR] Enrichment exception:', e?.message || e);
      }


      // Add to output
      const outPhoneNumbers = (emailResult?.phoneNumbers ?? null) as any;
      const outPrimaryPhone = (emailResult?.primaryPhone ?? null) as any;
      const outLinkedin = (emailResult?.linkedinUrl || l.linkedinUrl || '').trim();
      const outStatus =
        emailResult?.enrichmentStatus ||
        (shouldRevealPhone
          ? ((outPrimaryPhone || (Array.isArray(outPhoneNumbers) && outPhoneNumbers.length)) ? 'completed' : 'pending_phone')
          : 'completed');

      enrichedOut.push({
        id: enrichedId,
        clientRef: clientRef || undefined,
        sourceOpportunityId: l.sourceOpportunityId,
        apolloId: foundApolloId,
        fullName: emailResult?.fullName || l.fullName,
        companyName: emailResult?.companyName || l.companyName,
        title: emailResult?.title || l.title,
        email: emailResult?.email || l.email,
        emailStatus: emailResult?.emailStatus || 'unknown',
        linkedinUrl: normalizeLinkedin(outLinkedin),
        companyDomain: emailResult?.companyDomain || cleanDomain(l.companyDomain),
        industry: emailResult?.industry,
        location: emailResult?.location,
        phoneNumbers: outPhoneNumbers,
        primaryPhone: outPrimaryPhone,
        enrichmentStatus: outStatus,
        createdAt: new Date().toISOString()
      });

      await sleep(100);
    } // end for

    const responsePayload: any = {
      enriched: enrichedOut,
      usage: { consumed },
      debug: { serverLogs },
      providerRequested: providerDecision.requestedProvider,
      providerUsed,
      providerDefault: providerDecision.defaultProvider,
      providerForcedReason: providerDecision.forcedApolloReason,
      fallbackApplied,
      fallbackReason,
    };

    if (useMemQuota && secret) {
      const token = signTicket({ userId, dayKey, count: quotaStatus.count }, secret);
      responsePayload.ticket = token;
      const res = NextResponse.json(responsePayload, { status: 200 });
      res.headers.set('x-quota-ticket', token);
      res.headers.set('x-provider-used', providerUsed);
      return res;
    }
    const res = NextResponse.json(responsePayload, { status: 200 });
    res.headers.set('x-provider-used', providerUsed);
    return res;

  } catch (e: any) {
    console.error('Fatal Hybrid Error', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

async function handlePdlEnrichment(params: {
  req: NextRequest;
  userId: string;
  body: EnrichInput & { tableName?: string };
  tableName: string;
  providerDecision: any;
}) {
  const { req, userId, body, tableName, providerDecision } = params;
  const { leads, revealEmail = true, revealPhone = false } = body;
  const shouldRevealEmail = Boolean(revealEmail);
  const shouldRevealPhone = Boolean(revealPhone);

  const serverLogs: string[] = [];
  const log = (...args: any[]) => {
    const msg = args.map((a) => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    console.log('[enrich-pdl]', msg);
    serverLogs.push(msg);
  };

  let quotaStatus = { count: 0, limit: DAILY_LIMIT };
  let useMemQuota = false;
  const dayKey = new Date().toISOString().slice(0, 10);
  const secret = process.env.QUOTA_FALLBACK_SECRET || '';
  const incomingTicket = req.headers.get('x-quota-ticket')?.trim() || '';

  try {
    quotaStatus = await getDailyQuotaStatus({ userId, resource: 'enrich', limit: DAILY_LIMIT });
  } catch {
    useMemQuota = true;
    if (secret) {
      const parsed = verifyTicket(incomingTicket, secret);
      quotaStatus = parsed && parsed.userId === userId && parsed.dayKey === dayKey
        ? { count: parsed.count, limit: DAILY_LIMIT }
        : { count: 0, limit: DAILY_LIMIT };
    } else {
      quotaStatus = { count: memGet(userId).count, limit: DAILY_LIMIT };
    }
  }

  let consumed = 0;
  const enrichedOut: any[] = [];
  let successfulMatches = 0;
  let fatalPdlError: string | null = null;

  for (const l of leads) {
    if (quotaStatus.count >= quotaStatus.limit) break;

    if (!useMemQuota) {
      try {
        const { allowed } = await checkAndConsumeDailyQuota({ userId, resource: 'enrich', limit: DAILY_LIMIT });
        if (!allowed) break;
        quotaStatus.count++;
        consumed++;
      } catch {
        useMemQuota = true;
        quotaStatus.count++;
        consumed++;
      }
    } else {
      if (quotaStatus.count >= DAILY_LIMIT) break;
      quotaStatus.count++;
      consumed++;
    }

    const providedId = typeof l.id === 'string' ? l.id.trim() : '';
    const clientRef = typeof l.clientRef === 'string' ? l.clientRef.trim() : '';
    const existingRecordId = typeof l.existingRecordId === 'string' ? l.existingRecordId.trim() : '';
    const isRetry = Boolean(existingRecordId || (!providedId && clientRef));
    const enrichedId =
      existingRecordId ||
      (isUuid(providedId) ? providedId : '') ||
      (isRetry ? clientRef : '') ||
      uuid();

    const foundApolloId: string | undefined =
      (typeof l.apolloId === 'string' && l.apolloId.trim() ? l.apolloId.trim() : undefined) ||
      (!isUuid(providedId) && providedId ? providedId : undefined);

    if (!isRetry) {
      const initialRow = {
        id: enrichedId,
        user_id: userId,
        full_name: l.fullName,
        email: l.email || undefined,
        company_name: l.companyName,
        title: l.title,
        linkedin_url: l.linkedinUrl,
        created_at: new Date().toISOString(),
        phone_numbers: [],
        primary_phone: null,
        enrichment_status: shouldRevealPhone ? 'pending_phone' : 'completed',
        data: {
          sourceOpportunityId: l.sourceOpportunityId,
          companyDomain: cleanDomain(l.companyDomain),
        },
      };

      const { error: insertError } = await getSupabaseAdmin().from(tableName).insert(initialRow);
      if (insertError) {
        const code = (insertError as any)?.code;
        if (code !== '23505') {
          log('[ERROR] Failed to insert initial row', insertError.message);
          continue;
        }
      }
    } else if (shouldRevealPhone) {
      await getSupabaseAdmin().from(tableName).update({ enrichment_status: 'pending_phone' }).eq('id', enrichedId);
    }

    let emailResult: any = null;

    try {
      const pdl = await enrichPersonWithPDL({
        linkedinUrl: l.linkedinUrl,
        email: l.email,
        fullName: l.fullName,
        companyName: l.companyName,
        companyDomain: cleanDomain(l.companyDomain),
        dataInclude: [
          'id',
          'full_name',
          'first_name',
          'last_name',
          'job_title',
          'job_title_role',
          'linkedin_url',
          'image_url',
          'summary',
          'location_locality',
          'location_region',
          'location_country',
          'work_email',
          'recommended_personal_email',
          'mobile_phone',
          'work_phone',
          'phone_numbers',
          'job_company_name',
          'job_company_website',
          'job_company_size',
          'job_company_industry',
        ],
      });

      if (pdl.matched && pdl.person) {
        successfulMatches++;
        const person = pdl.person;
        const email = shouldRevealEmail ? (pickPdlEmail(person) || l.email || undefined) : (l.email || undefined);
        const phoneSelection = shouldRevealPhone
          ? pickPdlPhones(person)
          : { primaryPhone: null as string | null, phoneNumbers: [] as any[] };

        const fullName =
          String(person.full_name || '').trim() ||
          `${String(person.first_name || '').trim()} ${String(person.last_name || '').trim()}`.trim() ||
          l.fullName;

        const city = String(person.location_locality || '').trim() || undefined;
        const state = String(person.location_region || '').trim() || undefined;
        const country = String(person.location_country || '').trim() || undefined;
        const companyDomain = cleanDomain(person.job_company_website || l.companyDomain);
        const enrichmentStatus = shouldRevealPhone
          ? ((phoneSelection.primaryPhone || phoneSelection.phoneNumbers.length > 0) ? 'completed' : 'pending_phone')
          : 'completed';

        const updateData: any = {
          full_name: fullName,
          email,
          email_status: email ? 'verified' : 'not_found',
          title: person.job_title || l.title,
          linkedin_url: person.linkedin_url || l.linkedinUrl,
          company_name: person.job_company_name || l.companyName,
          city,
          state,
          country,
          headline: person.summary || null,
          photo_url: person.image_url || null,
          seniority: person.job_title_role || null,
          departments: null,
          organization_domain: companyDomain,
          organization_industry: person.job_company_industry || null,
          organization_size: typeof person.job_company_size === 'number' ? person.job_company_size : null,
          phone_numbers: phoneSelection.phoneNumbers,
          primary_phone: phoneSelection.primaryPhone,
          enrichment_status: enrichmentStatus,
          updated_at: new Date().toISOString(),
          data: {
            sourceOpportunityId: l.sourceOpportunityId,
            companyDomain,
            apolloId: foundApolloId,
            provider: 'pdl',
            pdlLikelihood: person.likelihood ?? null,
            requestedEnrichmentLevel: shouldRevealPhone ? 'deep' : 'basic',
            requestedRevealPhone: shouldRevealPhone,
            requestedRevealEmail: shouldRevealEmail,
          },
        };

        const { error: updateError } = await getSupabaseAdmin()
          .from(tableName)
          .update(updateData)
          .eq('id', enrichedId);

        if (updateError) {
          log('[ERROR] Failed to update PDL enriched data', updateError.message);
        }

        const location = [city, state, country].filter(Boolean).join(', ') || undefined;
        emailResult = {
          fullName,
          email,
          emailStatus: email ? 'verified' : 'not_found',
          linkedinUrl: updateData.linkedin_url,
          companyName: updateData.company_name,
          title: updateData.title,
          companyDomain,
          industry: updateData.organization_industry,
          location,
          phoneNumbers: phoneSelection.phoneNumbers,
          primaryPhone: phoneSelection.primaryPhone,
          seniority: updateData.seniority,
          departments: updateData.departments,
          headline: updateData.headline,
          photoUrl: updateData.photo_url,
          enrichmentStatus,
        };
      } else {
        log('[WARN] PDL did not match lead', l.fullName, l.companyName || '');
      }
    } catch (e: any) {
      const message = e?.message || String(e);
      log('[ERROR] PDL enrichment exception:', message);
      const normalized = String(message).toLowerCase();
      const isHttpError = /^PDL_HTTP_\d+/.test(String(message));
      const isNotFound = /^PDL_HTTP_404/.test(String(message));
      const isNetworkError =
        normalized.includes('fetch failed') ||
        normalized.includes('network') ||
        normalized.includes('timeout') ||
        normalized.includes('abort');

      if (!fatalPdlError && ((isHttpError && !isNotFound) || isNetworkError)) {
        fatalPdlError = String(message);
      }
    }

    const outPhoneNumbers = (emailResult?.phoneNumbers ?? null) as any;
    const outPrimaryPhone = (emailResult?.primaryPhone ?? null) as any;
    const outLinkedin = (emailResult?.linkedinUrl || l.linkedinUrl || '').trim();
    const outStatus =
      emailResult?.enrichmentStatus ||
      (shouldRevealPhone
        ? ((outPrimaryPhone || (Array.isArray(outPhoneNumbers) && outPhoneNumbers.length)) ? 'completed' : 'pending_phone')
        : 'completed');

    enrichedOut.push({
      id: enrichedId,
      clientRef: clientRef || undefined,
      sourceOpportunityId: l.sourceOpportunityId,
      apolloId: foundApolloId,
      fullName: emailResult?.fullName || l.fullName,
      companyName: emailResult?.companyName || l.companyName,
      title: emailResult?.title || l.title,
      email: emailResult?.email || l.email,
      emailStatus: emailResult?.emailStatus || 'unknown',
      linkedinUrl: normalizeLinkedin(outLinkedin),
      companyDomain: emailResult?.companyDomain || cleanDomain(l.companyDomain),
      industry: emailResult?.industry,
      location: emailResult?.location,
      phoneNumbers: outPhoneNumbers,
      primaryPhone: outPrimaryPhone,
      enrichmentStatus: outStatus,
      createdAt: new Date().toISOString(),
    });

    await sleep(80);
  }

  if (fatalPdlError && successfulMatches === 0) {
    throw new Error(fatalPdlError);
  }

  const responsePayload: any = {
    enriched: enrichedOut,
    usage: { consumed },
    debug: { serverLogs },
    providerRequested: providerDecision.requestedProvider,
    providerUsed: 'pdl',
    providerDefault: providerDecision.defaultProvider,
    providerForcedReason: providerDecision.forcedApolloReason,
    fallbackApplied: false,
  };

  if (useMemQuota && secret) {
    const token = signTicket({ userId, dayKey, count: quotaStatus.count }, secret);
    responsePayload.ticket = token;
    const res = NextResponse.json(responsePayload, { status: 200 });
    res.headers.set('x-quota-ticket', token);
    res.headers.set('x-provider-used', 'pdl');
    return res;
  }

  const res = NextResponse.json(responsePayload, { status: 200 });
  res.headers.set('x-provider-used', 'pdl');
  return res;
}

/* Identical helpers as before */
function normalizeLinkedin(url: string) {
  if (!url) return url;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    if (u.hostname.includes('linkedin.')) {
      u.protocol = 'https:';
      u.hostname = 'www.linkedin.com';
    }
    return u.toString();
  } catch { return url; }
}

function cleanDomain(x?: string) {
  if (!x) return x || undefined;
  try {
    const u = new URL(x.startsWith('http') ? x : `https://${x}`);
    const host = u.hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    const host = String(x).toLowerCase().replace(/^https?:\/\//, '');
    return host.startsWith('www.') ? host.slice(4) : host;
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function signTicket(payload: any, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyTicket(token: string, secret: string): any {
  try {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expect = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    if (expect !== sig) return null;
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch { return null; }
}

