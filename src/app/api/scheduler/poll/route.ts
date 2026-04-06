import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const supabase = createRouteHandlerClient({ cookies });

    // Security: In a real app, validate an API Key from headers.
    // For this prototype, we'll assume the extension runs in a context where it can hit this public-ish API
    // or (better) the user is logged in the browser sharing the cookie?
    // Chrome extensions don't share cookies automatically with fetch unless specified.
    // We will assume "Open access" for this specific internal tool or require a header 'X-Extension-Secret' if we had one.
    // For now, let's just query.

    const now = new Date().toISOString();

    // Find tasks scheduled for LinkedIn that are due and not yet sent
    const { data, error } = await supabase
        .from('contacted_leads')
        .select('*')
        .eq('status', 'scheduled')
        .eq('provider', 'linkedin')
        .lte('scheduled_at', now)
        .limit(5); // Process in batches of 5 to avoid rate limits

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ tasks: data });
}
