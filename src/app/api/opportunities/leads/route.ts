
import { NextRequest, NextResponse } from 'next/server';
import { buildApolloPeopleUrl } from '@/lib/opportunities';
import type { LeadFromApollo } from '@/lib/types';
import { checkAndConsumeDailyQuota } from '@/lib/server/daily-quota-store';

const ACTOR_ID = 'code_crafter~apollo-io-scraper';
const BASE = 'https://api.apify.com/v2';

async function wait(ms: number) { return new Promise(r => setTimeout(r, ms)); }

type Body = {
  companies: { companyName: string; companyDomain?: string }[];
  personTitles: string[];       // ej: ['Head of Talent','HR Manager']
  personLocations?: string[];   // opcional: ej ['Chile','Mexico']
  countPerCompany?: number;
  getEmails?: boolean;          // por defecto true
  excludeGuessedEmails?: boolean; // por defecto false
};

async function runApolloActor(token: string, payload: any) {
  // 1) Run
  const startRes = await fetch(`${BASE}/acts/${ACTOR_ID}/runs?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!startRes.ok) throw new Error(await startRes.text());
  const start = await startRes.json();
  const runId = start.data?.id;
  const datasetId = start.data?.defaultDatasetId;
  if (!runId || !datasetId) throw new Error('Run did not return ids');

  // 2) Esperar a que termine con wait-for-finish
  const wfRes = await fetch(
    `${BASE}/actor-runs/${runId}/wait-for-finish?token=${token}&timeout=240`, // 240s = 4 min
    { cache: 'no-store' }
  );
  if (!wfRes.ok) {
    throw new Error(`Error waiting for apollo actor: ${await wfRes.text()}`);
  }
  const wfData = await wfRes.json();
  const status = wfData?.data?.status;

  if (status !== 'SUCCEEDED') throw new Error(`Run status: ${status}`);

  // 3) Items
  const itemsRes = await fetch(`${BASE}/datasets/${datasetId}/items?token=${token}`);
  if (!itemsRes.ok) throw new Error(await itemsRes.text());
  return (await itemsRes.json()) as any[];
}

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id') || '';
    const { allowed, limit, count, dayKey } = await checkAndConsumeDailyQuota({
      userId,
      resource: 'contact',
      limit: 50,
    });
    console.info('[quota] contact OK', { userId, dayKey, count, limit });
    if (!allowed) {
        return NextResponse.json(
          { error: `Daily quota exceeded for contact. Used ${count}/${limit}.` },
          { status: 429 }
        );
    }

    const { companies, personTitles, personLocations, countPerCompany = 100, getEmails = true, excludeGuessedEmails = false } = await req.json() as Body;
    const token = process.env.APIFY_TOKEN;
    if (!token) return NextResponse.json({ error: 'APIFY_TOKEN missing' }, { status: 500 });

    const all: LeadFromApollo[] = [];

    for (const c of companies) {
      const searchUrl = buildApolloPeopleUrl(c, personTitles, personLocations);
      const items = await runApolloActor(token, {
        url: searchUrl,
        totalRecords: countPerCompany,
        getEmails,
        excludeGuessedEmails,
        excludeNoEmails: false,
      });
      for (const p of items) {
        all.push({
          fullName: p.name ?? p.person_name,
          title: p.title ?? p.person_title,
          email: p.email ?? p.person_email,
          guessedEmail: p.is_guess ?? p.guessed ?? false,
          linkedinUrl: p.linkedin_url ?? p.person_linkedin_url,
          location: p.location ?? p.person_location,
          companyName: c.companyName,
          companyDomain: c.companyDomain,
        });
      }
    }

    // Dedup por email o por (nombre+empresa)
    const seen = new Set<string>();
    const leads = all.filter(r => {
      const key = (r.email || `${r.fullName}_${r.companyName}`).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return NextResponse.json({ leads });
  } catch (e: any) {
    if (e?.code === 'DAILY_QUOTA_EXCEEDED') {
      return NextResponse.json({ error: e.message }, { status: 429 });
    }
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}
