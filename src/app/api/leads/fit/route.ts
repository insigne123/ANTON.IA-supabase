import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { LEAD_FIT_STAGES, LeadFitLeadSchema } from '@/lib/lead-fit/core';
import { assessLeadFit } from '@/lib/server/lead-fit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BodySchema = z.object({
  stage: z.enum(LEAD_FIT_STAGES),
  leads: z.array(LeadFitLeadSchema).max(50),
  /** false: only the kept estimates (a page that is just looking); true: estimate the people whose facts changed. */
  score: z.boolean().optional().default(true),
});

/**
 * «Probabilidad de calce» for a page of people (src/lib/lead-fit/core.ts): what is kept for each, and new estimates from
 * the AI (Haiku) for the ones whose facts or «Perfil» changed. Only the person's own estimates, in their organization.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Los datos para estimar no son válidos.' }, { status: 400 });
    const result = await assessLeadFit(getSupabaseAdminClient(), { userId: auth.user.id, organizationId: auth.organizationId },
      parsed.data.stage, parsed.data.leads, { score: parsed.data.score });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('No se pud')) {
      return NextResponse.json({ error: error.message }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
    }
    return handleAuthError(error);
  }
}
