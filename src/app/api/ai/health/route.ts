// src/app/api/ai/health/route.ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Placeholder/health check. Si luego usas Genkit, monta tus flows aquí con appRoute().
    return NextResponse.json({ ok: true, genkit: 'not-in-config', ts: Date.now() });
  } catch (err: any) {
    console.error('[AI_HEALTH]', err);
    return NextResponse.json({ ok: false, error: 'health_failed' }, { status: 500 });
  }
}
