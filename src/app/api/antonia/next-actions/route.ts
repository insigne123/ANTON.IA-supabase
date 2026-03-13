import { NextResponse } from 'next/server';

import { buildSuggestedMeetingReply } from '@/lib/antonia-autopilot';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type NextAction = {
  id: string;
  priority: number;
  kind: string;
  title: string;
  description: string;
  ctaLabel: string;
  ctaTarget: string;
  ctaTargetType: 'tab' | 'route';
  suggestedReply?: string;
  meta?: Record<string, any>;
};

function buildActionFromException(row: any, config: any): NextAction | null {
  const lead = row?.payload?.lead || {};
  const leadLabel = lead?.fullName || lead?.name || 'Lead';

  if (row.category === 'approval_required') {
    return {
      id: row.id,
      priority: 95,
      kind: 'approval',
      title: `Aprobar contacto para ${leadLabel}`,
      description: row.description || 'ANTONIA necesita aprobacion antes de enviar el primer contacto.',
      ctaLabel: 'Revisar excepciones',
      ctaTarget: 'autopilot',
      ctaTargetType: 'tab',
      meta: { missionId: row.mission_id, severity: row.severity },
    };
  }

  if (row.category === 'positive_reply') {
    return {
      id: row.id,
      priority: row.severity === 'critical' ? 100 : 92,
      kind: 'hot_reply',
      title: `${leadLabel} respondio con interes`,
      description: row.description || 'ANTONIA detecto un reply positivo y recomienda avanzar rapido.',
      ctaLabel: 'Abrir respondidos',
      ctaTarget: '/contacted/replied',
      ctaTargetType: 'route',
      suggestedReply: buildSuggestedMeetingReply({
        leadName: lead?.fullName || lead?.name,
        companyName: lead?.companyName || lead?.company,
        bookingLink: config?.booking_link,
        meetingInstructions: config?.meeting_instructions,
      }),
      meta: { missionId: row.mission_id, severity: row.severity },
    };
  }

  if (row.category === 'negative_reply_guardrail') {
    return {
      id: row.id,
      priority: 90,
      kind: 'guardrail',
      title: 'Revisar mision pausada por respuesta negativa',
      description: row.description || 'ANTONIA activo un guardrail y freno el flujo para evitar dano reputacional.',
      ctaLabel: 'Ver autopilot',
      ctaTarget: 'autopilot',
      ctaTargetType: 'tab',
      meta: { missionId: row.mission_id, severity: row.severity },
    };
  }

  if (row.category === 'send_failed') {
    return {
      id: row.id,
      priority: 82,
      kind: 'delivery',
      title: `Resolver fallo de envio para ${leadLabel}`,
      description: row.description || 'Hay un error de entrega que puede cortar el rendimiento del autopilot.',
      ctaLabel: 'Revisar autopilot',
      ctaTarget: 'autopilot',
      ctaTargetType: 'tab',
      meta: { missionId: row.mission_id, severity: row.severity },
    };
  }

  if (row.category === 'compliance_block') {
    return {
      id: row.id,
      priority: 86,
      kind: 'compliance',
      title: `Revisar bloqueo de compliance para ${leadLabel}`,
      description: row.description || 'ANTONIA freno un contacto por unsubscribe o dominio bloqueado.',
      ctaLabel: 'Revisar autopilot',
      ctaTarget: 'autopilot',
      ctaTargetType: 'tab',
      meta: { missionId: row.mission_id, severity: row.severity },
    };
  }

  return null;
}

export async function GET() {
  try {
    const { organizationId } = await requireAuth();
    const admin = getSupabaseAdminClient();

    const [configRes, exceptionRes, missionRes] = await Promise.all([
      admin
        .from('antonia_config')
        .select('booking_link, meeting_instructions, autopilot_enabled')
        .eq('organization_id', organizationId)
        .maybeSingle(),
      admin
        .from('antonia_exceptions')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(50),
      admin
        .from('antonia_missions')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .limit(5),
    ]);

    const actions = ((exceptionRes.data || []) as any[])
      .map((row) => buildActionFromException(row, configRes.data || {}))
      .filter(Boolean) as NextAction[];

    if (actions.length === 0 && (configRes.data as any)?.autopilot_enabled && ((missionRes.data || []) as any[]).length === 0) {
      actions.push({
        id: 'create-mission',
        priority: 70,
        kind: 'setup',
        title: 'Crear una mision activa para arrancar el autopilot',
        description: 'El autopilot esta encendido, pero no hay misiones activas ejecutando pipeline.',
        ctaLabel: 'Ir a crear mision',
        ctaTarget: 'builder',
        ctaTargetType: 'tab',
      });
    }

    actions.sort((a, b) => b.priority - a.priority);

    return NextResponse.json({ items: actions.slice(0, 8) });
  } catch (error) {
    return handleAuthError(error);
  }
}
