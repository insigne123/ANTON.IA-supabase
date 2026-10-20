import { NextResponse } from 'next/server';
import { dayInZone } from '@/lib/admin/chile-time';
import { alertDay } from '@/lib/daily-alerts';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { canUseOpportunities } from '@/lib/server/commercial-opportunities/grants';
import { deliverDailyAlert, readAlertsEmail } from '@/lib/server/daily-alerts';
import { canEmailEveryone, isTestAddress, sendReportEmail } from '@/lib/server/self-email';
import { readOpportunityManagers } from '@/lib/server/weekly-report';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;
const BATCH = 60;
const PARALLEL = 4;

/**
 * The morning «Avisos» (functions/index.ts, dailyAlertsTick, Tuesday to Friday from 8:00 to 9:30 in Chile): for each
 * person with the alerts on, in each of their organizations, the day's alert when there is something concrete to do,
 * from the Yago address through Resend, their own mailbox or the reports mailbox (sendReportEmail). Whoever cannot get it
 * is skipped, and so are test addresses: their alert would only be written to fail. Every run takes the next batch; what already has an alert today is skipped. DAILY_ALERTS=off stops them.
 */
export async function POST(request: Request) {
  if (!isFirebaseSchedulerRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const headers = firebaseSchedulerResponseHeaders();
  const now = new Date();
  if (process.env.DAILY_ALERTS === 'off') return NextResponse.json({ skipped: 'off' }, { headers });
  if (!alertDay(now)) return NextResponse.json({ skipped: 'not_alert_day' }, { headers });
  const admin = getSupabaseAdminClient();
  const today = dayInZone(now);
  const [members, done, tokens]: any[] = await Promise.all([
    admin.from('organization_members').select('organization_id,user_id,role,created_at').order('created_at').limit(5000),
    admin.from('daily_alerts').select('organization_id,user_id').eq('alert_date', today).limit(5000),
    admin.from('provider_tokens').select('user_id').in('provider', ['google', 'outlook']).limit(5000),
  ]);
  if (members.error || done.error || tokens.error) return NextResponse.json({ error: 'No pudimos leer a quién avisar.' }, { status: 503, headers });
  const mailbox = new Set((tokens.data || []).map((row: any) => String(row.user_id)));
  const sender = canEmailEveryone();
  const ids = [...new Set<string>((members.data || []).map((row: any) => String(row.user_id)))].filter(id => sender || mailbox.has(id));
  const on = new Set<string>();
  for (let start = 0; start < ids.length; start += 200) {
    const profiles: any = await admin.from('profiles').select('id,email,signatures').in('id', ids.slice(start, start + 200));
    if (profiles.error) return NextResponse.json({ error: 'No pudimos leer a quién avisar.' }, { status: 503, headers });
    for (const row of profiles.data || []) if (String(row.email || '').trim() && !isTestAddress(row.email) && readAlertsEmail(row.signatures)) on.add(String(row.id));
  }
  const alerted = new Set((done.data || []).map((row: any) => `${row.organization_id}:${row.user_id}`));
  // Whoever belongs to several workspaces hears about a goal that is behind from the first one they joined.
  const home = new Map<string, string>();
  for (const row of members.data || []) if (!home.has(String(row.user_id))) home.set(String(row.user_id), String(row.organization_id));
  const queue = ((members.data || []) as any[]).filter(row => on.has(String(row.user_id)) && !alerted.has(`${row.organization_id}:${row.user_id}`));
  const managers = new Map<string, Promise<string[]>>();
  const managersOf = (organizationId: string) => {
    if (!managers.has(organizationId)) managers.set(organizationId, readOpportunityManagers(admin, organizationId).catch(() => []));
    return managers.get(organizationId)!;
  };
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://app.antonia.ai');
  const result = { sent: 0, stored: 0, quiet: 0, already: 0, failed: 0, left: Math.max(0, queue.length - BATCH) };
  const batch = queue.slice(0, BATCH);
  const work = async (row: any) => {
    const scope = { organizationId: String(row.organization_id), userId: String(row.user_id) };
    try {
      const { data } = await admin.auth.admin.getUserById(scope.userId);
      const mayOpportunities = Boolean(data?.user && await canUseOpportunities(admin, data.user as any, scope.organizationId));
      const named = mayOpportunities ? await managersOf(scope.organizationId) : [];
      const manager = named.includes(scope.userId) || (!named.length && ['owner', 'admin'].includes(String(row.role)));
      const outcome = await deliverDailyAlert(admin, scope, {
        appUrl, now, send: input => sendReportEmail(admin, input),
        opportunities: !mayOpportunities ? 'none' : manager ? 'manager' : 'mine',
        goalReminders: home.get(scope.userId) === scope.organizationId,
      });
      if (outcome.status === 'already_sent') result.already++;
      else result[outcome.status]++;
    } catch {
      result.failed++;
    }
  };
  for (let start = 0; start < batch.length; start += PARALLEL) await Promise.all(batch.slice(start, start + PARALLEL).map(work));
  return NextResponse.json(result, { headers });
}
