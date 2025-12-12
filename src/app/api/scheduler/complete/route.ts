import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const supabase = createRouteHandlerClient({ cookies });
    const body = await request.json();
    const { id, status, error: errorMsg } = body;

    if (!id || !status) {
        return NextResponse.json({ error: 'Missing id or status' }, { status: 400 });
    }

    const updateData: any = {
        status,
        last_update_at: new Date().toISOString()
    };

    if (status === 'sent') {
        updateData.sent_at = new Date().toISOString();
        updateData.linkedin_message_status = 'sent';
    }

    // If failed, maybe store error? Schema doesn't have 'error' column in contacted_leads, 
    // but we could set status='failed'.

    const { error } = await supabase
        .from('contacted_leads')
        .update(updateData)
        .eq('id', id);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
}
