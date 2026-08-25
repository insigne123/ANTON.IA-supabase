import { NextRequest, NextResponse } from 'next/server';
import { deriveLifecycleState, safeInsertEmailEvent } from '@/lib/email-observability';
import { safetyStopCampaignRecipientFromContacted } from '@/lib/server/inbound-reply-ingestion';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RECONCILIATION_PAGE_SIZE = 50;
const REPLY_LOOKUP_CONCURRENCY = 10;
const UuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ContactedCandidate = {
  id: string;
  lead_id: string | null;
  email: string | null;
  status: string | null;
  replied_at: string | null;
  lifecycle_state: string | null;
  message_id: string | null;
  internet_message_id: string | null;
  thread_id: string | null;
  conversation_id: string | null;
  provider: string | null;
};

async function findLatestReply(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  organizationId: string,
  row: ContactedCandidate,
) {
  const directResult = await admin
    .from('lead_responses')
    .select('id, contacted_id, lead_id, type, created_at, content')
    .eq('organization_id', organizationId)
    .eq('type', 'reply')
    .eq('contacted_id', row.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (directResult.error) throw directResult.error;
  if (directResult.data || !row.lead_id) return directResult.data;

  const fallbackResult = await admin
    .from('lead_responses')
    .select('id, contacted_id, lead_id, type, created_at, content')
    .eq('organization_id', organizationId)
    .eq('type', 'reply')
    .is('contacted_id', null)
    .eq('lead_id', row.lead_id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (fallbackResult.error) throw fallbackResult.error;
  return fallbackResult.data;
}

export async function POST(request: NextRequest) {
  try {
    const { organizationId } = await requireAuth();
    const cursor = request.nextUrl.searchParams.get('cursor')?.trim() || null;
    if (cursor && !UuidPattern.test(cursor)) {
      return NextResponse.json({ error: 'REPLY_RECONCILIATION_CURSOR_INVALID' }, { status: 400 });
    }
    const admin = getSupabaseAdminClient();

    let contactedQuery = admin
      .from('contacted_leads')
      .select('id, lead_id, email, status, replied_at, lifecycle_state, message_id, internet_message_id, thread_id, conversation_id, provider')
      .eq('organization_id', organizationId)
      .is('replied_at', null)
      .or('status.is.null,status.neq.replied')
      .order('id', { ascending: true })
      .limit(RECONCILIATION_PAGE_SIZE + 1);
    if (cursor) contactedQuery = contactedQuery.gt('id', cursor);
    const contactedResult = await contactedQuery;
    if (contactedResult.error) throw contactedResult.error;
    const contactedRows = (contactedResult.data || []) as ContactedCandidate[];
    const hasMore = contactedRows.length > RECONCILIATION_PAGE_SIZE;
    const contacted = contactedRows.slice(0, RECONCILIATION_PAGE_SIZE);

    const repliesByContactedId = new Map<string, any>();
    for (let offset = 0; offset < contacted.length; offset += REPLY_LOOKUP_CONCURRENCY) {
      const chunk = contacted.slice(offset, offset + REPLY_LOOKUP_CONCURRENCY);
      const matches = await Promise.all(chunk.map(async (row) => ({
        contactedId: row.id,
        reply: await findLatestReply(admin, organizationId, row),
      })));
      for (const match of matches) {
        if (match.reply) repliesByContactedId.set(match.contactedId, match.reply);
      }
    }

    let updated = 0;
    for (const row of contacted) {
      const match = repliesByContactedId.get(row.id);
      if (!match) continue;

      const repliedAt = match.created_at || new Date().toISOString();
      await safetyStopCampaignRecipientFromContacted(admin, {
        contactedId: row.id,
        reason: 'recipient_replied',
      });
      const updateResult = await admin
        .from('contacted_leads')
        .update({
          status: 'replied',
          replied_at: repliedAt,
          last_event_type: 'reply',
          last_event_at: repliedAt,
          lifecycle_state: deriveLifecycleState(row.lifecycle_state || row.status, 'reply'),
          last_update_at: new Date().toISOString(),
        } as any)
        .eq('organization_id', organizationId)
        .eq('id', row.id)
        .is('replied_at', null)
        .or('status.is.null,status.neq.replied')
        .select('id')
        .maybeSingle();
      if (updateResult.error) throw updateResult.error;
      if (!updateResult.data) continue;

      await safeInsertEmailEvent(admin, {
        organization_id: organizationId,
        contacted_id: row.id,
        lead_id: row.lead_id || null,
        provider: row.provider || null,
        event_type: 'reply',
        event_source: 'reply_reconcile',
        event_at: repliedAt,
        thread_key: null,
        message_id: row.message_id || null,
        internet_message_id: row.internet_message_id || null,
        meta: {
          replyResponseId: match.id,
          preview: String(match.content || '').slice(0, 300),
        },
      });
      updated += 1;
    }

    return NextResponse.json({
      ok: true,
      organizationId,
      scanned: contacted.length,
      updated,
      hasMore,
      nextCursor: hasMore && contacted.length > 0 ? contacted[contacted.length - 1].id : null,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
