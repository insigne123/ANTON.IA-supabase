import { NextRequest, NextResponse } from 'next/server';
import { enhanceCompanyReport } from '@/ai/flows/enhance-company-report';


export async function POST(req: NextRequest) {
  try {
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
    return NextResponse.json({ error: e?.message || 'AI error' }, { status: 500 });
  }
}
