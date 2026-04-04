import { NextRequest, NextResponse } from 'next/server';
import { generateOutreachFromReport } from '@/ai/flows/generate-outreach-from-report';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { report, companyProfile, lead, mode } = await req.json();
    const out = await generateOutreachFromReport({ report, companyProfile, lead, mode: mode || 'services' });
    return NextResponse.json(out);
  } catch (e: any) {
    console.error('AI outreach generation error:', e);
    return NextResponse.json({ error: e?.message || 'AI error' }, { status: 500 });
  }
}
