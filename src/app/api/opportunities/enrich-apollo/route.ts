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

      // [STEP 2] PHASE 1: EMAIL ENRICHMENT (Internal)
      if (revealEmail) {
        try {
          const payload: any = {
            reveal_personal_emails: true,
            reveal_phone_number: false, // Phone is handled externally
          };
          if (l.linkedinUrl) payload.linkedin_url = normalizeLinkedin(l.linkedinUrl);
          if (l.fullName) {
            payload.name = l.fullName;
            const parts = l.fullName.trim().split(/\s+/);
            if (parts.length > 1) {
              payload.first_name = parts[0];
              payload.last_name = parts.slice(1).join(' ');
            }
          }
          if (l.email) payload.email = l.email;
          if (l.title) payload.title = l.title;
          if (l.companyDomain) payload.organization_domain = cleanDomain(l.companyDomain);
          if (l.companyName) payload.organization_name = l.companyName;

          log('Fetching Email (Internal Apollo):', payload);
          const res = await fetchWithLog('APOLLO (Email)', `${BASE}/people/match`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey, 'Cache-Control': 'no-cache' },
            body: JSON.stringify(payload)
          });

          if (res.ok) {
            const j = await res.json();
            const p = j.person || j;
            if (p && (p.email || p.id)) {
              // Found!
              foundApolloId = p.id;

              // Fallback/Locked Logic
              const rawEmail: string | undefined = p.email || p.personal_email || p.primary_email;
              const locked = !!rawEmail && /email_not_unlocked@domain\.com/i.test(rawEmail);
              let emailToSave = locked ? undefined : rawEmail;
              let statusToSave = locked ? 'locked' : (p.email_status || 'verified');

              // Fallback to input email if Apollo failed to unlock
              if (!emailToSave && l.email) {
                emailToSave = l.email;
                statusToSave = 'verified';
              }

              const updateData: any = {
                full_name: p.name || l.fullName,
                title: p.title || l.title,
                linkedin_url: p.linkedin_url || l.linkedinUrl,
                company_name: p.organization?.name || l.companyName,
                email: emailToSave,
                data: {
                  sourceOpportunityId: l.sourceOpportunityId,
                  companyDomain: p.organization?.primary_domain || cleanDomain(l.companyDomain),
                  emailStatus: statusToSave,
                  city: p.city,
                  country: p.country,
                  industry: p.industry,
                  // Preserve apolloId in data usage if valuable
                  apolloId: p.id
                }
              };

              // Update DB immediately
              await getSupabaseAdmin().from(tableName).update(updateData).eq('id', enrichedId);

              // Store result for UI response
              emailResult = {
                email: emailToSave,
                emailStatus: statusToSave,
                linkedinUrl: p.linkedin_url || l.linkedinUrl,
                companyName: p.organization?.name || l.companyName,
                title: p.title || l.title,
                companyDomain: p.organization?.primary_domain || cleanDomain(l.companyDomain),
                industry: p.industry,
                location: p.country ? `${p.city || ''}, ${p.country}` : (p.city || '')
              };
            }
          } else {
            console.warn('Apollo Email Match failed', res.status);
          }
        } catch (e) {
          console.error('Email Enrichment Error', e);
        }
      }

      // [STEP 3] PHASE 2: PHONE ENRICHMENT (External)
      if (revealPhone) {
        // Validation log
        const externalUrl = (process.env.ENRICHMENT_SERVICE_URL || '').trim();
        const secret = (process.env.ENRICHMENT_SERVICE_SECRET || '').trim(); // FORCE TRIM
        const maskedSecret = secret ? `${secret.substring(0, 4)}...${secret.substring(secret.length - 4)}` : '(empty)';

        log(`[enrich-hybrid] Phase 2 Phone. URL present? ${!!externalUrl}. Value: ${externalUrl || '(empty)'}`);
        log(`[enrich-hybrid] [${new Date().toISOString()}] Secret loaded? ${!!secret}. Length: ${secret.length}. Masked: ${maskedSecret}`);

        const servicePayload: any = {
          record_id: enrichedId,
          table_name: tableName,
          lead: {
            first_name: '',
            last_name: '',
            full_name: l.fullName,
            email: emailResult?.email || l.email || undefined,
            company_name: l.companyName,
            company_domain: l.companyDomain,
            linkedin_url: l.linkedinUrl,
            title: l.title,
            source_id: l.sourceOpportunityId,
            apollo_id: foundApolloId
          },
          userId: userId,
          config: {
            reveal_phone: true,
            reveal_email: false
          }
        };

        if (l.fullName) {
          const parts = l.fullName.trim().split(/\s+/);
          if (parts.length > 1) {
            servicePayload.lead.first_name = parts[0];
            servicePayload.lead.last_name = parts.slice(1).join(' ');
          } else { servicePayload.lead.first_name = parts[0]; }
        }

        if (externalUrl) {
          log('Forwarding to External Service:', externalUrl);
          log('Payload to External:', JSON.stringify(servicePayload));
          // We will AWAIT this fetch to ensure we catch network errors in the logs immediately, 
          // even if it slows down the response slightly (it's a trade-off for debugging).
          try {
            const extRes = await fetch(externalUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-secret-key': secret },
              body: JSON.stringify(servicePayload)
            });
            log('External Service Response Status:', extRes.status);
            if (!extRes.ok) {
              const txt = await extRes.text();
              log(`[enrich-hybrid] External Service Error Body: ${txt}`);
            }
          } catch (e: any) {
            log(`[enrich-hybrid] External Service Connection Failed: ${e?.message || e}`);
          }
        } else {
          console.warn('[enrich-hybrid] NO ENRICHMENT_SERVICE_URL DEFINED. Skipping external call.');
          console.log('--- MOCK EXTERNAL PAYLOAD ---');
          console.log(JSON.stringify(servicePayload, null, 2));
        }
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

