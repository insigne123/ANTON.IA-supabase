import { NextRequest, NextResponse } from 'next/server';
import { generateCampaignFlow } from '@/ai/flows/generate-campaign';

export async function POST(req: NextRequest) {
    try {
        const { goal, companyName, targetAudience, language } = await req.json();

        const out = await generateCampaignFlow({
            goal,
            companyName,
            targetAudience,
            language
        });

        return NextResponse.json(out);
    } catch (e: any) {
        console.error('Error generating campaign:', e);
        return NextResponse.json({ error: e?.message || 'AI error' }, { status: 500 });
    }
}
