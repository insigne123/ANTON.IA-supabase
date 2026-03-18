import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await context.params;
  return NextResponse.json(
    {
      error: 'LEAD_RESEARCH_POLLING_UNSUPPORTED',
      message: 'El flujo n8n devuelve la investigacion en la respuesta inicial y no soporta polling por report_id.',
      report_id: reportId,
      provider: 'n8n',
      status: 'completed',
    },
    { status: 410 },
  );
}
