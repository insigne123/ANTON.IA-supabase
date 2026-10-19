import { NextResponse } from 'next/server';
import { dayInZone } from '@/lib/admin/chile-time';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { canUseOpportunities } from '@/lib/server/commercial-opportunities/grants';
import { sendSelfEmail } from '@/lib/server/self-email';
import { deliverWeeklyReport } from '@/lib/server/weekly-report';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;
const BATCH = 40;

/**
 * Monday's «Informe semanal» (functions/index.ts, weeklyReportsTick, Mondays 8:00 to 10:30 in Chile): last week's report
 * for each person who turned on the email, in each of their organizations, sent from their own mailbox. Every run takes
 * the next batch; what was already sent this week is skipped, so the later runs only finish what is left.
 */
export async function POST(request: Request) {
  if (!isFirebaseSchedulerRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const headers = firebaseSchedulerResponseHeaders();
  const now = new Date();
  if (new Date(`${dayInZone(now)}T12:00:00.000Z`).getUTCDay() !== 1) return NextResponse.json({ skipped: 'not_monday' }, { headers });
  const admin = getSupabaseAdminClient();
  const subscribers: any = await admin.from('profiles').select('id').eq('signatures->weekly_report->>email', 'true').limit(2000);
  if (subscribers.error) return NextResponse.json({ error: 'No pudimos leer quién recibe el informe.' }, { status: 503, headers });
  const ids = (subscribers.data || []).map((row: any) => String(row.id));
  const memberships: any = ids.length ? await admin.from('organization_members').select('organization_id,user_id').in('user_id', ids) : { data: [] };
  if (memberships.error) return NextResponse.json({ error: 'No pudimos leer las organizaciones.' }, { status: 503, headers });
  const result = { sent: 0, stored: 0, already: 0, failed: 0, left: 0 };
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://app.antonia.ai');
  let done = 0;
  for (const membership of memberships.data || []) {
    if (done >= BATCH) { result.left++; continue; }
    const scope = { organizationId: String(membership.organization_id), userId: String(membership.user_id) };
    try {
      const outcome = await deliverWeeklyReport(admin, scope, {
        appUrl, now,
        send: input => sendSelfEmail(admin, input),
        canSeeOpportunities: async () => {
          const { data } = await admin.auth.admin.getUserById(scope.userId);
          return Boolean(data?.user && await canUseOpportunities(admin, data.user as any, scope.organizationId));
        },
      });
      if (outcome.status === 'already_sent') { result.already++; continue; }
      done++;
      if (outcome.status === 'sent') result.sent++; else if (outcome.status === 'stored') result.stored++; else result.failed++;
    } catch {
      done++; result.failed++;
    }
  }
  return NextResponse.json(result, { headers });
}
