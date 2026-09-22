import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAuth, handleAuthError } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { mailboxAccessToken, readMailboxConversation } from '@/lib/server/reply-sync';
import { loadPlannedTouches } from '@/lib/server/contacted-conversations';
import { stripHtmlToText } from '@/lib/email-outbound';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ contactedId: string }> };
export async function GET(_req: NextRequest, context: Context) {
  try {
    const { user, organizationId, supabase } = await requireAuth();
    const { contactedId } = await context.params;
    const { data: row, error } = await supabase.from('contacted_leads').select('*').eq('id', contactedId).eq('organization_id', organizationId).maybeSingle();
    if (error) throw error;
    if (!row) throw new AuthError('Contacto no disponible', 404);
    const related = await supabase.from('contacted_leads').select('id').eq('organization_id', organizationId).eq('user_id', row.user_id).eq('provider', row.provider).eq('email', row.email).limit(200);
    if (related.error) throw related.error;
    const relatedIds = (related.data || []).map((item: any) => item.id);
    const responses = await supabase.from('lead_responses').select('id,email_message_id,content,created_at').eq('organization_id', organizationId).in('contacted_id', relatedIds.length ? relatedIds : [row.id]).order('created_at').limit(500);
    if (responses.error) throw responses.error;
    let messages = (responses.data || []).map((r: any) => ({ id: r.email_message_id || r.id, direction: 'inbound', from: row.email, to: [], subject: row.reply_subject || '', receivedAt: r.created_at, text: stripHtmlToText(r.content || ''), source: 'stored' }));
    let trackingAvailable = false;
    let trackingEvents: any[] = [];
    if (row.user_id === user.id && row.message_id) {
      const dispatch = await supabase.from('outbound_dispatches').select('provider_response,version_id,completed_at').eq('organization_id', organizationId).eq('user_id', user.id).eq('provider_message_id', row.message_id).eq('status', 'sent').limit(1).maybeSingle();
      if (!dispatch.error && dispatch.data) {
        const snapshot = dispatch.data.provider_response?.outboundSnapshot;
        trackingAvailable = snapshot?.tracking?.pixelEnabled === true;
        if (snapshot && typeof snapshot === 'object') messages.push({ id: row.message_id, direction: 'outbound', from: null, to: [row.email], subject: snapshot.subject || row.subject, receivedAt: snapshot.capturedAt || dispatch.data.completed_at || row.sent_at, text: stripHtmlToText(snapshot.text || snapshot.html || ''), source: snapshot.source || 'submitted_to_provider' });
        else if (dispatch.data.version_id) {
          const version = await supabase.from('messaging_draft_versions').select('payload').eq('organization_id', organizationId).eq('user_id', user.id).eq('id', dispatch.data.version_id).maybeSingle();
          const content = version.data?.payload?.content;
          if (!version.error && content) messages.push({ id: row.message_id, direction: 'outbound', from: null, to: [row.email], subject: content.subject || row.subject, receivedAt: dispatch.data.completed_at || row.sent_at, text: stripHtmlToText(content.text || content.html || ''), source: 'approved_version' });
        }
      }
      const events = await supabase.from('email_events').select('id,event_type,event_source,event_at,message_id,meta').eq('organization_id', organizationId).eq('contacted_id', row.id).eq('message_id', row.message_id).eq('event_source', 'dispatch_tracking').order('event_at', { ascending: false }).limit(25);
      if (!events.error) trackingEvents = events.data || [];
    }
    let providerComplete = false;
    let providerError: string | null = null;
    const recordedOutbound = messages.filter((m: any) => m.direction === 'outbound');
    if (row.user_id === user.id && ['gmail', 'outlook'].includes(row.provider)) {
      try {
        const token = await mailboxAccessToken(getSupabaseAdminClient(), user.id, row.provider);
        if (!token) throw new Error('connection_required');
        const live = await readMailboxConversation(token, row);
        messages = live.messages.map(m => ({ ...m, text: m.text || stripHtmlToText(m.html || ''), html: undefined }));
        for (const m of recordedOutbound) if (!messages.some((liveMessage: any) => liveMessage.direction === 'outbound' && liveMessage.id === m.id)) messages.push(m);
        for (const r of responses.data || []) if (!messages.some((m: any) => m.id === r.email_message_id)) messages.push({ id: r.email_message_id || r.id, direction: 'inbound', from: row.email, to: [], receivedAt: r.created_at, text: stripHtmlToText(r.content || ''), source: 'stored' });
        providerComplete = live.complete;
      } catch { providerError = 'No pudimos consultar el correo. Mostramos el historial guardado.'; }
    } else providerError = 'El contenido del proveedor solo está disponible para el titular de la cuenta.';
    if (!messages.some((m: any) => m.direction === 'outbound') && row.sent_at && row.status !== 'scheduled') {
      messages.push({ id: `sent:${row.id}`, direction: 'outbound', from: null, to: [row.email], receivedAt: row.sent_at, subject: row.subject, text: null, source: 'metadata' });
    }
    const plans = await loadPlannedTouches(supabase, organizationId, [row.email], [row.user_id]);
    const versions = plans.touches.map(t => t.versionId).filter(Boolean);
    if (versions.length) {
      const drafts = await supabase.from('messaging_draft_versions').select('id,payload').eq('organization_id', organizationId).in('id', versions);
      if (drafts.error) throw drafts.error;
      for (const touch of plans.touches) {
        const content = drafts.data?.find((d: any) => d.id === touch.versionId)?.payload?.content;
        if (content) { touch.subject = content.subject; touch.text = content.text || stripHtmlToText(content.html || ''); }
      }
    }
    const work = { commitment: row.data?.commitment || null, advice: row.data?.advice?.replyId === row.reply_message_id ? row.data.advice : null, replyDraft: row.user_id === user.id ? row.data?.replyDraft || null : null };
    return NextResponse.json({ work, messages: messages.sort((a: any, b: any) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt)), plans, providerComplete, providerError, trackingAvailable, trackingEvents, canResolve: row.user_id === user.id }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return handleAuthError(error); }
}

export async function PATCH(req: NextRequest, context: Context) {
  try {
    const { user, organizationId, supabase } = await requireAuth();
    const { contactedId } = await context.params;
    const body = await req.json();
    if (typeof body.resolved !== 'boolean') throw new AuthError('Estado inválido', 400);
    // A reply arriving after the user opened the view must remain pending.
    const observedAt = typeof body.observedAt === 'string' ? Date.parse(body.observedAt) : NaN;
    if (body.resolved && (!Number.isFinite(observedAt) || observedAt > Date.now())) throw new AuthError('Actualiza la conversación antes de resolverla', 400);
    const { data, error } = await supabase.from('contacted_leads').update({ conversation_resolved_at: body.resolved ? new Date(observedAt).toISOString() : null }).eq('id', contactedId).eq('organization_id', organizationId).eq('user_id', user.id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new AuthError('No puedes modificar esta conversación', 403);
    return NextResponse.json({ ok: true });
  } catch (error) { return handleAuthError(error); }
}
