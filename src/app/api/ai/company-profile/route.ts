import { NextRequest, NextResponse } from 'next/server';
import { generateCompanyProfile } from '@/ai/flows/generate-company-profile';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
    const input = await req.json();
    const output = await generateCompanyProfile(input);
    return NextResponse.json(output);
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    if (error?.name === 'ZodError' || error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Nombre de empresa o sitio web no valido.' }, { status: 400 });
    }
    console.error('AI company profile generation error:', error);
    return NextResponse.json({ error: 'No fue posible generar el perfil de empresa.' }, { status: 500 });
  }
}
