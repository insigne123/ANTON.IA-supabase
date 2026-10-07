import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { canUseOpportunities } from '@/lib/server/commercial-opportunities/grants';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { answerHelpQuestion, createHelpRateLimiter, HELP_QUESTION_MAX } from '@/lib/help/answer-help-question';
import { visibleHelpSections } from '@/lib/help/manual';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const noStore = { 'Cache-Control': 'private, no-store' };
const BodySchema = z.object({
  question: z.string().trim().min(3).max(HELP_QUESTION_MAX),
  sectionId: z.string().trim().max(60).nullish(),
}).strict();
const allow = createHelpRateLimiter();

/** «Pregúntale a la IA» in the «?» panel and the Centro de ayuda: answers only from the manual. Reads and writes nothing. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = BodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: `Escribe tu pregunta (entre 3 y ${HELP_QUESTION_MAX} caracteres).` }, { status: 400, headers: noStore });
    }
    if (!allow(auth.user.id)) {
      return NextResponse.json({ error: 'Hiciste varias preguntas seguidas. Espera unos minutos y vuelve a intentarlo.' }, { status: 429, headers: noStore });
    }
    const sections = visibleHelpSections({
      // The same rule as the page and the menu: OPPORTUNITIES_ALLOWED_EMAILS or a member an admin let in.
      opportunities: await canUseOpportunities(getSupabaseAdminClient(), auth.user, auth.organizationId),
      admin: auth.organizationRole === 'owner' || auth.organizationRole === 'admin',
    });
    const answer = await answerHelpQuestion({ question: body.data.question, sectionId: body.data.sectionId, sections });
    return NextResponse.json(answer, { headers: noStore });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[help/ask]', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    return NextResponse.json({ error: 'No pudimos responder ahora. Busca en el Centro de ayuda.' }, { status: 500, headers: noStore });
  }
}
