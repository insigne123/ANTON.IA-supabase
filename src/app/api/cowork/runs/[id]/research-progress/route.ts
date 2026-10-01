import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { readCoworkResearchProgress } from '@/lib/server/cowork/research-notice';
import { coworkResearchFinished, coworkResearchProgressLabel } from '@/lib/cowork/research-notice';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

/** The research of this conversation and how it goes, for the live card. Read only. */
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    const id = z.string().uuid().parse((await context.params).id);
    const items = await readCoworkResearchProgress(getSupabaseAdminClient(), { userId: auth.user.id, organizationId: auth.organizationId }, id);
    return NextResponse.json({ items, label: coworkResearchProgressLabel(items.map(item => item.status)),
      active: items.some(item => !coworkResearchFinished(item.status)) }, { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No se pudo leer el avance de las investigaciones.' }, { status: error instanceof z.ZodError ? 400 : 503, headers });
  }
}
