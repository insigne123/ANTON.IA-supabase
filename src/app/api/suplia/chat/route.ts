import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupliaState, processSupliaMessage } from '@/lib/server/suplia-orchestrator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const streamPhases = [
  'Analizando pedido',
  'Revisando contexto',
  'Preparando herramientas',
  'Validando permisos',
  'Armando respuesta',
];

function sseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const conversationId = req.nextUrl.searchParams.get('conversationId');
    const state = await getSupliaState(auth, conversationId);
    return NextResponse.json(state);
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[SUPLIA/chat] GET error:', error);
    return NextResponse.json({ error: error?.message || 'No se pudo cargar SUPL.IA' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await req.json();
    const input = {
      conversationId: body?.conversationId || null,
      message: String(body?.message || ''),
      activeArtifactId: body?.activeArtifactId || null,
      answerToAsk: body?.answerToAsk || null,
    };

    if (body?.stream === true || req.headers.get('accept')?.includes('text/event-stream')) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          let phaseIndex = 0;
          let closed = false;
          let interval: ReturnType<typeof setInterval> | null = null;
          const send = (event: string, data: unknown) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(sseEvent(event, data)));
            } catch {
              closed = true;
            }
          };
          const close = () => {
            if (closed) return;
            closed = true;
            try {
              controller.close();
            } catch {
              // The browser may have already closed the connection.
            }
          };
          const cleanup = () => {
            if (interval) clearInterval(interval);
            req.signal.removeEventListener('abort', abortStream);
          };
          const abortStream = () => {
            cleanup();
            close();
          };

          req.signal.addEventListener('abort', abortStream);
          send('start', { phase: streamPhases[0], phaseIndex: 0, phases: streamPhases, startedAt: Date.now() });
          interval = setInterval(() => {
            phaseIndex = Math.min(streamPhases.length - 1, phaseIndex + 1);
            send('status', { phase: streamPhases[phaseIndex], phaseIndex, at: Date.now() });
          }, 1600);

          try {
            const state = await processSupliaMessage(auth, input);
            cleanup();
            send('status', { phase: 'Respuesta lista', phaseIndex: streamPhases.length - 1, at: Date.now() });
            send('final', { state });
          } catch (error: any) {
            cleanup();
            console.error('[SUPLIA/chat] stream error:', error);
            send('error', { error: error?.message || 'SUPL.IA no pudo responder' });
          } finally {
            close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
        },
      });
    }

    const state = await processSupliaMessage(auth, input);
    return NextResponse.json(state);
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[SUPLIA/chat] POST error:', error);
    return NextResponse.json({ error: error?.message || 'SUPL.IA no pudo responder' }, { status: 500 });
  }
}
