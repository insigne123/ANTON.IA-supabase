
import { NextRequest, NextResponse } from 'next/server';
import { generatePhoneScript } from '@/ai/flows/generate-phone-script';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { aiErrorForPerson, aiFailureStatus } from '@/lib/ai-failure-message';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    try {
        await requireAuth();

        const body = await req.json();
        const { report, companyProfile, lead } = body;

        // Validar que existan los campos requeridos
        // NOTE: `report` puede ser vacío si aún no se investigó. En ese caso, generamos un guion más general.
        if (!companyProfile || !lead) {
            return NextResponse.json(
                { error: 'Faltan campos requeridos: companyProfile, lead' },
                { status: 400 }
            );
        }

        // Validar que el lead tenga datos mínimos
        if (!lead.fullName) {
            return NextResponse.json(
                { error: 'El lead debe tener al menos un nombre (fullName)' },
                { status: 400 }
            );
        }

        // Generar el script
        const out = await generatePhoneScript({ report: report || {}, companyProfile, lead });
        return NextResponse.json(out);
    } catch (e: any) {
        if (e?.name === 'AuthError') return handleAuthError(e);
        console.error('AI phone script generation error:', e);
        // The provider's raw error («OPENAI_HTTP_429:{…}») used to reach the toast as is.
        return NextResponse.json({ error: aiErrorForPerson(e, 'No se pudo generar el guion con IA. Reintenta en un momento.') }, { status: aiFailureStatus(e) });
    }
}
