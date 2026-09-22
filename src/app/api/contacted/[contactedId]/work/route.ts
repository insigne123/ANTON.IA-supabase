import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, handleAuthError, AuthError } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { classifyReply } from '@/lib/reply-classifier';
import { conversationAdvice } from '@/lib/conversation-advice';
import { setFirstContactPlanAutoSend } from '@/lib/server/campaigns-v2/plan';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('commitment'), kind: z.enum(['call','meeting','reminder']), title: z.string().trim().min(1).max(300), dueAt: z.string().datetime({ offset: true }) }),
  z.object({ action: z.literal('complete'), id: z.string().uuid() }),
  z.object({ action: z.literal('analyze') }),
  z.object({ action: z.literal('replyDraft'), key: z.string().uuid(), subject: z.string().max(998), body: z.string().max(12000), tracking: z.boolean(), pending: z.boolean() }),
  z.object({ action: z.literal('reschedule'), stepId: z.string().uuid(), dueAt: z.string().datetime({ offset: true }) }),
  z.object({ action: z.literal('automation'), campaignId: z.string().uuid(), enabled: z.boolean() }),
]);
export async function POST(req: NextRequest, context: { params: Promise<{ contactedId: string }> }) {
  try {
    const auth = await requireAuth();
    const { contactedId } = await context.params;
    const body = schema.parse(await req.json());
    const admin = getSupabaseAdminClient();
    const { data: row, error } = await admin.from('contacted_leads').select('id,email,user_id,organization_id,last_reply_text,reply_message_id,replied_at,data').eq('id', contactedId).eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
    if (error) throw error;
    if (!row) throw new AuthError('Conversación no disponible', 404);
    if (body.action === 'reschedule' || body.action === 'automation') {
      const enrollment = await admin.from('campaign_enrollments').select('id,campaign_id').eq('organization_id', auth.organizationId).eq('user_id', auth.user.id).eq('recipient_email', row.email);
      if (enrollment.error) throw enrollment.error;
      if (body.action === 'reschedule') {
        const step = await admin.from('campaign_recipient_steps').select('id,enrollment_id').eq('organization_id', auth.organizationId).eq('user_id', auth.user.id).eq('id', body.stepId).maybeSingle();
        if (step.error) throw step.error;
        if (!step.data || !enrollment.data.some(e => e.id === step.data!.enrollment_id)) throw new AuthError('Seguimiento no disponible', 404);
        const result = await admin.rpc('reschedule_contacted_step', { p_org: auth.organizationId, p_user: auth.user.id, p_step: body.stepId, p_due: body.dueAt });
        if (result.error) throw new AuthError('No se puede mover un envío iniciado, detenido o con respuesta. Actualiza la conversación.', 409);
      } else {
        if (!enrollment.data.some(e => e.campaign_id === body.campaignId) || (body.enabled && row.replied_at)) throw new AuthError('No se puede reactivar una secuencia con respuesta.', 409);
        const campaign = await admin.from('campaigns').select('initial_native_draft_id').eq('id', body.campaignId).eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
        if (campaign.error) throw campaign.error;
        if (!campaign.data?.initial_native_draft_id) throw new AuthError('Secuencia no disponible', 404);
        await setFirstContactPlanAutoSend({ draftId: campaign.data.initial_native_draft_id, autoSend: body.enabled, userId: auth.user.id, organizationId: auth.organizationId });
      }
      return NextResponse.json({ ok: true });
    }
    let kind: string = body.action;
    let value: unknown = body;
    if (body.action === 'replyDraft') {
      const pending = (row.data as any)?.replyDraft;
      if (pending?.pending && pending.key !== body.key) throw new AuthError('Comprueba primero el envío pendiente de esta conversación.', 409);
    }
    if (body.action === 'analyze') {
      if (!row.reply_message_id || !row.last_reply_text) throw new AuthError('Sin respuesta registrada para analizar.', 409);
      const cached = (row.data as any)?.advice;
      if (cached?.replyId === row.reply_message_id) return NextResponse.json({ ok: true, value: cached });
      value = conversationAdvice(await classifyReply(row.last_reply_text), row.reply_message_id);
      kind = 'advice';
    }
    const result = await admin.rpc('update_contacted_work', { p_org: auth.organizationId, p_user: auth.user.id, p_contact: contactedId, p_kind: kind, p_value: value as any });
    if (result.error) throw new AuthError('La conversación cambió o la fecha no es válida. Actualízala e intenta nuevamente.', 409);
    return NextResponse.json({ ok: true, value: result.data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Revisa los campos y la fecha.' }, { status: 400 });
    return handleAuthError(error);
  }
}
