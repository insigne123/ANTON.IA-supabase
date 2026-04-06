import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

import { validatePrivacyIncidentPayload } from '@/lib/privacy-incident';
import { isPrivacyAdminEmail } from '@/lib/server/privacy-admin';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';

async function requirePrivacyAdmin() {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (!isPrivacyAdminEmail(user.email)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { user };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePrivacyAdmin();
    if ('error' in auth) return auth.error;

    const status = String(req.nextUrl.searchParams.get('status') || '').trim().toLowerCase();
    const admin = getSupabaseAdminClient();
    let query = admin
      .from('privacy_incidents')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(100);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
      console.error('[privacy-incidents] list failed', error);
      return NextResponse.json({ error: 'No se pudieron obtener los incidentes.' }, { status: 500 });
    }

    return NextResponse.json({ incidents: data || [] });
  } catch (error: any) {
    console.error('[privacy-incidents] unexpected get error', error);
    return NextResponse.json({ error: 'No se pudieron obtener los incidentes.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePrivacyAdmin();
    if ('error' in auth) return auth.error;

    const validation = validatePrivacyIncidentPayload(await req.json());
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const payload = validation.value;
    const now = new Date().toISOString();
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('privacy_incidents')
      .insert({
        title: payload.title,
        summary: payload.summary,
        severity: payload.severity,
        status: payload.status,
        affected_scope: payload.affectedScope,
        data_types: payload.dataTypes,
        resolution_notes: payload.resolutionNotes,
        incident_at: now,
        detected_at: now,
        reported_by_email: auth.user.email || null,
      })
      .select('*')
      .single();

    if (error) {
      console.error('[privacy-incidents] insert failed', error);
      return NextResponse.json({ error: 'No se pudo registrar el incidente.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, incident: data });
  } catch (error: any) {
    console.error('[privacy-incidents] unexpected post error', error);
    return NextResponse.json({ error: 'No se pudo registrar el incidente.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePrivacyAdmin();
    if ('error' in auth) return auth.error;

    const body = await req.json().catch(() => ({}));
    const incidentId = String(body?.id || '').trim();
    const validation = validatePrivacyIncidentPayload(body || {});
    if (!incidentId) {
      return NextResponse.json({ error: 'ID de incidente invalido.' }, { status: 400 });
    }
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const payload = validation.value;
    const now = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      title: payload.title,
      summary: payload.summary,
      severity: payload.severity,
      status: payload.status,
      affected_scope: payload.affectedScope,
      data_types: payload.dataTypes,
      resolution_notes: payload.resolutionNotes,
      updated_at: now,
    };

    if (payload.status === 'contained') updatePayload.contained_at = now;
    if (payload.status === 'resolved') updatePayload.resolved_at = now;

    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('privacy_incidents')
      .update(updatePayload)
      .eq('id', incidentId)
      .select('*')
      .single();

    if (error) {
      console.error('[privacy-incidents] update failed', error);
      return NextResponse.json({ error: 'No se pudo actualizar el incidente.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, incident: data });
  } catch (error: any) {
    console.error('[privacy-incidents] unexpected patch error', error);
    return NextResponse.json({ error: 'No se pudo actualizar el incidente.' }, { status: 500 });
  }
}
