import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ contactedId: string }> }) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { contactedId } = await params;
  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id);

  const organizationIds = (membership || []).map((m: any) => m.organization_id).filter(Boolean);
  if (organizationIds.length === 0) return NextResponse.json({ events: [] });

  const { data, error } = await supabase
    .from('email_events')
    .select('id, event_type, event_source, event_at, thread_key, message_id, internet_message_id, meta')
    .eq('contacted_id', contactedId)
    .in('organization_id', organizationIds)
    .order('event_at', { ascending: false })
    .limit(50);

  if (error) {
    const message = String(error.message || '').toLowerCase();
    if (message.includes('email_events') || message.includes('does not exist')) {
      return NextResponse.json({ events: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ events: data || [] });
}
