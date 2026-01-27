import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuid } from 'uuid';
import { fetchWithLog } from '@/lib/debug';
import { checkAndConsumeDailyQuota, getDailyQuotaStatus } from '@/lib/server/daily-quota-store';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BASE = 'https://api.apollo.io/api/v1';
const DAILY_LIMIT = 50;

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
  }>;
};

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id')?.trim() || '';
  if (!userId) return NextResponse.json({ error: 'missing user id' }, { status: 401 });

  try {
    const body = await req.json() as EnrichInput & { tableName?: string };
    const { leads, revealEmail = true, revealPhone = false } = body;
    const tableName = body.tableName || 'enriched_opportunities';
    if (!Array.isArray(leads) || leads.length === 0) return NextResponse.json({ error: 'leads requerido' }, { status: 400 });

    const serverLogs: string[] = [];
    const log = (...args: any[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      console.log('[enrich-apollo]', msg);
      serverLogs.push(msg);
    };

    console.log('[enrich-hybrid] Start', { count: leads.length, revealEmail, revealPhone });

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

      const isRetry = !!l.existingRecordId;
      const enrichedId = l.existingRecordId || uuid();
      let foundApolloId: string | undefined = undefined;
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
          enrichment_status: revealPhone ? 'pending_phone' : 'completed',
          data: {
            sourceOpportunityId: l.sourceOpportunityId,
            companyDomain: cleanDomain(l.companyDomain),
          }
        };
        const { error: insertError } = await getSupabaseAdmin().from(tableName).insert(initialRow);
        if (insertError) {
          log('[FATAL] Failed to insert initial row:', insertError.message, JSON.stringify(insertError));
          // STOP processing this lead. If we can't save it, we can't enrich it.
          // Continue to next lead or throw? Let's skip this lead to be safe but log heavily.
          continue;
        }
      } else {
        // If retrying phone, mark pending again
        if (revealPhone) {
          await getSupabaseAdmin().from(tableName).update({ enrichment_status: 'pending_phone' }).eq('id', enrichedId);
        }
      }

      // [STEP 2] CONSOLIDATED ENRICHMENT (New API)
      // The new API handles both email and phone enrichment in a single call
      try {
        const externalUrl = (process.env.ENRICHMENT_SERVICE_URL || '').trim();
        const secret = (process.env.ENRICHMENT_SERVICE_SECRET || '').trim();

        if (!externalUrl) {
          log('[ERROR] ENRICHMENT_SERVICE_URL not configured. Skipping enrichment.');
          continue;
        }

        // Prepare request payload for new API
        const parts = l.fullName.trim().split(/\s+/);
        const firstName = parts.length > 0 ? parts[0] : '';
        const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';

        const enrichmentPayload = {
          record_id: enrichedId,
          table_name: tableName,
          lead: {
            first_name: firstName,
            last_name: lastName,
            organization_name: l.companyName,
            organization_domain: cleanDomain(l.companyDomain)
          }
        };

        // Add optional fields if available
        if (foundApolloId) {
          enrichmentPayload.lead.apollo_id = foundApolloId;
        }

        log('[enrich-consolidated] Calling new enrichment API:', externalUrl);
        log('[enrich-consolidated] Payload:', JSON.stringify(enrichmentPayload));

        // Call the new consolidated enrichment API
        const enrichUrl = `${externalUrl}?secret_key=${secret}`;
        const enrichRes = await fetch(enrichUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(enrichmentPayload)
        });

        log('[enrich-consolidated] Response status:', enrichRes.status);

        if (enrichRes.ok) {
          const enrichData = await enrichRes.json();
          log('[enrich-consolidated] Success:', JSON.stringify(enrichData));

          if (enrichData.success && enrichData.extracted_data) {
            const extracted = enrichData.extracted_data;

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
              departments: extracted.departments ? JSON.stringify(extracted.departments) : null,

              // Organization details
              organization_domain: extracted.organization_domain || cleanDomain(l.companyDomain),
              organization_industry: extracted.organization_industry,
              organization_size: extracted.organization_size,

              // Phone data
              phone_numbers: extracted.phone_numbers || [],
              primary_phone: extracted.primary_phone,

              // Status and metadata
              enrichment_status: extracted.enrichment_status || 'completed',
              updated_at: new Date().toISOString(),

              // Preserve existing data and add new fields
              data: {
                sourceOpportunityId: l.sourceOpportunityId,
                companyDomain: extracted.organization_domain || cleanDomain(l.companyDomain),
                emailStatus: extracted.email_status,
                apolloId: foundApolloId
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
              email: extracted.email,
              emailStatus: extracted.email_status,
              linkedinUrl: extracted.linkedin_url,
              companyName: extracted.organization_name,
              title: extracted.title,
              companyDomain: extracted.organization_domain,
              industry: extracted.organization_industry,
              location: extracted.country ? `${extracted.city || ''}, ${extracted.state || ''}, ${extracted.country}`.replace(/^,\s*|,\s*,/g, ',').trim() : (extracted.city || ''),
              phoneNumbers: extracted.phone_numbers,
              primaryPhone: extracted.primary_phone,
              seniority: extracted.seniority,
              departments: extracted.departments,
              headline: extracted.headline,
              photoUrl: extracted.photo_url
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
      enrichedOut.push({
        id: enrichedId,
        sourceOpportunityId: l.sourceOpportunityId,
        fullName: emailResult?.fullName || l.fullName,
        companyName: emailResult?.companyName || l.companyName,
        title: emailResult?.title || l.title,
        email: emailResult?.email || l.email,
        emailStatus: emailResult?.emailStatus || 'unknown',
        linkedinUrl: normalizeLinkedin(l.linkedinUrl || ''),
        companyDomain: emailResult?.companyDomain || l.companyDomain,
        industry: emailResult?.industry,
        location: emailResult?.location,
        phoneNumbers: [],
        primaryPhone: null,
        // If phone requested, it's pending. If only email, it's completed.
        enrichmentStatus: revealPhone ? 'pending_phone' : 'completed',
        createdAt: new Date().toISOString()
      });

      await sleep(100);
    } // end for

    const responsePayload: any = {
      enriched: enrichedOut,
      usage: { consumed },
      debug: { serverLogs }
    };

    if (useMemQuota && secret) {
      const token = signTicket({ userId, dayKey, count: quotaStatus.count }, secret);
      responsePayload.ticket = token;
      const res = NextResponse.json(responsePayload, { status: 200 });
      res.headers.set('x-quota-ticket', token);
      return res;
    }
    return NextResponse.json(responsePayload, { status: 200 });

  } catch (e: any) {
    console.error('Fatal Hybrid Error', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
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

