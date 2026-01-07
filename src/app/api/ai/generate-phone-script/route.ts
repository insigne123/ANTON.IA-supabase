
import { NextRequest, NextResponse } from 'next/server';
import { generatePhoneScript } from '@/ai/flows/generate-phone-script';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { report, companyProfile, lead } = body;

        // Validar que existan los campos requeridos
        if (!report || !companyProfile || !lead) {
            return NextResponse.json(
                { error: 'Faltan campos requeridos: report, companyProfile, lead' },
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

        // Validar que el reporte tenga datos mínimos para generar un guion útil
        const hasCrossData = report.cross && (
            report.cross.pains?.length > 0 ||
            report.cross.company?.name ||
            report.cross.leadContext
        );

        const hasBasicData = report.company?.name || report.company?.industry;

        if (!hasCrossData && !hasBasicData) {
            return NextResponse.json(
                { error: 'El reporte no tiene suficiente información. Se requiere al menos datos de la empresa o pains detectados.' },
                { status: 400 }
            );
        }

        // Generar el script
        const out = await generatePhoneScript({ report, companyProfile, lead });
        return NextResponse.json(out);
    } catch (e: any) {
        console.error('AI phone script generation error:', e);
        return NextResponse.json({ error: e?.message || 'Error al generar el guion con IA' }, { status: 500 });
    }
}
