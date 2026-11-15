import { NextRequest, NextResponse } from 'next/server';

import { processApolloWebhookDelivery } from '@/lib/server/apollo-enrichment-callbacks';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const MAX_WEBHOOK_BODY_BYTES = 1_000_000;

/** How long the answer to the provider waits for the email to the contact's owner: it is short work, and never the provider's problem. */
const DROP_MAIL_WAIT_MS = 12_000;

/**
 * A mobile that lands for a contact of someone's «Contacto del día» goes to their inbox with the script of its call, in the
 * conversation of the morning email (src/lib/server/lead-drop-ready.ts). Done before answering, since nothing runs for sure after
 * it; bounded, and silent whatever happens: the delivery is already stored.
 */
async function tellDropOwner(token: string) {
  try {
    const [{ mailDropCallsForCallback }, { getSupabaseAdminClient }] = await Promise.all([import('@/lib/server/lead-drop-ready'), import('@/lib/server/supabase-admin')]);
    await Promise.race([
      mailDropCallsForCallback(getSupabaseAdminClient(), token).catch(() => null),
      new Promise(resolve => setTimeout(resolve, DROP_MAIL_WAIT_MS)),
    ]);
  } catch { /* the email is a courtesy: the number is in the app either way */ }
}

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
    if (result.kind === 'provider_request_pending') {
      return NextResponse.json({ error: 'PROVIDER_REQUEST_PENDING' }, { status: 503 });
    }
    await tellDropOwner(token);
    return NextResponse.json({ ok: true, outcome: result.outcome });
  } catch {
    // Provider payloads can contain contact data and must never reach logs.
    return NextResponse.json({ error: 'PERSISTENCE_FAILED' }, { status: 500 });
  }
}
