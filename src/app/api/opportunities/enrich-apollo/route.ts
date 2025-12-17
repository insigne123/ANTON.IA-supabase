import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuid } from 'uuid';
import { fetchWithLog } from '@/lib/debug';
import { checkAndConsumeDailyQuota, getDailyQuotaStatus } from '@/lib/server/daily-quota-store';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BASE = 'https://api.apollo.io/api/v1';
const DAILY_LIMIT = 50;

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
        // Usamos una URL ficticia o la real si existiera, para pasar la validación
        // Si Apollo manda los datos por webhook, no los veremos aquí síncronamente (salvo que sea 'instant').
        const host = req.headers.get('host') || 'anton-ia-supabase.vercel.app';
        // Ensure https
        let protocol = host.includes('localhost') ? 'http' : 'https';
        let webhookHost = host;

        // If running locally, we must use a specialized production URL because Apollo likely rejects "localhost"
        if (host.includes('localhost')) {
          protocol = 'https';
          webhookHost = 'studio--leadflowai-3yjcy.us-central1.hosted.app';
        }

        payload.webhook_url = `${protocol}://${webhookHost}/api/webhooks/apollo?enriched_lead_id=${enrichedId}`;
      }

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

      let j: any = {};
      let p: any = null;

      if (res.ok) {
        j = await res.json().catch(() => ({}));
        p = j?.person ?? j;
      } else {
        // Si falló (ej. 400 por falta de webhook o error de créditos de teléfono),
        // intentamos el fallback inmediatamente.
        const errText = await safeText(res);
        console.warn('[enrich-apollo] Phone+Email failed:', res.status, errText);

        // Fallback directo: solo Email
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
            // Marcamos que usamos fallback para debugging
            j._fallbackUsed = true;
          } else {
            // Si también falla, guardamos el error original
            j = { error: errText };
          }
        } else {
          // Si no había fallback posible, dejamos el error
          j = { error: errText };
        }
      }

      // Si después de todo no tenemos persona válida, guardamos el error/nota
      if (!p || (!p.email && !p.id)) { // chequeo laxo
        enrichedOut.push({
          id: enrichedId, // Use pre-generated ID
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

      // Si llegamos aquí, tenemos éxito (ya sea del primero o del fallback)
      // Pasamos p a la lógica de mapeo...
      const rawEmail: string | undefined = p?.email || p?.personal_email || p?.primary_email;
      const locked = !!rawEmail && /email_not_unlocked@domain\.com/i.test(rawEmail);

      // Parse Phone Numbers
      // If revealPhone was false, we don't want to touch phoneNumbers (leave undefined)
      // If revealPhone was true, we return list (or empty list if none found)
      let phoneNumbers: any[] | undefined = undefined;
      let primaryPhone: string | undefined = undefined;

      if (revealPhone) {
        const numbers = Array.isArray(p?.phone_numbers) ? p.phone_numbers : [];
        phoneNumbers = numbers;

        // Simple Primary Logic: Mobile > Direct > Corporate > Other
        const found = numbers.find((n: any) => n.type === 'mobile')
          || numbers.find((n: any) => n.type === 'direct_dial')
          || numbers[0];
        primaryPhone = found?.sanitized_number;
      }

      enrichedOut.push({
        id: enrichedId, // Use pre-generated ID
        sourceOpportunityId: l.sourceOpportunityId,
        fullName: p?.name ?? l.fullName,
        title: p?.title ?? l.title,
        email: revealEmail ? (locked ? undefined : rawEmail) : undefined, // Undefined if not requested
        emailStatus: revealEmail ? (locked ? 'locked' : p?.email_status || 'unknown') : undefined,
        linkedinUrl: p?.linkedin_url ?? normalizeLinkedin(l.linkedinUrl || ''),
        companyName: p?.organization?.name ?? l.companyName,
        companyDomain: p?.organization?.primary_domain ?? cleanDomain(l.companyDomain),
        // Phone Data
        phoneNumbers,
        primaryPhone,
        createdAt: new Date().toISOString(),
        clientRef: l.clientRef ?? undefined,
        _rawDebug: j // Inject raw response for debug (will be stripped in production usually, but helpful here)
      });

      await sleep(200);
    }

    const responsePayload: { enriched: any[]; note?: string; usage: { consumed: number }; ticket?: string; debug?: any } = {
      enriched: enrichedOut,
      usage: { consumed },
      debug: {
        rawFirstResponse: enrichedOut.length > 0 ? (enrichedOut[0] as any)._rawDebug : undefined,
        firstLeadName: leads[0]?.fullName
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
