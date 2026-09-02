import { NextRequest, NextResponse } from 'next/server';

import {
  requestAuthErrorResponse,
  requireSessionOrTrustedInternalRequest,
} from '@/lib/server/request-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    let ctx: Awaited<ReturnType<typeof requireSessionOrTrustedInternalRequest>>;
    try {
      ctx = await requireSessionOrTrustedInternalRequest(req);
    } catch (error) {
      const response = requestAuthErrorResponse(error);
      if (response) return response;
      throw error;
    }

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
      .select('id, linkedin_url, email, email_status, primary_phone, phone_numbers, enrichment_status, updated_at')
      .in('id', ids)
      .eq('organization_id', ctx.organizationId)
      .eq('user_id', ctx.user.id);

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
