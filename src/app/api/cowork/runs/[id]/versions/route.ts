import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { listCoworkDocumentVersions } from '@/lib/server/cowork/document-versions';

export const dynamic = 'force-dynamic';
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const auth = await requireCoworkAccess();
    if (process.env.COWORK_DOCUMENT_VERSIONS_ENABLED !== 'true') return NextResponse.json({ currentRevision: null, versions: [] }, { headers });
    return NextResponse.json(await listCoworkDocumentVersions(auth, (await context.params).id), { headers });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No se pudo cargar el historial del documento.' }, { status: error instanceof z.ZodError ? 400 : 503, headers });
  }
}
