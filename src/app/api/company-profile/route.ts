import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { canEditCompanyProfile, CompanyProfileError, companyProfileSuggestions, readCompanyProfile, saveCompanyProfile } from '@/lib/server/company-profile';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const failure = (error: unknown) => {
  if (error instanceof CompanyProfileError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'La ficha no se pudo leer. Recarga e intenta de nuevo.' }, { status: 400, headers });
  return handleAuthError(error);
};

/**
 * «Ficha de la empresa» (APP-06) of the active organization: every member reads it; an owner or an admin also learns that
 * they may edit it and, with ?suggestions=1, what the team already wrote about the offer.
 */
export async function GET(request: Request) {
  try {
    const { user, organizationId } = await requireAuth(request);
    const admin = getSupabaseAdminClient();
    const scope = { organizationId, userId: user.id };
    const [profile, canEdit] = await Promise.all([readCompanyProfile(admin, organizationId), canEditCompanyProfile(admin, scope)]);
    const suggestions = canEdit && new URL(request.url).searchParams.get('suggestions') === '1' ? await companyProfileSuggestions(admin, organizationId) : undefined;
    return NextResponse.json({ profile, canEdit, ...(suggestions ? { suggestions } : {}) }, { headers });
  } catch (error) {
    return failure(error);
  }
}

/** Saving is reviewing: an owner or an admin, against the revision the page showed. */
export async function PUT(request: Request) {
  try {
    const { user, organizationId } = await requireAuth(request);
    const saved = await saveCompanyProfile(getSupabaseAdminClient(), { organizationId, userId: user.id }, await request.json());
    return NextResponse.json(saved, { headers });
  } catch (error) {
    return failure(error);
  }
}
