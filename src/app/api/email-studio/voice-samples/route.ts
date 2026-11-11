import { NextRequest, NextResponse } from 'next/server';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { OwnVoiceSampleError, connectedVoiceMailboxes, deleteOwnVoiceSample, listOwnVoiceSamples, saveOwnVoiceSamples, scanSentForVoice } from '@/lib/server/voice-own-samples';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const PRIVATE = { headers: { 'Cache-Control': 'private, no-store' } };

/** «Tu voz»: the person's own samples and the mailboxes they could be searched in. Always the signed-in person's, nobody else's. */
export async function GET() {
  try {
    const { user } = await requireAuth();
    const [samples, connected] = await Promise.all([listOwnVoiceSamples(user.id), connectedVoiceMailboxes(user.id)]);
    return NextResponse.json({ samples, connected }, PRIVATE);
  } catch (error) {
    return handleAuthError(error);
  }
}

/**
 * `scan`: looks in what the person sent for emails that show how they write, and returns them to their own screen without keeping any.
 * `save`: keeps the ones they chose, or a text they pasted.
 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth();
    const body = await req.json().catch(() => null) as { action?: unknown; samples?: unknown } | null;
    if (body?.action === 'scan') return NextResponse.json(await scanSentForVoice(user.id), PRIVATE);
    if (body?.action === 'save') {
      try {
        return NextResponse.json({ samples: await saveOwnVoiceSamples(user.id, Array.isArray(body.samples) ? body.samples.slice(0, 5) : []) }, PRIVATE);
      } catch (error) {
        if (error instanceof OwnVoiceSampleError) return NextResponse.json({ error: error.message }, { status: error.status, ...PRIVATE });
        throw error;
      }
    }
    return NextResponse.json({ error: 'Acción no reconocida.' }, { status: 400, ...PRIVATE });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user } = await requireAuth();
    const id = req.nextUrl.searchParams.get('id') || '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Ejemplo no encontrado.' }, { status: 400, ...PRIVATE });
    return NextResponse.json({ samples: await deleteOwnVoiceSample(user.id, id) }, PRIVATE);
  } catch (error) {
    return handleAuthError(error);
  }
}
