import { NextRequest, NextResponse } from 'next/server';

import type { AdminCreditMode } from '@/lib/admin-dashboard-types';
import {
  adminDashboardAuthErrorResponse,
  requireAdminDashboardAccess,
} from '@/lib/server/admin-dashboard-auth';
import { loadAdminCreditOverview } from '@/lib/server/admin-credit-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODES = new Set<AdminCreditMode>(['user', 'team', 'hybrid']);

function integerLimit(value: unknown) {
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 0 && limit <= 1_000_000 ? limit : null;
}

export async function GET() {
  try {
    const auth = await requireAdminDashboardAccess();
    const overview = await loadAdminCreditOverview(
      auth.supabase,
      auth.organizationId,
      auth.organizationName,
    );
    return NextResponse.json(overview, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return adminDashboardAuthErrorResponse(error)
      || NextResponse.json({ error: 'No pudimos cargar la configuración de créditos.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAdminDashboardAccess();
    const body = await request.json().catch(() => ({}));
    const subjectType = String(body.subjectType || '').trim();
    const subjectId = subjectType === 'organization'
      ? auth.organizationId
      : String(body.subjectId || '').trim();
    const mode = body.mode == null ? null : String(body.mode).trim() as AdminCreditMode;
    const userDailyLimit = body.userDailyLimit == null ? null : integerLimit(body.userDailyLimit);
    const teamDailyLimit = body.teamDailyLimit == null ? null : integerLimit(body.teamDailyLimit);
    const reason = String(body.reason || '').trim().slice(0, 500) || null;

    if (!['organization', 'user', 'team'].includes(subjectType)
      || !UUID_RE.test(subjectId)
      || (subjectType !== 'team' && (!mode || !MODES.has(mode)))
      || (subjectType !== 'team' && userDailyLimit == null)
      || (subjectType === 'organization' && teamDailyLimit == null)
      || (subjectType === 'team' && teamDailyLimit == null)) {
      return NextResponse.json({ error: 'La política de créditos no es válida.' }, { status: 400 });
    }

    if (subjectType === 'organization' && mode && mode !== 'user') {
      const [{ data: members, error: membersError }, { data: primaryGroups, error: groupsError }] = await Promise.all([
        auth.supabase.from('organization_members').select('user_id').eq('organization_id', auth.organizationId),
        auth.supabase.from('organization_reporting_group_members')
          .select('user_id')
          .eq('organization_id', auth.organizationId)
          .eq('is_primary', true)
          .is('unassigned_at', null),
      ]);
      if (membersError || groupsError) throw membersError || groupsError;
      const assigned = new Set((primaryGroups || []).map((row: any) => String(row.user_id)));
      const missing = (members || []).filter((row: any) => !assigned.has(String(row.user_id))).length;
      if (missing > 0) {
        return NextResponse.json({
          error: `${missing} usuario${missing === 1 ? '' : 's'} no tiene${missing === 1 ? '' : 'n'} equipo principal. Asígnalo antes de activar este modo.`,
        }, { status: 409 });
      }
    }

    if (subjectType === 'user') {
      const { data: member, error: memberError } = await auth.supabase.from('organization_members')
        .select('user_id')
        .eq('organization_id', auth.organizationId)
        .eq('user_id', subjectId)
        .maybeSingle();
      if (memberError) throw memberError;
      if (!member) return NextResponse.json({ error: 'El usuario no pertenece a esta organización.' }, { status: 404 });
      if (mode && mode !== 'user') {
        const { data: primary, error: primaryError } = await auth.supabase.from('organization_reporting_group_members')
          .select('group_id')
          .eq('organization_id', auth.organizationId)
          .eq('user_id', subjectId)
          .eq('is_primary', true)
          .is('unassigned_at', null)
          .maybeSingle();
        if (primaryError) throw primaryError;
        if (!primary) {
          return NextResponse.json({ error: 'Asigna un equipo principal antes de usar créditos de equipo.' }, { status: 409 });
        }
      }
    }

    const { data, error } = await auth.supabase.rpc('schedule_antonia_credit_policy_v1', {
      p_organization_id: auth.organizationId,
      p_actor_user_id: auth.user.id,
      p_subject_type: subjectType,
      p_subject_id: subjectId,
      p_mode: subjectType === 'team' ? null : mode,
      p_user_daily_limit: subjectType === 'team' ? null : userDailyLimit,
      p_team_daily_limit: subjectType === 'user' ? null : teamDailyLimit,
      p_reason: reason,
    });
    if (error) throw error;
    return NextResponse.json({ policy: data }, { status: 201 });
  } catch (error) {
    return adminDashboardAuthErrorResponse(error)
      || NextResponse.json({ error: 'No pudimos programar la política de créditos.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdminDashboardAccess();
    const body = await request.json().catch(() => ({}));
    const subjectType = String(body.subjectType || '').trim();
    const subjectId = String(body.subjectId || '').trim();
    if (!['user', 'team'].includes(subjectType) || !UUID_RE.test(subjectId)) {
      return NextResponse.json({ error: 'La política seleccionada no es válida.' }, { status: 400 });
    }
    const { error } = await auth.supabase.rpc('clear_antonia_credit_policy_v1', {
      p_organization_id: auth.organizationId,
      p_actor_user_id: auth.user.id,
      p_subject_type: subjectType,
      p_subject_id: subjectId,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return adminDashboardAuthErrorResponse(error)
      || NextResponse.json({ error: 'No pudimos restaurar la política heredada.' }, { status: 500 });
  }
}
