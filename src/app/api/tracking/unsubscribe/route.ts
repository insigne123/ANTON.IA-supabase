import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyUnsubscribeSignature } from "@/lib/unsubscribe-helpers";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get("email");
    const userId = searchParams.get("u");
    const orgId = searchParams.get("o"); // optional
    const sig = searchParams.get("sig");

    if (!email || !userId || !sig) {
        return new NextResponse("Invalid request", { status: 400 });
    }

    if (!verifyUnsubscribeSignature(email, userId, orgId, sig)) {
        return new NextResponse("Invalid signature or link expired", { status: 403 });
    }

    // Initialize Admin Supabase Client
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Insert into blacklist
    // We try to carry over the 'reason' if we had one, but here it's just 'User clicked unsubscribe'
    const payload: any = {
        email,
        user_id: userId,
        reason: 'User clicked unsubscribe link'
    };
    if (orgId) payload.organization_id = orgId;

    const { error } = await supabaseAdmin
        .from('unsubscribed_emails')
        .insert(payload);

    if (error) {
        // Simple error handling: duplicate key means already unsubscribed, which is fine
        if (error.code !== '23505') {
            console.error('Unsubscribe API Error:', error);
            return new NextResponse("Server Error", { status: 500 });
        }
    }

    // Return friendly HTML
    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Suscripción Cancelada</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f9fafb; color: #111827; }
            .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 90%; }
            h1 { font-size: 1.5rem; margin-bottom: 1rem; color: #10b981; }
            p { color: #6b7280; line-height: 1.5; }
            .email { font-weight: 600; color: #374151; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>✔ Suscripción Cancelada</h1>
            <p>La dirección <span class="email">${email}</span> ha sido eliminada de nuestra lista de envíos.</p>
            <p>No recibirás más correos de este remitente.</p>
        </div>
    </body>
    </html>
    `;

    return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } });
}
