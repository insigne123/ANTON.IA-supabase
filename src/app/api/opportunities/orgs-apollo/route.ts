import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BASE = 'https://api.apollo.io/api/v1';

type Body = {
  companyName: string;      // tomado de la oportunidad guardada
  perPage?: number;         // default 8
  page?: number;            // default 1
};

export async function POST(req: NextRequest) {
  try {
    const { companyName, perPage = 8, page = 1 } = (await req.json()) as Body;
    if (!companyName?.trim()) {
      return NextResponse.json({ error: 'companyName requerido' }, { status: 400 });
    }

    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'APOLLO_API_KEY missing' }, { status: 500 });

    const qs = new URLSearchParams();
    qs.set('per_page', String(Math.max(1, Math.min(25, perPage))));
    qs.set('page', String(Math.max(1, page)));
    qs.append('q_organization_name', companyName);

    const url = `${BASE}/mixed_companies/search?${qs.toString()}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
        accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
    });

    if (!r.ok) {
      return NextResponse.json({ error: await r.text() }, { status: 502 });
    }

    const j = await r.json();
    const orgs: any[] = j?.organizations || [];
    const normTarget = normalizeName(companyName);

    const candidates = orgs
      .map((o) => {
        const domain = o.primary_domain || cleanDomain(o.website_url) || undefined;
        return {
          id: o.id,
          name: o.name,
          website_url: o.website_url || (domain ? `https://${domain}` : undefined),
          linkedin_url: o.linkedin_url || o.linkedin_url_clean,
          primary_domain: domain,
          logo: domain ? `https://logo.clearbit.com/${domain}` : undefined, // fallback visual
          score: similarityScore(normTarget, normalizeName(o.name || '')),
        };
      })
      .sort((a, b) => b.score - a.score);

    return NextResponse.json({ candidates });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}

/* helpers */

function normalizeName(s: string) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(grupo|the)\b/g, ' ')
    .replace(/\b(s\.?a\.?|s\.?p\.?a\.?|ltda|llc|inc|corp(oration)?|company|co|gmbh|srl|s\.?l\.?|plc|ag|sa de cv)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarityScore(a: string, b: string) {
  if (!a || !b) return 0;
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  const inter = [...A].filter((t) => B.has(t)).length;
  const union = new Set([...A, ...B]).size;
  let score = union ? inter / union : 0;
  if (b.startsWith(a) || a.startsWith(b)) score += 0.25;
  if (a.includes(b) || b.includes(a)) score += 0.15;
  return Math.min(score, 1);
}

function cleanDomain(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    const host = u.hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    const host = String(url).toLowerCase().replace(/^https?:\/\//, '');
    return host.startsWith('www.') ? host.slice(4) : host;
  }
}