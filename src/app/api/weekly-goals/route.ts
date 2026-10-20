import { NextResponse } from 'next/server';
import { z } from 'zod';
import { homeScope } from '@/lib/home/scope';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { requireHomeAuth } from '@/lib/server/home-auth';
import { requestAuthErrorResponse } from '@/lib/server/request-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { WeeklyGoalsError, readGoalSettings, readPersonGoal, readReadyToWrite, saveGoalSettings } from '@/lib/server/weekly-goals';
import { GOAL_MAX } from '@/lib/weekly-goals';
import { reportWeek } from '@/lib/weekly-report';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store' };
const failure = (error: unknown) => requestAuthErrorResponse(error) || handleAuthError(error instanceof WeeklyGoalsError ? new AuthError(error.message, error.status) : error);

/**
 * «Metas semanales» (src/lib/weekly-goals.ts) of the signed-in person in the selected workspace: the goal, how far they got
 * this week and how many contacts are ready to write. Admins also get the goals they set (?settings=1) and the members.
 */
export async function GET(request: Request) {
  try {
    const { organizationId, user } = await requireHomeAuth(request);
    const admin = getSupabaseAdminClient();
    const now = new Date();
    const week = reportWeek(now, 'current');
    const scope = { organizationId, userId: user.id };
    const [goal, ready, member]: [Awaited<ReturnType<typeof readPersonGoal>>, number, any] = await Promise.all([
      readPersonGoal(admin, scope, { from: week.from, to: week.to }),
      readReadyToWrite(admin, scope),
      admin.from('organization_members').select('role').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle(),
    ]);
    if (member.error) throw new WeeklyGoalsError('No pudimos comprobar tu rol.', 503);
    const isAdmin = ['owner', 'admin'].includes(String(member.data?.role));
    let settings = null;
    if (isAdmin && new URL(request.url).searchParams.get('settings') === '1') {
      const [saved, members]: [Awaited<ReturnType<typeof readGoalSettings>>, any] = await Promise.all([
        readGoalSettings(admin, organizationId),
        admin.from('organization_members').select('user_id').eq('organization_id', organizationId),
      ]);
      if (members.error) throw new WeeklyGoalsError('No pudimos leer el equipo.', 503);
      const ids = (members.data || []).map((row: any) => String(row.user_id));
      const profiles: any = ids.length ? await admin.from('profiles').select('id,full_name,email').in('id', ids) : { data: [] };
      settings = {
        team: saved.team,
        people: [...saved.people].map(([userId, targets]) => ({ userId, targets })),
        members: ((profiles.data || []) as any[]).map(row => ({ userId: String(row.id), name: String(row.full_name || String(row.email || '').split('@')[0] || 'Sin nombre').trim(), email: row.email || null }))
          .sort((a, b) => a.name.localeCompare(b.name, 'es')),
      };
    }
    return NextResponse.json({ scope: homeScope(user.id, organizationId, now), week: { label: week.label, end: week.end }, goal, ready, admin: isAdmin, settings }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const Targets = z.object({ contacted: z.number().int().min(0).max(GOAL_MAX), found: z.number().int().min(0).max(GOAL_MAX) }).strict();
const BodySchema = z.object({
  team: Targets,
  people: z.array(z.object({ userId: z.string().uuid(), targets: Targets }).strict()).max(200),
}).strict();

/** The admins set the team's goal and, for whoever needs another, that person's. */
export async function POST(request: Request) {
  try {
    const { organizationId, user } = await requireHomeAuth(request);
    const body = BodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) throw new AuthError('Revisa las metas: números enteros entre 0 y 500.', 400);
    const saved = await saveGoalSettings(getSupabaseAdminClient(), { organizationId, userId: user.id }, body.data);
    return NextResponse.json(saved, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
