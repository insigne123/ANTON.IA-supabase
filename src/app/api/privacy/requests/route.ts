import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { validatePrivacyRequestPayload } from '@/lib/privacy-request';
import { isPrivacyAdminEmail } from '@/lib/server/privacy-admin';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
const allowedStatuses = new Set(['submitted', 'in_review', 'resolved', 'rejected']);

function getIpAddress(req: NextRequest) {
  const forwardedFor = String(req.headers.get('x-forwarded-for') || '').trim();
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  return String(req.headers.get('x-real-ip') || '').trim() || null;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isPrivacyAdminEmail(user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const status = String(req.nextUrl.searchParams.get('status') || '').trim().toLowerCase();
    const limitParam = Number(req.nextUrl.searchParams.get('limit') || 100);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 100;
    const admin = getSupabaseAdminClient();

    let query = admin
      .from('privacy_requests')
      .select('id, request_type, status, requester_name, requester_email, requester_company, relation_to_data, target_email, details, submitted_at, resolved_at, reviewed_by_email, last_action_type, last_action_at, last_action_summary, metadata')
      .order('submitted_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[privacy-request] list failed', error);
      return NextResponse.json({ error: 'No se pudieron obtener las solicitudes.' }, { status: 500 });
    }

    return NextResponse.json({ requests: data || [] });
  } catch (error: any) {
    console.error('[privacy-request] list unexpected error', error);
    return NextResponse.json({ error: 'No se pudieron obtener las solicitudes.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const validation = validatePrivacyRequestPayload(await req.json());
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Privacy request service is not configured.' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const payload = validation.value;
    const insertPayload = {
      request_type: payload.requestType,
      requester_name: payload.requesterName,
      requester_email: payload.requesterEmail,
      requester_company: payload.requesterCompany || null,
      relation_to_data: payload.relationToData || null,
      target_email: payload.targetEmail || null,
      details: payload.details,
      metadata: {
        userAgent: req.headers.get('user-agent') || null,
        ipAddress: getIpAddress(req),
        referer: req.headers.get('referer') || null,
      },
    };

    const { data, error } = await supabaseAdmin
      .from('privacy_requests')
      .insert(insertPayload)
      .select('id, submitted_at')
      .single();

    if (error) {
      console.error('[privacy-request] insert failed', error);
      return NextResponse.json({ error: 'No se pudo registrar la solicitud.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      requestId: data?.id || null,
      submittedAt: data?.submitted_at || null,
    });
  } catch (error: any) {
    console.error('[privacy-request] unexpected error', error);
    return NextResponse.json({ error: 'No se pudo procesar la solicitud.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isPrivacyAdminEmail(user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const requestId = String(body?.id || '').trim();
    const nextStatus = String(body?.status || '').trim().toLowerCase();

    if (!requestId || !allowedStatuses.has(nextStatus)) {
      return NextResponse.json({ error: 'Invalid update payload.' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const updatePayload: Record<string, unknown> = {
      status: nextStatus,
      updated_at: new Date().toISOString(),
      reviewed_by_email: user.email || null,
    };

    if (nextStatus === 'resolved') {
      updatePayload.resolved_at = new Date().toISOString();
    }

    const { data, error } = await admin
      .from('privacy_requests')
      .update(updatePayload)
      .eq('id', requestId)
      .select('id, status, resolved_at, reviewed_by_email')
      .single();

    if (error) {
      console.error('[privacy-request] update failed', error);
      return NextResponse.json({ error: 'No se pudo actualizar la solicitud.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, request: data });
  } catch (error: any) {
    console.error('[privacy-request] update unexpected error', error);
    return NextResponse.json({ error: 'No se pudo actualizar la solicitud.' }, { status: 500 });
  }
}
