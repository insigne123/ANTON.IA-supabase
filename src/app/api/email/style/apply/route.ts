import { NextResponse } from 'next/server';
import { applyStyleToDraft } from '@/ai/flows/apply-style-to-draft';
import { requestAuthErrorResponse, requireSessionRequestAuth } from '@/lib/server/request-auth';

export async function POST(req: Request) {
  try {
    await requireSessionRequestAuth();
    const body = await req.json();

    if (!body?.baseSubject && !body?.baseBody) {
      return NextResponse.json({ error: 'Missing base draft' }, { status: 400 });
    }

    if (!body?.styleProfile) {
      return NextResponse.json({ error: 'Missing style profile' }, { status: 400 });
    }

    const draft = await applyStyleToDraft({
      mode: body.mode === 'opportunities' ? 'opportunities' : 'leads',
      baseSubject: String(body.baseSubject || ''),
      baseBody: String(body.baseBody || ''),
      styleProfile: body.styleProfile,
      lead: body.lead,
      report: body.report,
      companyProfile: body.companyProfile,
    });

    return NextResponse.json(draft);
  } catch (e: any) {
    const authResponse = requestAuthErrorResponse(e);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}
