import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuid } from 'uuid';
import { fetchWithLog } from '@/lib/debug';
import { checkAndConsumeDailyQuota, getDailyQuotaStatus } from '@/lib/server/daily-quota-store';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DAILY_LIMIT = 50;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Fallback epheméro en memoria si el store de cuotas falla.
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

    // Capture debug logs to send to client
    const serverLogs: string[] = [];
    const log = (...args: any[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      console.log('[enrich-apollo]', msg);
      serverLogs.push(msg);
    };

    console.log('[enrich-apollo] Incoming payload:', { count: leads?.length, revealEmail, revealPhone });
    if (!Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json({ error: 'leads requerido' }, { status: 400 });
    }

    // ---- Lectura de cuota segura (con fallback) ----
    let quotaStatus = { count: 0, limit: DAILY_LIMIT };
    let useMemQuota = false;
    const dayKey = new Date().toISOString().slice(0, 10);
    const secret = process.env.QUOTA_FALLBACK_SECRET || '';
    const incomingTicket = req.headers.get('x-quota-ticket')?.trim() || '';
    try {
      quotaStatus = await getDailyQuotaStatus({ userId, resource: 'enrich', limit: DAILY_LIMIT });
    } catch (e: any) {
      console.error('[enrich-apollo] getDailyQuotaStatus failed, using in-memory fallback:', e);
      useMemQuota = true;
      if (secret) {
        const parsed = verifyTicket(incomingTicket, secret);
        const count = (parsed && parsed.userId === userId && parsed.dayKey === dayKey) ? parsed.count : 0;
        quotaStatus = { count, limit: DAILY_LIMIT };
      } else {
        const q = memGet(userId);
        quotaStatus = { count: q.count, limit: DAILY_LIMIT }; // Fix: q.count
      }
    }

    let stoppedByQuota = false;
    let consumed = 0;
    const enrichedOut: any[] = [];

    type LeadInput = EnrichInput['leads'][0] & { existingRecordId?: string };

    for (const l of (leads as LeadInput[])) {
      // Chequeo y consumo de cuota
      if (quotaStatus.count >= quotaStatus.limit) {
        stoppedByQuota = true;
        break;
      }

      if (!useMemQuota) {
        try {
          const { allowed } = await checkAndConsumeDailyQuota({ userId, resource: 'enrich', limit: DAILY_LIMIT });
          if (!allowed) { stoppedByQuota = true; break; }
          quotaStatus.count++;
          consumed++;
        } catch { useMemQuota = true; quotaStatus.count++; consumed++; }
      } else {
        if (quotaStatus.count >= DAILY_LIMIT) { stoppedByQuota = true; break; }
        quotaStatus.count++;
        consumed++;
      }

      // ID Management: Reuse existing if provided (Retry Mode), else generate new
      const isRetry = !!l.existingRecordId;
      const enrichedId = l.existingRecordId || uuid();

      // [STEP 1] Insert 'Placeholder' row ONLY if new
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
            companyDomain: l.companyDomain,
          }
        };

        try {
          await supabaseAdmin.from('enriched_opportunities').insert(initialRow);
        } catch (err) {
          console.error('[enrich-apollo] Failed to insert placeholder:', err);
        }
      } else {
        // If Retry, maybe update status to pending_phone to show "Thinking" again?
        // Yes, good UX.
        try {
          await supabaseAdmin.from('enriched_opportunities')
            .update({ enrichment_status: 'pending_phone' })
            .eq('id', enrichedId);
        } catch (e) { console.error('Failed to update status on retry', e); }
      }

      // [STEP 2] EXTERNALIZATION: Forward to Enrichment Service
      const servicePayload: any = {
        record_id: enrichedId,
        table_name: 'enriched_opportunities',
        lead: {
          first_name: '', // Will be filled below
          last_name: '',
          full_name: l.fullName,
          email: l.email || undefined,
          company_name: l.companyName,
          company_domain: l.companyDomain,
          linkedin_url: l.linkedinUrl,
          title: l.title,
          source_id: l.sourceOpportunityId
        },
        userId: userId,
        config: {
          reveal_phone: revealPhone,
          reveal_email: revealEmail
        }
      };

      if (l.fullName) {
        const parts = l.fullName.trim().split(/\s+/);
        if (parts.length > 1) {
          servicePayload.lead.first_name = parts[0];
          servicePayload.lead.last_name = parts.slice(1).join(' ');
        } else {
          servicePayload.lead.first_name = parts[0];
        }
      }

      const externalUrl = process.env.ENRICHMENT_SERVICE_URL;

      if (externalUrl) {
        log(`Forwarding enrichment to: ${externalUrl}`);
        // Fire and forget, usually. But await to catch immediate networking errors?
        fetch(externalUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-secret': process.env.ENRICHMENT_SERVICE_SECRET || ''
          },
          body: JSON.stringify(servicePayload)
        }).then(r => {
          if (!r.ok) console.error('[enrich-forwarder] Service returned error:', r.status);
          else log('[enrich-forwarder] Successfully queued.');
        }).catch(e => {
          console.error('[enrich-forwarder] Connection failed:', e);
        });

      } else {
        console.warn('[enrich-forwarder] No ENRICHMENT_SERVICE_URL set. Dumping payload to console (Mock Mode).');
        console.log('--- PAYLOAD FOR EXTERNAL APP ---');
        console.log(JSON.stringify(servicePayload, null, 2));
        console.log('-------------------------------');
      }

      // Add to output list so UI knows it started
      enrichedOut.push({
        id: enrichedId,
        sourceOpportunityId: l.sourceOpportunityId,
        fullName: l.fullName,
        companyName: l.companyName,
        title: l.title,
        email: l.email,
        emailStatus: 'unknown',
        linkedinUrl: normalizeLinkedin(l.linkedinUrl || ''),
        companyDomain: l.companyDomain,
        phoneNumbers: [],
        primaryPhone: null,
        enrichmentStatus: 'pending_phone',
        createdAt: new Date().toISOString(),
        clientRef: undefined
      });

      await sleep(50);
    } // end for loop

    const responsePayload: { enriched: any[]; note?: string; usage: { consumed: number }; ticket?: string; debug?: any } = {
      enriched: enrichedOut,
      usage: { consumed },
      debug: {
        serverLogs
      }
    };
    if (stoppedByQuota) {
      responsePayload.note = `Quota limit reached. ${consumed} processed.`;
    }

    if (useMemQuota && secret) {
      const token = signTicket({ userId, dayKey, count: quotaStatus.count }, secret);
      responsePayload.ticket = token;
      const res = NextResponse.json(responsePayload, { status: 200 });
      res.headers.set('x-quota-ticket', token);
      return res;
    }
    return NextResponse.json(responsePayload, { status: 200 });

  } catch (e: any) {
    console.error('[enrich-apollo] fatal', e);
    return NextResponse.json({ error: e.message || 'Unexpected error' }, { status: 500 });
  }
}

/* ------------ helpers ------------- */

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ----- quota ticket helpers ----- */
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
