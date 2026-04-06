import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

import { isPrivacyAdminEmail } from '@/lib/server/privacy-admin';
import { applyPrivacyBlock, deletePrivacySubjectData, lookupPrivacySubjectData, normalizePrivacyEmail, recordPrivacyRequestAction, suspendPrivacyPlatformUsers } from '@/lib/server/privacy-subject-data';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
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
    const action = String(body?.action || '').trim().toLowerCase();
    const email = normalizePrivacyEmail(body?.email || '');
    const requestId = String(body?.requestId || '').trim() || null;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Ingresa un correo valido.' }, { status: 400 });
    }

    if (action === 'export') {
      const data = await lookupPrivacySubjectData(email);
      await recordPrivacyRequestAction({
        requestId,
        actorEmail: user.email || null,
        actionType: 'export',
        summary: { email, summary: data.summary },
      });
      return NextResponse.json({ success: true, data });
    }

    if (action === 'block') {
      const result = await applyPrivacyBlock(email, {
        reason: String(body?.reason || '').trim() || 'privacy_request_block',
        requestId,
        actorEmail: user.email || null,
      });
      return NextResponse.json({ success: true, result });
    }

    if (action === 'delete') {
      const result = await deletePrivacySubjectData(email, {
        reason: String(body?.reason || '').trim() || 'privacy_request_delete_preserve_block',
        requestId,
        actorEmail: user.email || null,
      });
      return NextResponse.json({ success: true, result });
    }

    if (action === 'suspend_account') {
      const result = await suspendPrivacyPlatformUsers(email, {
        requestId,
        actorEmail: user.email || null,
      });
      return NextResponse.json({ success: true, result });
    }

    return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
  } catch (error: any) {
    console.error('[privacy-subject-actions] unexpected error', error);
    return NextResponse.json({ error: 'No se pudo ejecutar la accion de privacidad.' }, { status: 500 });
  }
}
