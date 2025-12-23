import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
    try {
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
        const person = body?.person || body; // Apollo sometimes wraps in 'person'

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
