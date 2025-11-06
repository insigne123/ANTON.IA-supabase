import { NextRequest, NextResponse } from 'next/server';
import { addLog, clearLogs, getLogs } from '@/lib/debug';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ logs: getLogs() });
}

export async function DELETE() {
  clearLogs();
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  addLog({
    ts: new Date().toISOString(),
    side: 'client',
    name: body?.name || 'client.note',
    request: { method: 'CLIENT', url: body?.url || 'client', body: body?.payload },
  });
  return NextResponse.json({ ok: true });
}
