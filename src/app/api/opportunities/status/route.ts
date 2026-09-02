// src/app/api/opportunities/status/route.ts
import type { NextRequest } from 'next/server';
import { getApifyClient, hasApifyAuth } from '@/lib/apify-client';
import { normalizeLinkedinJob } from '@/lib/opportunities';
import { requireAuth, handleAuthError } from '@/lib/server/auth-utils';
import {
  enrichmentSearchCreditsUnavailablePayload,
  hasEnrichmentSearchCreditAccess,
} from '@/lib/server/enrichment-search-access';

// ✅ SOLO UNA declaración. Si ya existía otra, elimínala.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const runId = url.searchParams.get('runId') || '';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100), 1), 200);

  try {
    const { user } = await requireAuth();
    if (!hasEnrichmentSearchCreditAccess(user?.email)) {
      return j(enrichmentSearchCreditsUnavailablePayload(), 429);
    }
    if (!runId) {
      return j({ error: { type: 'invalid-input', message: 'Falta "runId".' } }, 400);
    }
    if (!hasApifyAuth()) {
      return j({ error: { type: 'missing-apify-token', message: 'Falta APIFY_TOKEN.' } }, 401);
    }

    const client = getApifyClient();

    // Estado del run
    const run = await client.run(runId).get(); // { status, defaultDatasetId, ... }
    if (!run) return j({ error: { type: 'run-not-found', message: 'Run no encontrado.' } }, 404);

    if (run.status !== 'SUCCEEDED') {
      return j({ ok: true, status: run.status }, 200);
    }

    // Leer items cuando termine
    const dsId = run.defaultDatasetId;
    if (!dsId) return j({ ok: true, status: 'SUCCEEDED', items: [] }, 200);

    const { items = [] } = await client.dataset(dsId).listItems({ limit });
    const mapped = (items as any[]).map(normalizeLinkedinJob);

    return j({ ok: true, status: 'SUCCEEDED', total: mapped.length, items: mapped }, 200);
  } catch (err: any) {
    const raw = String(err?.message || err);
    const authRes = handleAuthError(err);
    if (authRes.status !== 500 || err?.name === 'AuthError') return authRes;
    if (raw.includes('user-or-token-not-found')) {
      return j(
        { error: { type: 'user-or-token-not-found', message: 'APIFY_TOKEN inválido o expirado.' } },
        401,
      );
    }
    console.error('[opportunities/status] error:', err);
    return j(
      { error: { type: 'internal-error', message: 'Error consultando estado.', detail: err?.message } },
      500,
    );
  }
}

function j(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store, no-cache, must-revalidate',
    },
  });
}
