import { NextResponse } from 'next/server';
import { generateStructured } from '@/ai/openai-json';
import { dayInZone } from '@/lib/admin/chile-time';
import { dropDay } from '@/lib/lead-drops';
import { readAlertsEmail } from '@/lib/server/daily-alerts';
import { dropsEnabled, dropsMonthlyUsd, monthSpend, planOrganizationDrops, writeDrop } from '@/lib/server/lead-drops';
import { reportSender } from '@/lib/server/self-email';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;
/** What a run may use before it stops taking work: the scheduler's timeout is 300 s. */
const WORK_MS = 240_000;
const PARALLEL = 3;

/**
 * «Contactos de la semana» (functions/index.ts, leadDropsTick, Tuesdays and Fridays from 6:00 to 7:40 in Chile): first
 * finishes the drops an earlier run planned, then plans the missing ones, organization by organization, and writes them
 * while there is time. Only for whoever will get them by email (the alerts on, an address, and their own mailbox or the
 * reports mailbox), one drop per person in their team's workspace. The morning alert (8:00) carries what is ready.
 * LEAD_DROPS_ENABLED=off stops it; LEAD_DROPS_MONTHLY_USD caps what Apify may spend in the month.
 */
export async function POST(request: Request) {
  if (!isFirebaseSchedulerRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const headers = firebaseSchedulerResponseHeaders();
  const now = new Date();
  if (!dropsEnabled()) return NextResponse.json({ skipped: 'off' }, { headers });
  if (!dropDay(now)) return NextResponse.json({ skipped: 'not_drop_day' }, { headers });
  const started = Date.now();
  const timeLeft = () => WORK_MS - (Date.now() - started);
  const admin = getSupabaseAdminClient();
  const today = dayInZone(now);
  const generate = (options: Parameters<Parameters<typeof writeDrop>[2]['generate']>[0]) =>
    generateStructured({ ...options, allowDefaultModelFallback: false, maxAttempts: 1 });
  const result = { written: 0, planned: 0, empty: 0, failed: 0, spentUsd: 0 };

  const writePending = async () => {
    const pending: any = await admin.from('lead_drops').select('id,organization_id,user_id,items').eq('drop_date', today).eq('status', 'pending').limit(60);
    if (pending.error) throw new Error('pending');
    const rows = (pending.data || []) as any[];
    for (let start = 0; start < rows.length && timeLeft() > 60_000; start += PARALLEL) {
      await Promise.all(rows.slice(start, start + PARALLEL).map(async row => {
        try { await writeDrop(admin, row, { generate, now }); result.written++; }
        catch { result.failed++; }
      }));
    }
  };

  try {
    await writePending();
    if (timeLeft() > 90_000) {
      const [members, existing, tokens]: any[] = await Promise.all([
        admin.from('organization_members').select('organization_id,user_id,created_at').order('created_at').limit(5000),
        admin.from('lead_drops').select('user_id').eq('drop_date', today).limit(5000),
        admin.from('provider_tokens').select('user_id,provider').in('provider', ['google', 'outlook']).limit(5000),
      ]);
      if (members.error || existing.error || tokens.error) return NextResponse.json({ error: 'No pudimos leer a quién preparar.' }, { status: 503, headers });
      const done = new Set((existing.data || []).map((row: any) => String(row.user_id)));
      const mailbox = new Set((tokens.data || []).map((row: any) => String(row.user_id)));
      const sender = Boolean(reportSender());
      const ids = [...new Set<string>((members.data || []).map((row: any) => String(row.user_id)))].filter(id => !done.has(id) && (sender || mailbox.has(id)));
      const reachable = new Set<string>();
      for (let start = 0; start < ids.length; start += 200) {
        const profiles: any = await admin.from('profiles').select('id,email,signatures').in('id', ids.slice(start, start + 200));
        if (profiles.error) return NextResponse.json({ error: 'No pudimos leer a quién preparar.' }, { status: 503, headers });
        for (const row of profiles.data || []) if (String(row.email || '').trim() && readAlertsEmail(row.signatures)) reachable.add(String(row.id));
      }
      // One drop per person, in the workspace of their team: the one with most people, or the first they joined.
      const size = new Map<string, number>();
      for (const row of members.data || []) size.set(String(row.organization_id), (size.get(String(row.organization_id)) || 0) + 1);
      const home = new Map<string, string>();
      for (const row of members.data || []) {
        const userId = String(row.user_id), org = String(row.organization_id);
        if (!reachable.has(userId)) continue;
        const current = home.get(userId);
        if (!current || (size.get(org) || 0) > (size.get(current) || 0)) home.set(userId, org);
      }
      const byOrg = new Map<string, string[]>();
      for (const [userId, org] of home) byOrg.set(org, [...(byOrg.get(org) || []), userId]);
      let spent = await monthSpend(admin, now);
      const budget = dropsMonthlyUsd();
      for (const [organizationId, people] of byOrg) {
        if (timeLeft() < 90_000) break;
        const planned = await planOrganizationDrops(admin, organizationId, people, { now, budgetUsd: budget, spentUsd: spent });
        spent += planned.spentUsd; result.spentUsd += planned.spentUsd; result.planned += planned.planned; result.empty += planned.empty;
      }
      await writePending();
    }
  } catch {
    return NextResponse.json({ error: 'No pudimos preparar los contactos de la semana.', ...result }, { status: 503, headers });
  }
  return NextResponse.json({ ...result, spentUsd: Math.round(result.spentUsd * 10_000) / 10_000 }, { headers });
}
