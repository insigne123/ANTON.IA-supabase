import { NextRequest, NextResponse } from 'next/server';
import { generateCompanyProfile } from '@/ai/flows/generate-company-profile';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { websiteFromWorkEmail } from '@/lib/profile/profile-mappings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 90;

/** «Completar con IA» in «Perfil». Without a website, the work email's domain is the first guess (ana@grupoexpro.com →
 * grupoexpro.com); personal mailboxes never are. Nothing is saved here: the person reviews each field first. */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await req.json();
    const companyName = typeof body?.companyName === 'string' ? body.companyName.trim() : '';
    const typedWebsite = typeof body?.website === 'string' ? body.website.trim() : '';
    const emailWebsite = typedWebsite ? '' : websiteFromWorkEmail(auth.user?.email);
    const website = typedWebsite || emailWebsite;
    if (!website && companyName.length < 2) {
      return NextResponse.json({ error: 'Escribe el sitio web o el nombre de tu empresa.' }, { status: 400 });
    }
    const output = await generateCompanyProfile({
      companyName: companyName || undefined,
      website: website || undefined,
      country: typeof body?.country === 'string' ? body.country : undefined,
      organizationId: auth.organizationId,
    });
    return NextResponse.json({ ...output, websiteFrom: typedWebsite ? 'input' : emailWebsite ? 'email' : output.domain ? 'search' : null });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    if (error?.name === 'ZodError' || error instanceof SyntaxError) {
      return NextResponse.json({ error: 'El sitio web o el nombre de la empresa no son válidos.' }, { status: 400 });
    }
    console.error('AI company profile generation error:', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    return NextResponse.json({ error: 'No pudimos leer tu empresa ahora. Inténtalo de nuevo en un minuto.' }, { status: 500 });
  }
}
