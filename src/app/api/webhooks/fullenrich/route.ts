import { NextRequest, NextResponse } from 'next/server';

import { processFullEnrichWebhookDelivery } from '@/lib/server/fullenrich-enrichment-callbacks';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const MAX_WEBHOOK_BODY_BYTES = 2_000_000;

function exceedsBodyLimit(request: NextRequest): boolean {
  const contentLength = Number.parseInt(request.headers.get('content-length') || '', 10);
  return Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES;
}

export async function POST(request: NextRequest) {
  const apiKey = String(process.env.FULLENRICH_API_KEY || '').trim();
  if (!apiKey) {
    return NextResponse.json({ error: 'FULLENRICH_API_KEY_NOT_CONFIGURED' }, { status: 503 });
  }

  if (exceedsBodyLimit(request)) {
    return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }

  let rawBody: Buffer;
  try {
    rawBody = Buffer.from(await request.arrayBuffer());
  } catch {
    return NextResponse.json({ error: 'INVALID_PAYLOAD' }, { status: 400 });
  }

  if (rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }

  try {
    const result = await processFullEnrichWebhookDelivery({
      rawBody,
      signatureHeader: request.headers.get('x-signature-sha1'),
      apiKey,
    });

    if (result.kind === 'unauthorized') {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }
    if (result.kind === 'invalid_payload') {
      return NextResponse.json({ error: 'INVALID_PAYLOAD' }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      received: result.received,
      processed: result.processed,
      duplicates: result.duplicates,
      ignored: result.ignored,
    });
  } catch {
    // Do not log provider payloads or database errors because either can carry PII.
    return NextResponse.json({ error: 'PERSISTENCE_FAILED' }, { status: 500 });
  }
}
