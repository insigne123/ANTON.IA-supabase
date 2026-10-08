import { NextRequest, NextResponse } from 'next/server';
import { generateOutreachFromReport } from '@/ai/flows/generate-outreach-from-report';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { aiErrorForPerson, aiFailureStatus } from '@/lib/ai-failure-message';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    await requireAuth();

    const { report, companyProfile, lead, mode } = await req.json();
    const out = await generateOutreachFromReport({ report, companyProfile, lead, mode: mode || 'services' });
    return NextResponse.json(out);
  } catch (e: any) {
    if (e?.name === 'AuthError') return handleAuthError(e);
    console.error('AI outreach generation error:', e);
    return NextResponse.json({ error: aiErrorForPerson(e, 'No se pudo generar el correo con IA. Reintenta en un momento.') }, { status: aiFailureStatus(e) });
  }
}
