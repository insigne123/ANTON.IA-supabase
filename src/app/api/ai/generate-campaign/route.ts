import { NextRequest, NextResponse } from 'next/server';
import { generateCampaignFlow } from '@/ai/flows/generate-campaign';
import { requestAuthErrorResponse, requireSessionOrTrustedInternalRequest } from '@/lib/server/request-auth';

export async function POST(req: NextRequest) {
    try {
        await requireSessionOrTrustedInternalRequest(req);

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
        const authResponse = requestAuthErrorResponse(e);
        if (authResponse) return authResponse;
        console.error('Error generating campaign:', e);
        return NextResponse.json({ error: e?.message || 'AI error' }, { status: 500 });
    }
}
