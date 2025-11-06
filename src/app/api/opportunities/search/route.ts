// src/app/api/opportunities/search/route.ts
import { getApifyClient, hasApifyAuth } from '@/lib/apify-client';

type Body = {
  jobTitle?: string;
  location: string;
  rows?: number;
  dateRange?: 'r86400' | 'r604800' | 'r2592000';
};

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<Body>;
    const location = String(body.location || '').trim();
    if (!location) {
      return j({ error: { type: 'invalid-input', message: 'Falta "location".' } }, 400);
    }
    const rows = Math.min(Math.max(Number(body.rows ?? 100), 1), 200);

    if (!hasApifyAuth()) {
      return j(
        { error: { type: 'missing-apify-token', message: 'Falta APIFY_TOKEN en el entorno.' } },
        401,
      );
    }

    const actorId = process.env.APIFY_ACTOR_ID?.trim() || 'bebity/linkedin-jobs-scraper';
    const client = getApifyClient();

    // Input según tu captura del actor
    const actorInput: Record<string, any> = {
      location,
      title: body.jobTitle || undefined,
      rows,
      publishedAt: body.dateRange, // r86400|r604800|r2592000
      proxy: {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
      },
    };

    // IMPORTANTE: arrancamos el actor y devolvemos inmediatamente el runId
    // (evitamos esperar a que termine para no caer en timeouts del runtime). :contentReference[oaicite:1]{index=1}
    const run = await client.actor(actorId).start(actorInput);
    if (!run?.id) {
      return j({ error: { type: 'actor-start-failed', message: 'No se pudo iniciar el actor.' } }, 500);
    }

    return j({ ok: true, runId: run.id }, 202);
  } catch (err: any) {
    const raw = String(err?.message || err);
    if (raw.includes('user-or-token-not-found')) {
      return j(
        { error: { type: 'user-or-token-not-found', message: 'APIFY_TOKEN inválido o expirado.' } },
        401,
      );
    }
    console.error('[opportunities/search] error:', err);
    return j(
      { error: { type: 'internal-error', message: 'Error iniciando la búsqueda.', detail: err?.message } },
      500,
    );
  } finally {
    const ms = Date.now() - startedAt;
    if (ms > 300) console.log(`[opportunities/search] started in ${ms}ms`);
  }
}

function j(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
