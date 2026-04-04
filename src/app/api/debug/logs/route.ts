import { NextRequest, NextResponse } from 'next/server';
import { addLog, clearLogs, getLogs } from '@/lib/debug';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isDebugApiEnabled() {
  return process.env.NODE_ENV !== 'production' || String(process.env.DEBUG_API_ENABLED || '').trim() === 'true';
}

export async function GET() {
  if (!isDebugApiEnabled()) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    await requireAuth();
  } catch (error) {
    return handleAuthError(error);
  }
  return NextResponse.json({ logs: getLogs() });
}

export async function DELETE() {
  if (!isDebugApiEnabled()) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    await requireAuth();
  } catch (error) {
    return handleAuthError(error);
  }
  clearLogs();
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  if (!isDebugApiEnabled()) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    await requireAuth();
  } catch (error) {
    return handleAuthError(error);
  }
  const body = await req.json().catch(() => ({}));
  addLog({
    ts: new Date().toISOString(),
    side: 'client',
    name: body?.name || 'client.note',
    request: { method: 'CLIENT', url: body?.url || 'client', body: body?.payload },
  });
  return NextResponse.json({ ok: true });
}
