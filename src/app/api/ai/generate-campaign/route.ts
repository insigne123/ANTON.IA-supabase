import { NextRequest, NextResponse } from 'next/server';
import { generateCampaignFlow } from '@/ai/flows/generate-campaign';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';

export async function POST(req: NextRequest) {
    try {
        await requireAuth();

        const {
            goal,
            companyName,
            targetAudience,
            language,
            campaignType,
            offerName,
            offerSummary,
            offerBenefits,
            cta,
            tone,
            jobTitle,
            industry,
            missionTitle,
            campaignContext,
            userName,
        } = await req.json();

        const out = await generateCampaignFlow({
            goal,
            companyName,
            targetAudience,
            language,
            campaignType,
            offerName,
            offerSummary,
            offerBenefits,
            cta,
            tone,
            jobTitle,
            industry,
            missionTitle,
            campaignContext,
            userName,
        });

        return NextResponse.json(out);
    } catch (e: any) {
        if (e?.name === 'AuthError') return handleAuthError(e);
        console.error('Error generating campaign:', e);
        return NextResponse.json({ error: e?.message || 'AI error' }, { status: 500 });
    }
}
