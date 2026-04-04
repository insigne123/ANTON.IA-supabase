import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

async function resolveUserId(req: NextRequest) {
  const userIdFromHeader = req.headers.get('x-user-id')?.trim() || '';
  if (userIdFromHeader) {
    if (!isTrustedInternalRequest(req)) {
      return { error: NextResponse.json({ error: 'UNAUTHORIZED_INTERNAL_REQUEST' }, { status: 401 }) };
    }
    return { userId: userIdFromHeader };
  }

  const supabase = createRouteHandlerClient({ cookies: (() => req.cookies) as any });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) {
    return { error: NextResponse.json({ error: 'UNAUTHORIZED', message: 'User must be logged in' }, { status: 401 }) };
  }

  return { userId: user.id };
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveUserId(req);
    if ('error' in ctx) return ctx.error;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
    }

    const ids = Array.isArray(body?.ids)
      ? body.ids.map((value: unknown) => String(value || '').trim()).filter(Boolean).slice(0, 20)
      : [];

    if (ids.length === 0) {
      return NextResponse.json({ error: 'MISSING_IDS' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    const { data, error } = await admin
      .from('people_search_leads')
      .select('id, linkedin_url, primary_phone, phone_numbers, enrichment_status, updated_at, organization_id')
      .in('id', ids);

    if (error) {
      console.error('[profile-status] query error:', error);
      return NextResponse.json({ error: 'PROFILE_STATUS_QUERY_ERROR', message: error.message }, { status: 500 });
    }

    return NextResponse.json(
      {
        items: Array.isArray(data) ? data : [],
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error: any) {
    console.error('[profile-status] unexpected error:', error);
    return NextResponse.json({ error: 'PROFILE_STATUS_ERROR', message: error?.message || 'Unknown error' }, { status: 500 });
  }
}
