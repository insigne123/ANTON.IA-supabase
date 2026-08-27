import { NextRequest, NextResponse } from 'next/server';

import { eventToneForKind, normalizeEmail, type CommercialTimelineEvent } from '@/lib/commercial-intelligence';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function pushEvent(events: CommercialTimelineEvent[], event: Omit<CommercialTimelineEvent, 'tone'> & { tone?: CommercialTimelineEvent['tone'] }) {
  if (!event.occurredAt) return;
  events.push({ ...event, tone: event.tone || eventToneForKind(event.kind) });
}

function isMissingTableError(error: any) {
  const message = String(error?.message || error?.details || '').toLowerCase();
  return message.includes('does not exist') || message.includes('schema cache');
}

function mapEmailEventType(value?: string | null): CommercialTimelineEvent['kind'] | null {
  const type = String(value || '').toLowerCase();
  if (['open', 'opened', 'email_opened'].includes(type)) return 'email_opened';
  if (['click', 'clicked', 'email_clicked'].includes(type)) return 'email_clicked';
  if (['reply', 'replied', 'reply_received'].includes(type)) return 'reply_received';
  if (['bounce', 'bounced', 'delivery_failure', 'failed'].includes(type)) return 'bounce_detected';
  if (['sent', 'email_sent'].includes(type)) return 'email_sent';
  return null;
}

function eventTitle(kind: CommercialTimelineEvent['kind'], subject?: string | null) {
  switch (kind) {
    case 'email_sent':
      return subject ? `Email enviado: ${subject}` : 'Email enviado';
    case 'email_opened':
      return 'Email abierto';
    case 'email_clicked':
      return 'Click registrado';
    case 'reply_received':
      return 'Respuesta recibida';
    case 'bounce_detected':
      return 'Rebote detectado';
    case 'research_completed':
      return 'Investigacion completada';
    case 'crm_updated':
      return 'CRM actualizado';
    case 'note':
      return 'Nota guardada';
    default:
      return 'Evento comercial';
  }
}

export async function GET(req: NextRequest) {
  try {
    const { user, organizationId } = await requireAuth();
    const admin = getSupabaseAdminClient();
    const leadId = String(req.nextUrl.searchParams.get('leadId') || '').trim();
    const gid = String(req.nextUrl.searchParams.get('gid') || '').trim();
    const email = normalizeEmail(req.nextUrl.searchParams.get('email'));
    const events: CommercialTimelineEvent[] = [];

    if (!leadId && !email && !gid) {
      return NextResponse.json({ events: [] });
    }

    const contactQueries = [];
    if (leadId) {
      contactQueries.push(
        admin
          .from('contacted_leads')
          .select('id, lead_id, name, email, company, subject, provider, sent_at, opened_at, clicked_at, click_count, replied_at, reply_preview, reply_summary, reply_intent, bounced_at, bounce_category, bounce_reason, delivery_status, evaluation_status, campaign_followup_allowed, campaign_followup_reason')
          .or(`organization_id.eq.${organizationId},user_id.eq.${user.id}`)
          .eq('lead_id', leadId)
          .order('sent_at', { ascending: false })
          .limit(25)
      );
    }
    if (email) {
      contactQueries.push(
        admin
          .from('contacted_leads')
          .select('id, lead_id, name, email, company, subject, provider, sent_at, opened_at, clicked_at, click_count, replied_at, reply_preview, reply_summary, reply_intent, bounced_at, bounce_category, bounce_reason, delivery_status, evaluation_status, campaign_followup_allowed, campaign_followup_reason')
          .or(`organization_id.eq.${organizationId},user_id.eq.${user.id}`)
          .ilike('email', email)
          .order('sent_at', { ascending: false })
          .limit(25)
      );
    }

    const contactedResults = await Promise.all(contactQueries);
    const contactedRows = Array.from(
      new Map(
        contactedResults
          .flatMap((result) => {
            if (result.error) {
              console.warn('[commercial timeline] contacted query failed:', result.error.message);
              return [];
            }
            return result.data || [];
          })
          .map((row: any) => [row.id, row])
      ).values()
    );

    for (const row of contactedRows as any[]) {
      pushEvent(events, {
        id: `sent:${row.id}`,
        kind: 'email_sent',
        title: eventTitle('email_sent', row.subject),
        description: row.provider ? `Enviado con ${row.provider}.` : 'Email registrado como enviado.',
        occurredAt: row.sent_at,
        source: 'Email',
      });
      pushEvent(events, {
        id: `opened:${row.id}`,
        kind: 'email_opened',
        title: eventTitle('email_opened'),
        description: row.subject ? `El lead abrio "${row.subject}".` : 'El lead abrio el email.',
        occurredAt: row.opened_at,
        source: 'Tracking',
      });
      pushEvent(events, {
        id: `clicked:${row.id}`,
        kind: 'email_clicked',
        title: eventTitle('email_clicked'),
        description: row.click_count ? `${row.click_count} click(s) registrados.` : 'Se registro un click en el email.',
        occurredAt: row.clicked_at,
        source: 'Tracking',
      });
      pushEvent(events, {
        id: `reply:${row.id}`,
        kind: 'reply_received',
        title: eventTitle('reply_received'),
        description: row.reply_summary || row.reply_preview || 'El lead respondio al correo.',
        occurredAt: row.replied_at,
        source: row.reply_intent ? `Reply: ${row.reply_intent}` : 'Reply',
      });
      pushEvent(events, {
        id: `bounce:${row.id}`,
        kind: 'bounce_detected',
        title: eventTitle('bounce_detected'),
        description: row.bounce_reason || row.campaign_followup_reason || 'Conviene revisar deliverability antes de insistir.',
        occurredAt: row.bounced_at,
        source: row.bounce_category || row.delivery_status || 'Deliverability',
      });
      if (row.evaluation_status === 'do_not_contact' || row.campaign_followup_allowed === false) {
        pushEvent(events, {
          id: `privacy:${row.id}`,
          kind: 'privacy_blocked',
          title: 'Contacto pausado por guardrail',
          description: 'Este lead no debe recibir follow-ups automaticos hasta una revision.',
          occurredAt: row.replied_at || row.bounced_at || row.sent_at,
          source: 'Privacy',
        });
      }
    }

    const contactedIds = contactedRows.map((row: any) => row.id).filter(Boolean);
    if (contactedIds.length > 0) {
      const { data: emailEvents, error } = await admin
        .from('email_events')
        .select('id, contacted_id, event_type, event_at, provider, meta')
        .in('contacted_id', contactedIds)
        .order('event_at', { ascending: false })
        .limit(100);
      if (error && !isMissingTableError(error)) {
        console.warn('[commercial timeline] email_events query failed:', error.message);
      }
      for (const row of (emailEvents || []) as any[]) {
        const kind = mapEmailEventType(row.event_type);
        if (!kind) continue;
        pushEvent(events, {
          id: `event:${row.id}`,
          kind,
          title: eventTitle(kind),
          description: row.meta?.subject || row.meta?.message || null,
          occurredAt: row.event_at,
          source: row.provider || 'Email event',
        });
      }
    }

    if (email || leadId) {
      let researchQuery = admin
        .from('lead_research_reports')
        .select('id, lead_ref, email, company_name, company_domain, generated_at, updated_at')
        .or(`organization_id.eq.${organizationId},user_id.eq.${user.id}`)
        .order('updated_at', { ascending: false })
        .limit(10);
      if (email) researchQuery = researchQuery.ilike('email', email);
      else researchQuery = researchQuery.eq('lead_ref', leadId);

      const { data: reports, error } = await researchQuery;
      if (error && !isMissingTableError(error)) {
        console.warn('[commercial timeline] research query failed:', error.message);
      }
      for (const row of (reports || []) as any[]) {
        pushEvent(events, {
          id: `research:${row.id}`,
          kind: 'research_completed',
          title: eventTitle('research_completed'),
          description: row.company_name ? `Contexto comercial generado para ${row.company_name}.` : 'Contexto comercial disponible para este lead.',
          occurredAt: row.updated_at || row.generated_at,
          source: 'Research',
        });
      }
    }

    if (gid) {
      const { data: custom, error } = await admin
        .from('unified_crm_data')
        .select('id, stage, owner, notes, next_action, next_action_due_at, autopilot_status, last_autopilot_event, updated_at')
        .eq('id', gid)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (error && !isMissingTableError(error)) {
        console.warn('[commercial timeline] crm custom query failed:', error.message);
      }
      if (custom?.updated_at) {
        pushEvent(events, {
          id: `crm:${custom.id}`,
          kind: 'crm_updated',
          title: eventTitle('crm_updated'),
          description: custom.next_action || custom.last_autopilot_event || custom.stage ? 'El estado comercial tiene cambios guardados.' : null,
          occurredAt: custom.updated_at,
          source: custom.owner ? `Owner: ${custom.owner}` : 'CRM',
        });
      }
      if (custom?.notes) {
        pushEvent(events, {
          id: `note:${custom.id}`,
          kind: 'note',
          title: eventTitle('note'),
          description: custom.notes,
          occurredAt: custom.updated_at || new Date().toISOString(),
          source: 'CRM',
        });
      }
    }

    const uniqueEvents = Array.from(new Map(events.map((event) => [event.id, event])).values())
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
      .slice(0, 50);

    return NextResponse.json({ events: uniqueEvents });
  } catch (error) {
    return handleAuthError(error);
  }
}
