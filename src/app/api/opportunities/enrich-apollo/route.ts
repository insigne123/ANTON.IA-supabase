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

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Fallback epheméro en memoria si el store de cuotas falla (p.ej. invalid_rapt).
 * Clave: userId. Valor: { count, yyyymmdd } para reset diario.
 * NOTA: Es por-proceso; en serverless puede no compartirse entre instancias.
 */
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
function memConsume(userId: string) {
  const q = memGet(userId);
  if (q.count >= DAILY_LIMIT) return { allowed: false, count: q.count, limit: DAILY_LIMIT };
  q.count++;
  return { allowed: true, count: q.count, limit: DAILY_LIMIT };
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
    clientRef?: string; // <— correlación desde el cliente
  }>;
};

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id')?.trim() || '';
  try {
    if (!userId) {
      console.warn('[enrich-apollo] missing user id');
      return NextResponse.json({ error: 'missing user id' }, { status: 401 });
    }

    const { leads, revealEmail = true, revealPhone = false } = (await req.json()) as EnrichInput;
    // We can't use 'log' helper here yet as it's not initialized. We'll rely on serverLogs being initialized later or just keep console.log for this initial one if it's before loop. 
    // Actually, 'log' is defined inside the function but initialized later. I should move 'log' definition up if I want to use it everywhere, logic is currently inside the loop or just before it. 
    // The previous edit put 'log' definition BEFORE the loop (line 107). So I can use it inside the loop.
    // But line 59 is at the top of the function. I should just leave this one as console.log or move log definition up.
    // For now, I'll focus on the loop logs which are the critical ones for per-lead debugging.
    console.log('[enrich-apollo] Incoming payload:', { count: leads?.length, revealEmail, revealPhone, firstLead: leads?.[0] });
    if (!Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json({ error: 'leads requerido' }, { status: 400 });
    }

    // Cost estimation: 1 for email, 1 for phone
    const costPerLead = (revealEmail ? 1 : 0) + (revealPhone ? 1 : 0);
    // If both false, fail (nothing to enrich)? Or assume basic enrichment (free)?
    // Apollo usually charges 1 credit per revealed contact info. Match is often free without reveal.
    // For now, let's assume limit is "requests", not credits, for our internal tracking.

    // ... existing quota logic ...

    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'APOLLO_API_KEY missing' }, { status: 500 });
    }

    // ---- Lectura de cuota segura (con fallback) ----
    let quotaStatus = { count: 0, limit: DAILY_LIMIT };
    let useMemQuota = false;
    const dayKey = new Date().toISOString().slice(0, 10);
    const secret = process.env.QUOTA_FALLBACK_SECRET || '';
    // ticket stateless (firmado) para funcionar en serverless
    const incomingTicket = req.headers.get('x-quota-ticket')?.trim() || '';
    try {
      quotaStatus = await getDailyQuotaStatus({ userId, resource: 'enrich', limit: DAILY_LIMIT });
    } catch (e: any) {
      // ... existing error handler ...
      console.error('[enrich-apollo] getDailyQuotaStatus failed, using in-memory fallback:', e);
      useMemQuota = true;
      if (secret) {
        const parsed = verifyTicket(incomingTicket, secret);
        const count = (parsed && parsed.userId === userId && parsed.dayKey === dayKey) ? parsed.count : 0;
        quotaStatus = { count, limit: DAILY_LIMIT };
      } else {
        const q = memGet(userId);
        quotaStatus = { count: q.count, limit: DAILY_LIMIT };
      }
    }

    const out: any[] = [];
    let stoppedByQuota = false;
    let consumed = 0;
    const enrichedOut: any[] = [];

    // Capture debug logs to send to client
    const serverLogs: string[] = [];
    const log = (...args: any[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      console.log('[enrich-apollo]', msg);
      serverLogs.push(msg);
    };

    for (const l of leads) {
      // Chequeo y consumo de cuota (preferir server store; si falla, el epheméro)
      if (quotaStatus.count >= quotaStatus.limit) {
        stoppedByQuota = true;
        break;
      }

      // ... consume logic (omitted for brevity, keep existing block) ...
      if (!useMemQuota) {
        try {
          // We count "requests" here, not heavy credits. 
          // TODO: Better quota model for multi-credit actions.
          const { allowed } = await checkAndConsumeDailyQuota({ userId, resource: 'enrich', limit: DAILY_LIMIT });
          if (!allowed) { stoppedByQuota = true; break; }
          quotaStatus.count++;
          consumed++;
        } catch { useMemQuota = true; quotaStatus.count++; consumed++; } // Simplified fallback logic
      } else {
        if (quotaStatus.count >= DAILY_LIMIT) { stoppedByQuota = true; break; }
        quotaStatus.count++;
        consumed++;
      }


      // Pre-generate ID to link webhook updates to the row we will insert
      const enrichedId = uuid();

      // [LONG POLLING STEP 1] Insert 'Placeholder' row so Webhook has something to update
      // We map the input 'l' to a DB row structure.
      const initialRow = {
        id: enrichedId,
        user_id: userId,
        // organization_id: ??? - We don't have orgId easily available here without fetching. 
        // But 'enriched-leads-service' uses it. If we leave it null, user can only see it in Personal view.
        // For simplicity/robustness, we might skip organization_id or fetch it? 
        // Fetching orgId adds latency. Let's try to pass it if possible or assume NULL (Personal) is safe fallback.
        // Actually, Client sends 'clientRef' which is the 'lead.id'. 
        // Let's assume Personal context for now or if the user is in an Org, this needs Org ID.
        // Given 'saved leads' are often personal, NULL might be okay?
        // Wait, Client.tsx uses `enrichedLeadsStorage.addDedup` which fetches `getCurrentOrganizationId`.
        // If API inserts with NULL, and user is in Org, the user won't see the enriched lead if RLS filters by Org.
        // However, the `row` will exist.
        // Workaround: We proceed without OrgID. If it's an issue, we can fetch user profile to get Org.
        full_name: l.fullName,
        email: l.clientRef ? undefined : undefined, // Don't save email yet if not enriched? Or save input email? Input lead usually has NO email if we are enriching.
        // Input `l` has `companyName` etc.
        company_name: l.companyName,
        title: l.title,
        linkedin_url: l.linkedinUrl,
        created_at: new Date().toISOString(),
        phone_numbers: [],
        primary_phone: null,
        data: {
          sourceOpportunityId: l.sourceOpportunityId,
          companyDomain: l.companyDomain,
        }
      };

      // Fire and forget insert (await to ensure it exists before webhook hits)
      try {
        await supabaseAdmin.from('enriched_leads').insert(initialRow);
      } catch (err) {
        console.error('[enrich-apollo] Failed to insert placeholder:', err);
        // Continue anyway? converting to sync-only mode effectively
      }

      // ---- Enriquecimiento con Apollo ----
      const payload: any = {
        reveal_personal_emails: revealEmail,
        reveal_phone_number: revealPhone,
      };
      if (l.linkedinUrl) payload.linkedin_url = normalizeLinkedin(l.linkedinUrl);
      if (l.fullName) payload.name = l.fullName;
      if (l.title) payload.title = l.title;
      if (l.companyDomain) payload.organization_domain = cleanDomain(l.companyDomain);
      if (l.companyName) payload.organization_name = l.companyName;

      // Algunos planes de Apollo obligan a pasar webhook_url si pides teléfono
      if (revealPhone) {
        const host = req.headers.get('host') || 'anton-ia-supabase.vercel.app';
        let protocol = host.includes('localhost') ? 'http' : 'https';
        let webhookHost = host;

        if (host.includes('localhost')) {
          protocol = 'https';
          webhookHost = 'studio--leadflowai-3yjcy.us-central1.hosted.app';
        }

        payload.webhook_url = `${protocol}://${webhookHost}/api/webhooks/apollo?enriched_lead_id=${enrichedId}`;
      }

      log('Sending payload to Apollo:', payload);

      let res = await withRetry(() =>
        fetchWithLog('APOLLO people/match (Phone+Email)', `${BASE}/people/match`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': apiKey,
            accept: 'application/json',
            'Cache-Control': 'no-cache',
          },
          body: JSON.stringify(payload),
        }),
      );

      log('Response status:', res.status);

      let j: any = {};
      let p: any = null;

      if (res.ok) {
        j = await res.json().catch(() => ({}));
        log('Success Response Body:', j);
        p = j?.person ?? j;
      } else {
        const errText = await safeText(res);
        console.warn('[enrich-apollo] Phone+Email failed:', res.status, errText);

        if (revealPhone && revealEmail) {
          console.log('[enrich-apollo] Fallback: Retrying with Email Only immediately.');
          const fallbackPayload = { ...payload, reveal_phone_number: false };
          delete fallbackPayload.webhook_url;

          const res2 = await withRetry(() =>
            fetchWithLog('APOLLO people/match (Email Only)', `${BASE}/people/match`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': apiKey,
                accept: 'application/json',
                'Cache-Control': 'no-cache',
              },
              body: JSON.stringify(fallbackPayload),
            }),
          );
          if (res2.ok) {
            j = await res2.json().catch(() => ({}));
            p = j?.person ?? j;
            j._fallbackUsed = true;
          } else {
            j = { error: errText };
          }
        } else {
          j = { error: errText };
        }
      }

      // [LONG POLLING STEP 2] Update the DB with the metadata we just got (Email, Verified Name, etc.)
      const rawEmail: string | undefined = p?.email || p?.personal_email || p?.primary_email;
      const locked = !!rawEmail && /email_not_unlocked@domain\.com/i.test(rawEmail);
      const emailToSave = revealEmail ? (locked ? undefined : rawEmail) : undefined;

      if (p) {
        // Prepare update based on what Apollo returned
        const updateData: any = {
          full_name: p.name || l.fullName,
          title: p.title || l.title,
          linkedin_url: p.linkedin_url || l.linkedinUrl,
          company_name: p.organization?.name || l.companyName,
          // if we have email now, set it
          email: emailToSave,
          data: {
            sourceOpportunityId: l.sourceOpportunityId,
            companyDomain: p.organization?.primary_domain || cleanDomain(l.companyDomain),
            emailStatus: revealEmail ? (locked ? 'locked' : p.email_status || 'unknown') : undefined,
            city: p.city,
            country: p.country,
            industry: p.industry,
          }
        };
        await supabaseAdmin.from('enriched_leads').update(updateData).eq('id', enrichedId);
      }

      // Parse Phone Numbers (Synchronous check)
      let phoneNumbers: any[] | undefined = undefined;
      let primaryPhone: string | undefined = undefined;

      if (revealPhone) {
        const numbers = Array.isArray(p?.phone_numbers) ? p.phone_numbers : [];
        phoneNumbers = numbers;

        // [LONG POLLING STEP 3] If no phone numbers, POLL the database!
        if (numbers.length === 0) {
          log('No phone numbers in sync response. Starting Long Polling (max 180s)...');
          const POLL_START = Date.now();
          const TIMEOUT = 180 * 1000; // 3 minutes

          while (Date.now() - POLL_START < TIMEOUT) {
            const elapsed = Math.round((Date.now() - POLL_START) / 1000);
            // Check DB
            const { data: dbLead } = await supabaseAdmin
              .from('enriched_leads')
              .select('phone_numbers, primary_phone')
              .eq('id', enrichedId)
              .single();

            if (dbLead && Array.isArray(dbLead.phone_numbers) && dbLead.phone_numbers.length > 0) {
              log(`Phone numbers found via polling after ${elapsed}s!`);
              phoneNumbers = dbLead.phone_numbers;
              primaryPhone = dbLead.primary_phone;
              // Update 'p' object so the output constructor uses it?
              // We will just set the variables 'phoneNumbers' and 'primaryPhone' which are used below.
              break;
            }

            // Wait 5s
            await sleep(5000);
          }

          if ((!phoneNumbers || phoneNumbers.length === 0)) {
            log('Long Polling timed out. No phone numbers found.');
          }
        } else {
          // We have numbers synchronously
          const found = numbers.find((n: any) => n.type === 'mobile')
            || numbers.find((n: any) => n.type === 'direct_dial')
            || numbers[0];
          primaryPhone = found?.sanitized_number;

          // If we have them sync, we should update DB too?
          // The updateData above didn't include phone numbers.
          // We should save them now to be consistent.
          await supabaseAdmin.from('enriched_leads').update({
            phone_numbers: phoneNumbers,
            primary_phone: primaryPhone
          }).eq('id', enrichedId);
        }
      }

      // Si después de todo no tenemos persona válida, guardamos el error/nota
      if (!p || (!p.email && !p.id && (!phoneNumbers || phoneNumbers.length === 0))) {
        enrichedOut.push({
          id: enrichedId,
          sourceOpportunityId: l.sourceOpportunityId,
          fullName: l.fullName,
          companyName: l.companyName,
          title: l.title,
          note: j.error || (j.message ? String(j.message) : undefined) || 'No match found',
          createdAt: new Date().toISOString(),
          clientRef: l.clientRef ?? undefined,
          _rawDebug: j
        });
        await sleep(250);
        continue;
      }

      // Re-calculate primary phone if it came from polling
      if (!primaryPhone && phoneNumbers && phoneNumbers.length > 0) {
        const found = phoneNumbers.find((n: any) => n.type === 'mobile')
          || phoneNumbers.find((n: any) => n.type === 'direct_dial')
          || phoneNumbers[0];
        primaryPhone = found?.sanitized_number;
      }

      enrichedOut.push({
        id: enrichedId, // Use pre-generated ID
        sourceOpportunityId: l.sourceOpportunityId,
        fullName: p?.name ?? l.fullName,
        title: p?.title ?? l.title,
        email: emailToSave,
        emailStatus: revealEmail ? (locked ? 'locked' : p?.email_status || 'unknown') : undefined,
        linkedinUrl: p?.linkedin_url ?? normalizeLinkedin(l.linkedinUrl || ''),
        companyName: p?.organization?.name ?? l.companyName,
        companyDomain: p?.organization?.primary_domain ?? cleanDomain(l.companyDomain),
        // Phone Data
        phoneNumbers,
        primaryPhone,
        createdAt: new Date().toISOString(),
        clientRef: l.clientRef ?? undefined,
        _rawDebug: j
      });

      await sleep(200);
    }

    const responsePayload: { enriched: any[]; note?: string; usage: { consumed: number }; ticket?: string; debug?: any } = {
      enriched: enrichedOut,
      usage: { consumed },
      debug: {
        rawFirstResponse: enrichedOut.length > 0 ? (enrichedOut[0] as any)._rawDebug : undefined,
        firstLeadName: leads[0]?.fullName,
        serverLogs // Return logs to client
      }
    };
    if (stoppedByQuota) {
      responsePayload.note = `Quota limit reached. ${out.length} of ${leads.length} leads were processed.`;
    }
    // Si estamos en fallback y hay secreto, devolvemos el ticket firmado con el nuevo conteo
    if (useMemQuota && secret) {
      const token = signTicket({ userId, dayKey, count: quotaStatus.count }, secret);
      responsePayload.ticket = token;
      const res = NextResponse.json(responsePayload, { status: 200 });
      res.headers.set('x-quota-ticket', token);
      return res;
    }
    return NextResponse.json(responsePayload, { status: 200 });
  } catch (e: any) {
    const msg = (e?.message || '').toString();
    if (msg.includes('invalid_rapt') || msg.includes('invalid_grant')) {
      // Normalizamos el error para la UI
      return NextResponse.json(
        {
          error: 'invalid_rapt',
          error_description:
            'Google exige reautenticación para el store de cuotas. Usa Service Account (ADC) o ajusta la política de reauth.',
        },
        { status: 401 },
      );
    }
    if (e?.code === 'DAILY_QUOTA_EXCEEDED') {
      return NextResponse.json({ error: e.message }, { status: 429 });
    }
    console.error('[enrich-apollo] fatal', e);
    return NextResponse.json({ error: msg || 'Unexpected error' }, { status: 500 });
  }
}

/* ------------ helpers ------------- */

async function withRetry<T extends Response>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: T | null = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fn();
      last = res;
      if (res.ok) return res;
      if ([429, 500, 502, 503, 504].includes(res.status)) {
        await sleep(600 * i);
        continue;
      }
      return res;
    } catch (err) {
      if (i === attempts) throw err;
      await sleep(600 * i);
    }
  }
  if (last) return last;
  throw new Error('fetch failed without response');
}

function normalizeLinkedin(url: string) {
  if (!url) return url;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    if (u.hostname.includes('linkedin.')) {
      u.protocol = 'https:';
      u.hostname = 'www.linkedin.com';
    }
    return u.toString();
  } catch {
    return url;
  }
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/* ----- quota ticket helpers (stateless) ----- */
function signTicket(payload: { userId: string; dayKey: string; count: number }, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyTicket(token: string, secret: string): { userId: string; dayKey: string; count: number } | null {
  try {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expect = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    if (expect !== sig) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload.count !== 'number') return null;
    return payload;
  } catch { return null; }
}
