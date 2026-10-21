import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { canUseOpportunities } from '@/lib/server/commercial-opportunities/grants';
import { DailyAlertsError, readAlertsEmail, saveAlertsEmail } from '@/lib/server/daily-alerts';
import { readMailSenderPreference } from '@/lib/server/mail-sender-preference';
import { canEmailEveryone, resendSender, sendReportEmail } from '@/lib/server/self-email';
import { WeeklyReportError, buildWeeklyReport, readReportEmail, saveOpportunityManagers, saveReportEmail } from '@/lib/server/weekly-report';
import { reportEmail } from '@/lib/weekly-report';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store' };
const toAuthError = (error: unknown) => (error instanceof WeeklyReportError || error instanceof DailyAlertsError ? new AuthError(error.message, error.status) : error);
const appUrl = () => String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://app.antonia.ai');

/** «Informe semanal» of the signed-in person (src/lib/weekly-report.ts): this week or the last, with a section per role. */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const admin = getSupabaseAdminClient();
    const scope = { organizationId: auth.organizationId, userId: auth.user.id };
    const which = req.nextUrl.searchParams.get('week') === 'previous' ? 'previous' : 'current';
    // What goes below the report (the Monday email, the mailbox, who may be an opportunities manager) does not depend on
    // it: read together with it. The members are read for everyone and returned only to admins.
    const [{ report, admin: isAdmin, managers }, profile, mailbox, members] = await Promise.all([
      buildWeeklyReport(admin, scope, { which, canSeeOpportunities: () => canUseOpportunities(admin, auth.user as any, auth.organizationId) }),
      admin.from('profiles').select('signatures').eq('id', auth.user.id).maybeSingle(),
      readMailSenderPreference(admin, auth.user.id),
      admin.from('organization_members').select('user_id').eq('organization_id', auth.organizationId),
    ]);
    const memberIds = isAdmin ? ((members as any).data || []).map((row: any) => String(row.user_id)) : [];
    const names = memberIds.length ? await admin.from('profiles').select('id,full_name,email').in('id', memberIds) : { data: [] };
    return NextResponse.json({
      report, email: readReportEmail((profile as any).data?.signatures), alerts: readAlertsEmail((profile as any).data?.signatures), mailbox: mailbox.resolved, sender: canEmailEveryone(), yago: Boolean(resendSender()),
      ...(isAdmin ? { managers, members: ((names as any).data || []).map((row: any) => ({ userId: String(row.id), name: String(row.full_name || String(row.email || '').split('@')[0] || 'Sin nombre'), email: row.email || null })) } : {}),
    }, { headers: noStore });
  } catch (error) {
    return handleAuthError(toAuthError(error));
  }
}

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('email'), on: z.boolean() }).strict(),
  z.object({ action: z.literal('alerts'), on: z.boolean() }).strict(),
  z.object({ action: z.literal('managers'), userIds: z.array(z.string().uuid()).max(20) }).strict(),
  z.object({ action: z.literal('send'), week: z.enum(['current', 'previous']) }).strict(),
]);

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = BodySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new AuthError('Solicitud no válida.', 400);
    const admin = getSupabaseAdminClient();
    const scope = { organizationId: auth.organizationId, userId: auth.user.id };
    if (body.data.action === 'email') return NextResponse.json(await saveReportEmail(admin, auth.user.id, body.data.on), { headers: noStore });
    if (body.data.action === 'alerts') return NextResponse.json(await saveAlertsEmail(admin, auth.user.id, body.data.on), { headers: noStore });
    if (body.data.action === 'managers') return NextResponse.json(await saveOpportunityManagers(admin, scope, body.data.userIds), { headers: noStore });
    // «Enviármelo ahora»: the report on screen, to the person's own address, from their own mailbox or the reports mailbox.
    const { report } = await buildWeeklyReport(admin, scope, { which: body.data.week, canSeeOpportunities: () => canUseOpportunities(admin, auth.user as any, auth.organizationId) });
    const sent = await sendReportEmail(admin, { userId: auth.user.id, to: String(auth.user.email || ''), ...reportEmail(report, appUrl()) });
    if (!sent.ok) throw new AuthError(sent.error, 409);
    return NextResponse.json({ sent: true, to: auth.user.email }, { headers: noStore });
  } catch (error) {
    return handleAuthError(toAuthError(error));
  }
}
