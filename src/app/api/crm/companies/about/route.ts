import { NextRequest, NextResponse } from 'next/server';
import { generateStructured } from '@/ai/openai-json';
import { AuthError, handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { companiesModel } from '@/lib/server/companies-model';
import { normalizeCompanyWebsite } from '@/lib/profile/profile-mappings';
import { aboutAnswerSchema, aboutPrompt, cleanAbout } from '@/lib/companies/about';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Each person reads at most this many sites an hour: one per company opened, the browser keeps the answer for a day.
const PER_HOUR = 60;
const reads = new Map<string, { count: number; until: number }>();
function allow(userId: string, now = Date.now()) {
  const current = reads.get(userId);
  if (!current || current.until < now) { reads.set(userId, { count: 1, until: now + 3_600_000 }); return true; }
  current.count++;
  return current.count <= PER_HOUR;
}

/**
 * What a company of «Empresas» does (src/lib/companies/about.ts): its home page read with the research's reader (public
 * domains only, the DNS answer checked against private ranges, redirects within the company, ten seconds at most), then one
 * or two sentences by the model; the site's own description when the model cannot. Nothing is saved.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const params = new URL(req.url).searchParams;
    const domain = normalizeCompanyWebsite(params.get('domain')).domain;
    const name = String(params.get('name') || '').slice(0, 160);
    if (!domain) throw new AuthError('Dominio no válido.', 400);
    if (!allow(auth.user.id)) throw new AuthError('Leíste muchos sitios en poco tiempo. Intenta en un rato.', 429);
    const { fetchOfficialSite } = await import('@/lib/server/native-research');
    const { value: site } = await fetchOfficialSite({ domain, maxPages: 1 });
    // The answer stays in the browser for a day; a site that did not answer is asked again in an hour.
    if (!site) return NextResponse.json({ domain, website: `https://${domain}`, about: null }, { headers: { 'Cache-Control': 'private, max-age=3600' } });
    let about = '';
    try {
      const answer = await generateStructured({
        schema: aboutAnswerSchema, systemPrompt: 'Describes empresas para un CRM. Responde JSON conforme al contrato.',
        prompt: aboutPrompt({ name: name || domain, domain, title: site.title, description: site.description, text: site.text }),
        openAiModel: companiesModel(), allowDefaultModelFallback: false, reasoningEffort: 'low', maxAttempts: 1, timeoutMs: 20_000, maxOutputTokens: 300,
      });
      about = cleanAbout(answer.about);
    } catch (error) {
      if (error instanceof AuthError) throw error;
    }
    return NextResponse.json({ domain, website: site.url, about: about || cleanAbout(site.description) || null },
      { headers: { 'Cache-Control': 'private, max-age=86400' } });
  } catch (error) {
    return handleAuthError(error);
  }
}
