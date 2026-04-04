import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { deriveLifecycleState, safeInsertEmailEvent } from '@/lib/email-observability';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: member } = await admin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  const organizationId = member?.organization_id;
  if (!organizationId) return NextResponse.json({ error: 'No organization found' }, { status: 404 });

  const [{ data: contacted }, { data: responses }] = await Promise.all([
    admin
      .from('contacted_leads')
      .select('id, lead_id, email, status, replied_at, lifecycle_state, message_id, internet_message_id, thread_id, conversation_id, provider')
      .eq('organization_id', organizationId)
      .order('sent_at', { ascending: false })
      .limit(1000),
    admin
      .from('lead_responses')
      .select('id, contacted_id, lead_id, type, created_at, content')
      .eq('organization_id', organizationId)
      .eq('type', 'reply')
      .order('created_at', { ascending: false })
      .limit(1000),
  ]);

  const repliesByContactedId = new Map<string, any>();
  const repliesByLeadId = new Map<string, any>();
  for (const row of responses || []) {
    if (row.contacted_id && !repliesByContactedId.has(row.contacted_id)) repliesByContactedId.set(row.contacted_id, row);
    if (row.lead_id && !repliesByLeadId.has(row.lead_id)) repliesByLeadId.set(row.lead_id, row);
  }

  let updated = 0;
  for (const row of contacted || []) {
    if (row.replied_at || row.status === 'replied') continue;
    const match = repliesByContactedId.get(row.id) || (row.lead_id ? repliesByLeadId.get(row.lead_id) : null);
    if (!match) continue;

    const repliedAt = match.created_at || new Date().toISOString();
    await admin
      .from('contacted_leads')
      .update({
        status: 'replied',
        replied_at: repliedAt,
        last_event_type: 'reply',
        last_event_at: repliedAt,
        lifecycle_state: deriveLifecycleState(row.lifecycle_state || row.status, 'reply'),
        last_update_at: new Date().toISOString(),
      } as any)
      .eq('id', row.id);

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

  return NextResponse.json({ ok: true, organizationId, scanned: (contacted || []).length, updated });
}
