import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { matchesConfiguredSecret } from '@/lib/server/internal-api-auth';

function isAuthorizedApolloWebhook(req: NextRequest) {
    const expectedSecret = String(process.env.APOLLO_WEBHOOK_SECRET || '').trim();
    if (!expectedSecret) return false;

    const url = new URL(req.url);
    const providedSecret =
        req.headers.get('x-webhook-secret') ||
        req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
        url.searchParams.get('webhook_secret');

    return matchesConfiguredSecret(expectedSecret, providedSecret);
}

function extractApolloPerson(body: any) {
    if (!body || typeof body !== 'object') return null;
    if (body.person && typeof body.person === 'object') return body.person;
    if (Array.isArray(body.people) && body.people[0] && typeof body.people[0] === 'object') return body.people[0];
    return body;
}

export async function POST(req: NextRequest) {
    try {
        if (!String(process.env.APOLLO_WEBHOOK_SECRET || '').trim()) {
            return NextResponse.json({ error: 'APOLLO_WEBHOOK_SECRET_NOT_CONFIGURED' }, { status: 503 });
        }

        if (!isAuthorizedApolloWebhook(req)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Service Role Client to bypass RLS for webhook updates
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const url = new URL(req.url);
        const enrichedLeadId = url.searchParams.get('enriched_lead_id');

        if (!enrichedLeadId) {
            return NextResponse.json({ error: 'Missing enriched_lead_id param' }, { status: 400 });
        }

        const body = await req.json();
        const person = extractApolloPerson(body);

        if (!person) {
            console.warn('[webhook-apollo] No person data found in body');
            return NextResponse.json({ message: 'No data' }, { status: 200 });
        }

        const phoneNumbers = person.phone_numbers;
        let primaryPhone: string | undefined = undefined;

        if (Array.isArray(phoneNumbers)) {
            // Simple Primary Logic: Mobile > Direct > Corporate > Other
            const found = phoneNumbers.find((n: any) => n.type === 'mobile')
                || phoneNumbers.find((n: any) => n.type === 'direct_dial')
                || phoneNumbers[0];
            primaryPhone = found?.sanitized_number;
        }

        console.log(`[webhook-apollo] Received update for ${enrichedLeadId}: ${phoneNumbers?.length || 0} phones`);

        if (phoneNumbers || primaryPhone) {
            const { error } = await supabase
                .from('enriched_leads')
                .update({
                    phone_numbers: phoneNumbers,
                    primary_phone: primaryPhone
                    // We could also update email or other fields if we wanted
                })
                .eq('id', enrichedLeadId);

            if (error) {
                console.error('[webhook-apollo] DB Update Error:', error);
                return NextResponse.json({ error: error.message }, { status: 500 });
            }
        }

        return NextResponse.json({ success: true }, { status: 200 });
    } catch (e: any) {
        console.error('[webhook-apollo] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
