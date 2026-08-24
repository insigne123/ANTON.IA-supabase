import { NextRequest, NextResponse } from 'next/server';

import { buildResearchRequestIdempotencyKeyV1 } from '@/lib/research-contracts';
import { NativeResearchRequestSchema } from '@/lib/native-research-contracts';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import {
  enqueueNativeResearch,
  isNativeResearchEnabled,
  processNativeResearchQueue,
} from '@/lib/server/native-research';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function shouldRunInline() {
  if (String(process.env.NATIVE_RESEARCH_INLINE || '').trim()) {
    return String(process.env.NATIVE_RESEARCH_INLINE).toLowerCase() === 'true';
  }
  return process.env.NODE_ENV !== 'production';
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    provider: 'native-research-v1',
    enabled: isNativeResearchEnabled(),
    inline: shouldRunInline(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!isNativeResearchEnabled()) {
      return NextResponse.json({ error: 'NATIVE_RESEARCH_DISABLED' }, { status: 404 });
    }

    const parsed = NativeResearchRequestSchema.parse(await req.json());
    const lead = parsed.lead;
    const explicitKey = String(req.headers.get('idempotency-key') || '').trim();
    const requestKey = explicitKey || buildResearchRequestIdempotencyKeyV1({
      ownerId: auth.user.id,
      leadRef: lead.id || lead.linkedinUrl || null,
      email: lead.email || null,
      companyDomain: lead.companyDomain || lead.companyWebsite || null,
      provider: 'native-research-v1',
      freshnessBucket: parsed.options.refresh ? null : Math.floor(Date.now() / (24 * 60 * 60 * 1000)),
      ...(parsed.options.refresh ? { jobIdentity: crypto.randomUUID() } : {}),
    });

    const queued = await enqueueNativeResearch({
      access: { organizationId: auth.organizationId, userId: auth.user.id },
      lead,
      options: parsed.options,
      requestIdempotencyKey: requestKey,
    });

    if (shouldRunInline() && ['queued', 'running'].includes(queued.status)) {
      void processNativeResearchQueue({ limit: 1, organizationId: auth.organizationId, userId: auth.user.id })
        .catch((error) => console.error('[native-research] inline worker failed:', error));
    }

    return NextResponse.json({
      ok: true,
      ...queued,
      status: ['completed', 'partial', 'insufficient_data', 'failed', 'cancelled'].includes(queued.status) ? queued.status : 'queued',
    }, {
      status: ['completed', 'partial', 'insufficient_data', 'failed', 'cancelled'].includes(queued.status) ? 200 : 202,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    if (error?.name === 'ZodError') {
      return NextResponse.json({ error: 'NATIVE_RESEARCH_INVALID_REQUEST', details: error.issues }, { status: 400 });
    }
    if (error?.message === 'NATIVE_RESEARCH_PRIVACY_SUPPRESSED') {
      return NextResponse.json({ error: 'NATIVE_RESEARCH_PRIVACY_SUPPRESSED' }, { status: 409 });
    }
    console.error('[native-research] enqueue failed:', error);
    return NextResponse.json({ error: 'NATIVE_RESEARCH_ENQUEUE_FAILED', message: error?.message || 'No se pudo encolar la investigación.' }, { status: 500 });
  }
}
