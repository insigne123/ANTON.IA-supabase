import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { NextRequest, NextResponse } from 'next/server';

import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveUserId(request: NextRequest) {
  const headerUserId = request.headers.get('x-user-id')?.trim() || '';
  if (headerUserId) {
    return isTrustedInternalRequest(request) ? headerUserId : null;
  }

  const supabase = createRouteHandlerClient({ cookies: (() => request.cookies) as any });
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id || null;
}

export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body?.ids)
      ? [...new Set(body.ids.map((value: unknown) => String(value || '').trim()).filter((value: string) => UUID_RE.test(value)))].slice(0, 50)
      : [];
    if (ids.length === 0) {
      return NextResponse.json({ checked: 0, updated: 0, completedWithoutPhone: 0, stillPending: 0, updatedIds: [] });
    }

    const admin = getSupabaseAdminClient();
    const { data: memberships, error: membershipError } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId);
    if (membershipError) throw membershipError;

    const organizationIds = (memberships || [])
      .map((row: { organization_id?: string | null }) => String(row.organization_id || '').trim())
      .filter(Boolean);
    let query = admin
      .from('enriched_leads')
      .select('id, enrichment_status')
      .in('id', ids);
    query = organizationIds.length > 0
      ? query.or(`user_id.eq.${userId},organization_id.in.(${organizationIds.join(',')})`)
      : query.eq('user_id', userId);

    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];
    const completed = rows.filter((row: { enrichment_status?: string | null }) => {
      const status = String(row.enrichment_status || '').trim().toLowerCase();
      return Boolean(status) && !status.startsWith('pending');
    });

    return NextResponse.json({
      checked: rows.length,
      updated: completed.length,
      completedWithoutPhone: 0,
      stillPending: rows.length - completed.length,
      updatedIds: completed.map((row: { id: string }) => row.id),
    });
  } catch (error) {
    console.error('[enriched-leads/phone-sync] status check failed', error);
    return NextResponse.json({ error: 'ENRICHMENT_STATUS_CHECK_FAILED' }, { status: 500 });
  }
}
