import { NextRequest, NextResponse } from 'next/server';
import { generateStructured } from '@/ai/openai-json';
import { AuthError, handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { mapProfileToForm } from '@/lib/profile/profile-mappings';
import { resolveSimilar, similarAnswerSchema, similarPrompt, similarRequestSchema } from '@/lib/companies/similar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const noStore = { 'Cache-Control': 'private, no-store' };

/** The model that picks the companies: Haiku by default; COMPANIES_MODEL can name another allowed one. */
function companiesModel(env: Record<string, string | undefined> = process.env) {
  const wanted = env.COMPANIES_MODEL || 'claude-haiku-5-5';
  if (!['claude-haiku-5-5', 'claude-sonnet-5-5', 'gpt-6-luna'].includes(wanted)) throw new AuthError('El modelo configurado no está permitido.', 503);
  return wanted;
}

/**
 * «Empresas parecidas» (src/lib/companies/similar.ts): the browser already ran Búsqueda's company search (its quota and
 * its provider); here the AI keeps the most alike among those results and says why. Nothing is saved.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = similarRequestSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new AuthError('Solicitud no válida.', 400);
    const profile: any = await getSupabaseAdminClient().from('profiles').select('signatures,full_name,company_name').eq('id', auth.user.id).maybeSingle();
    const form = mapProfileToForm((profile.data || {}) as any);
    const seller = {
      company: String(form.companyName || profile.data?.company_name || '').trim(),
      offer: [form.valueProposition, form.description, form.services].map(value => String(value || '').trim()).filter(Boolean).join('. '),
    };
    let answer;
    try {
      answer = await generateStructured({
        schema: similarAnswerSchema, systemPrompt: 'Eliges empresas parecidas para prospectar. Responde JSON conforme al contrato.',
        prompt: similarPrompt({ ...body.data, seller }), openAiModel: companiesModel(), allowDefaultModelFallback: false,
        reasoningEffort: 'low', maxAttempts: 2, timeoutMs: 60_000, maxOutputTokens: 1200,
      });
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('La IA no pudo elegir las empresas. Intenta de nuevo.', 503);
    }
    return NextResponse.json({ companies: resolveSimilar(answer, body.data.candidates) }, { headers: noStore });
  } catch (error) {
    return handleAuthError(error);
  }
}
