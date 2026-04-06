import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

import { isPrivacyAdminEmail } from '@/lib/server/privacy-admin';
import { lookupPrivacySubjectData } from '@/lib/server/privacy-subject-data';

export const dynamic = 'force-dynamic';

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

    const email = String(req.nextUrl.searchParams.get('email') || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Ingresa un correo valido.' }, { status: 400 });
    }

    return NextResponse.json(await lookupPrivacySubjectData(email));
  } catch (error: any) {
    console.error('[privacy-subject-lookup] unexpected error', error);
    return NextResponse.json({ error: 'No se pudo consultar la informacion del titular.' }, { status: 500 });
  }
}
