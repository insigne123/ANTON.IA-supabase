import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { tokenService } from '@/lib/services/token-service';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { sendGmail, sendOutlook } from '@/lib/server-email-sender';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        // 1. Init Supabase Admin
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseServiceKey) {
            return NextResponse.json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { persistSession: false },
        });

        // 2. Get all users with tokens
        const { data: tokens } = await supabase.from('provider_tokens').select('*');
        if (!tokens || tokens.length === 0) {
            return NextResponse.json({ message: 'No tokens found' });
        }

        const results = [];

        // 3. Process each user
        const users = [...new Set(tokens.map(t => t.user_id))];

        for (const userId of users) {
            // Get user's active campaigns
            const { data: campaigns } = await supabase
                .from('campaigns')
                .select('*')
                .eq('user_id', userId)
                .eq('status', 'ACTIVE');

            if (!campaigns || campaigns.length === 0) continue;

            // Get user's contacted leads
            const { data: leads } = await supabase
                .from('contacted_leads')
                .select('*')
                .eq('user_id', userId);

            if (!leads || leads.length === 0) continue;

            // Process campaigns
            for (const campaign of campaigns) {
                // Parse steps (handle legacy array vs object)
                let steps = [];
                let excluded: string[] = [];
                let sentRecords: Record<string, any> = {};

                if (Array.isArray(campaign.steps)) {
                    steps = campaign.steps;
                } else {
                    steps = campaign.steps.steps || [];
                    excluded = campaign.steps.excludedLeadIds || [];
                    sentRecords = campaign.steps.sentRecords || {};
                }

                if (!steps.length) continue;

                // Check eligibility
                for (const lead of leads) {
                    // Skip if excluded or replied
                    if (excluded.includes(lead.lead_id)) continue;
                    if (lead.status === 'replied') continue;

                    // Determine next step
                    const record = sentRecords[lead.lead_id];
                    let nextStepIdx = 0;
                    if (record) {
                        nextStepIdx = record.lastStepIdx + 1;
                    }

                    if (nextStepIdx >= steps.length) continue; // Finished

                    const step = steps[nextStepIdx];
                    const offsetDays = step.offsetDays || 0;

                    // Check timing
                    const lastAtStr = lead.last_follow_up_at || lead.sent_at;
                    if (!lastAtStr) continue;

                    const lastAt = new Date(lastAtStr);
                    const now = new Date();
                    const diffTime = Math.abs(now.getTime() - lastAt.getTime());
                    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

                    if (diffDays < offsetDays) continue;

                    // ELIGIBLE! Send email.

                    // Get provider token
                    // contacted_leads.provider can be 'gmail'|'outlook' (UI) or legacy 'google'|'outlook'
                    const leadProvider = lead.provider;
                    const tokenProvider = leadProvider === 'gmail' ? 'google' : leadProvider;

                    if (tokenProvider !== 'google' && tokenProvider !== 'outlook') {
                        console.log(`Unsupported provider for follow-up: ${leadProvider}`);
                        continue;
                    }

                    const userToken = tokens.find(t => t.user_id === userId && t.provider === tokenProvider);

                    if (!userToken) {
                        console.log(`No token for user ${userId} provider ${tokenProvider}`);
                        continue;
                    }

                    // Refresh token
                    let accessToken = '';
                    try {
                        if (tokenProvider === 'google') {
                            const refreshed = await refreshGoogleToken(userToken.refresh_token, process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!);
                            accessToken = refreshed.access_token;
                        } else if (tokenProvider === 'outlook') {
                            const refreshed = await refreshMicrosoftToken(userToken.refresh_token, process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!, process.env.AZURE_AD_CLIENT_SECRET!, process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID!);
                            accessToken = refreshed.access_token;
                            if (refreshed.refresh_token) {
                                await tokenService.saveToken(supabase, 'outlook', refreshed.refresh_token);
                            }
                        }
                    } catch (e) {
                        console.error(`Failed to refresh token for user ${userId}:`, e);
                        continue;
                    }

                    // Send Email
                    try {
                        // REWRITE LINKS & INJECT PIXEL
                        const trackingId = lead.id;
                        const origin = req.nextUrl.origin;

                        // Render template (simple replacement)
                        let subject = step.subject.replace('{{lead.name}}', lead.name || '').replace('{{company}}', lead.company || '');
                        let body = step.bodyHtml.replace('{{lead.name}}', lead.name || '').replace('{{company}}', lead.company || '');

                        // 1. Rewrite Links
                        body = body.replace(/href=(["'])(http[^"']+)\1/gi, (match: string, quote: string, url: string) => {
                            if (url.includes('/api/tracking/click')) return match;
                            const trackingUrl = `${origin}/api/tracking/click?id=${trackingId}&url=${encodeURIComponent(url)}`;
                            return `href=${quote}${trackingUrl}${quote}`;
                        });

                        // 3. Inject Pixel
                        if (step.usePixel) {
                            let pixelUrl = `${origin}/api/tracking/open?id=${trackingId}`;
                            // Fallback to default placeholder logo for automated campaigns since we don't have access to localStorage
                            // and organization logo is not yet in DB schema.
                            const defaultLogo = `${origin}/logo-placeholder.svg`;
                            pixelUrl += `&redirect=${encodeURIComponent(defaultLogo)}`;

                            // Remove display:none
                            const trackingPixel = `<img src="${pixelUrl}" alt="" width="1" height="1" style="width:1px;height:1px;border:0;" />`;
                            body += `\n<br>${trackingPixel}`;
                        }              // Use 'body' (the modified one) instead of raw template
                        if (tokenProvider === 'google') {
                            await sendGmail(accessToken, lead.email, subject, body);
                        } else {
                            await sendOutlook(accessToken, lead.email, subject, body);
                        }

                        // Update records
                        sentRecords[lead.lead_id] = { lastStepIdx: nextStepIdx, lastSentAt: new Date().toISOString() };

                        // Update campaign
                        const newStepsJson = Array.isArray(campaign.steps) ? { steps: campaign.steps, sentRecords, excludedLeadIds: excluded } : { ...campaign.steps, sentRecords };

                        await supabase.from('campaigns').update({ steps: newStepsJson }).eq('id', campaign.id);

                        // Update lead
                        await supabase.from('contacted_leads').update({
                            last_follow_up_at: new Date().toISOString(),
                            last_step_idx: nextStepIdx,
                            follow_up_count: (lead.follow_up_count || 0) + 1
                        }).eq('id', lead.id);

                        results.push({ lead: lead.email, status: 'sent' });

                    } catch (e) {
                        console.error(`Failed to send to ${lead.email}:`, e);
                        results.push({ lead: lead.email, status: 'failed', error: e });
                    }
                }
            }
        }

        return NextResponse.json({ processed: results.length, results });

    } catch (e: any) {
        console.error('Cron error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
