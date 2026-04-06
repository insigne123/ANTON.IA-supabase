import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { syncLeadAutopilotToCrm } from '@/lib/server/crm-autopilot';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function clampLimit(raw: string | null, fallback = 50, max = 200) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(num)));
}

export async function GET(req: NextRequest) {
  try {
    const { organizationId } = await requireAuth();
    const admin = getSupabaseAdminClient();
    const status = String(req.nextUrl.searchParams.get('status') || 'open').trim();
    const missionId = String(req.nextUrl.searchParams.get('missionId') || '').trim();
    const limit = clampLimit(req.nextUrl.searchParams.get('limit'));

    let query = admin
      .from('antonia_exceptions')
      .select('*', { count: 'exact' })
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

    if (missionId) {
      query = query.eq('mission_id', missionId);
    }

    const { data, count, error } = await query;
    if (error) {
      throw error;
    }

    return NextResponse.json({
      items: data || [],
      total: count || 0,
      limit,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { organizationId } = await requireAuth();
    const admin = getSupabaseAdminClient();
    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || '').trim();
    const action = String(body?.action || '').trim();
    const note = String(body?.note || '').trim();

    if (!id || !action) {
      return NextResponse.json({ error: 'Missing id or action' }, { status: 400 });
    }

    const { data: exception, error: exceptionError } = await admin
      .from('antonia_exceptions')
      .select('*')
      .eq('id', id)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (exceptionError) throw exceptionError;
    if (!exception) {
      return NextResponse.json({ error: 'Exception not found' }, { status: 404 });
    }

    if (action === 'approve_contact') {
      const payload = exception.payload || {};
      const contactTaskPayload = payload.contactTaskPayload || {
        userId: payload.userId,
        campaignName: payload.campaignName,
        enrichedLeads: payload.lead ? [payload.lead] : [],
      };

      if (!exception.mission_id || !contactTaskPayload?.userId || !Array.isArray(contactTaskPayload?.enrichedLeads) || contactTaskPayload.enrichedLeads.length === 0) {
        return NextResponse.json({ error: 'Exception does not contain enough data to approve contact' }, { status: 400 });
      }

      const { error: taskError } = await admin
        .from('antonia_tasks')
        .insert({
          mission_id: exception.mission_id,
          organization_id: organizationId,
          type: 'CONTACT',
          status: 'pending',
          payload: contactTaskPayload,
          idempotency_key: `exception_${exception.id}_approve_contact`,
          created_at: new Date().toISOString(),
        });

      if (taskError && String((taskError as any)?.code || '') !== '23505') {
        throw taskError;
      }

      const { data: updated, error: updateError } = await admin
        .from('antonia_exceptions')
        .update({
          status: 'approved',
          resolution_note: note || 'Contacto aprobado manualmente',
          resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('organization_id', organizationId)
        .select('*')
        .single();

      if (updateError) throw updateError;

      await syncLeadAutopilotToCrm(admin, {
        organizationId,
        leadId: exception.lead_id,
        stage: 'qualified',
        notes: note || 'Contacto aprobado manualmente',
        nextAction: 'ANTONIA enviara el contacto aprobado',
        nextActionType: 'approved_contact',
        nextActionDueAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        autopilotStatus: 'approved_for_contact',
        lastAutopilotEvent: 'approval_granted',
      });
      return NextResponse.json({ item: updated });
    }

    if (!['resolve', 'dismiss'].includes(action)) {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }

    const status = action === 'dismiss' ? 'dismissed' : 'resolved';
    const { data: updated, error: updateError } = await admin
      .from('antonia_exceptions')
      .update({
        status,
        resolution_note: note || null,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select('*')
      .single();

    if (updateError) throw updateError;

    await syncLeadAutopilotToCrm(admin, {
      organizationId,
      leadId: exception.lead_id,
      notes: note || exception.title,
      nextAction: status === 'dismissed' ? 'Sin accion pendiente' : 'Excepcion resuelta, monitorear respuesta',
      nextActionType: status === 'dismissed' ? 'none' : 'monitor',
      nextActionDueAt: status === 'dismissed' ? null : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      autopilotStatus: status,
      lastAutopilotEvent: status,
    });

    return NextResponse.json({ item: updated });
  } catch (error) {
    return handleAuthError(error);
  }
}
