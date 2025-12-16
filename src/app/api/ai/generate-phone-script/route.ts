
import { NextRequest, NextResponse } from 'next/server';
import { generatePhoneScript } from '@/ai/flows/generate-phone-script';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    try {
        const { report, companyProfile, lead } = await req.json();
        const out = await generatePhoneScript({ report, companyProfile, lead });
        return NextResponse.json(out);
    } catch (e: any) {
        console.error('AI phone script generation error:', e);
        return NextResponse.json({ error: e?.message || 'AI error' }, { status: 500 });
    }
}
