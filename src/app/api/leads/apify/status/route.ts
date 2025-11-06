import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BASE = 'https://api.apify.com/v2';

export async function GET(req: Request) {
  try {
    const token = process.env.APIFY_TOKEN;
    if (!token) {
      return NextResponse.json({ error: 'APIFY_TOKEN missing' }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);
    const runId = searchParams.get('runId');
    let datasetId = searchParams.get('datasetId') || undefined;

    if (!runId) {
      return NextResponse.json({ error: 'runId is required' }, { status: 400 });
    }

    // Estado del run
    const sRes = await fetch(`${BASE}/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (!sRes.ok) return NextResponse.json({ error: await sRes.text() }, { status: 502 });
    const sData = await sRes.json();
    const status: string = sData?.data?.status ?? 'UNKNOWN';

    // Obtener datasetId del run si no vino
    if (!datasetId) {
      datasetId = sData?.data?.defaultDatasetId || undefined;
    }

    if (status === 'SUCCEEDED') {
      if (!datasetId) {
        // Run OK pero sin dataset -> devolver vacío y status para evitar bloqueo del front
        return NextResponse.json({ status, items: [], datasetId: null });
      }
      const itemsRes = await fetch(`${BASE}/datasets/${encodeURIComponent(datasetId)}/items?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (!itemsRes.ok) return NextResponse.json({ error: await itemsRes.text(), status }, { status: 502 });
      const items = await itemsRes.json();
      return NextResponse.json({ status, items, datasetId });
    }

    return NextResponse.json({ status, datasetId: datasetId ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}
