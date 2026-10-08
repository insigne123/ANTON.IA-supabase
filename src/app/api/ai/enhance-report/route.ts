import { NextRequest, NextResponse } from 'next/server';
import { enhanceCompanyReport } from '@/ai/flows/enhance-company-report';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { aiErrorForPerson, aiFailureStatus } from '@/lib/ai-failure-message';


export async function POST(req: NextRequest) {
  try {
    await requireAuth();

    const { rawReport, normalizedReport, companyProfile, lead } = await req.json();

    // Llama al flow de Genkit para producir JSON bien estructurado (EnhancedReport)
    const out = await enhanceCompanyReport({
      report: normalizedReport || rawReport,
      companyProfile,
      lead,
      myCompany: { name: 'ANTON.IA', description: 'AI Agent' }, // Dummy data to satisfy schema
    });

    return NextResponse.json(out);
  } catch (e: any) {
    if (e?.name === 'AuthError') return handleAuthError(e);
    return NextResponse.json({ error: aiErrorForPerson(e, 'No se pudo mejorar el informe con IA. Reintenta en un momento.') }, { status: aiFailureStatus(e) });
  }
}
