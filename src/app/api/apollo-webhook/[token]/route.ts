import { NextRequest, NextResponse } from 'next/server';

import { processApolloWebhookDelivery } from '@/lib/server/apollo-enrichment-callbacks';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const MAX_WEBHOOK_BODY_BYTES = 1_000_000;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const declaredLength = Number.parseInt(request.headers.get('content-length') || '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }

  const { token } = await context.params;
  let rawBody: Buffer;
  try {
    rawBody = Buffer.from(await request.arrayBuffer());
  } catch {
    return NextResponse.json({ error: 'INVALID_PAYLOAD' }, { status: 400 });
  }
  if (rawBody.length === 0 || rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: rawBody.length === 0 ? 'INVALID_PAYLOAD' : 'PAYLOAD_TOO_LARGE' }, {
      status: rawBody.length === 0 ? 400 : 413,
    });
  }

  try {
    const result = await processApolloWebhookDelivery({
      token,
      rawBody,
      requestIdHeader: request.headers.get('x-apollo-request-id') || request.headers.get('x-request-id'),
    });
    if (result.kind === 'unauthorized') {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }
    if (result.kind === 'invalid_payload') {
      return NextResponse.json({ error: 'INVALID_PAYLOAD' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, outcome: result.outcome });
  } catch {
    // Provider payloads can contain contact data and must never reach logs.
    return NextResponse.json({ error: 'PERSISTENCE_FAILED' }, { status: 500 });
  }
}
