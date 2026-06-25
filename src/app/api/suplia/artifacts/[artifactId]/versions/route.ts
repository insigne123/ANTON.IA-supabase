import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { listSupliaArtifactVersions, restoreSupliaArtifactVersion } from '@/lib/server/suplia-artifacts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ artifactId: string }> }) {
  try {
    const auth = await requireAuth();
    const { artifactId } = await params;
    const versions = await listSupliaArtifactVersions(auth, artifactId);
    return NextResponse.json({ versions });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[SUPLIA/artifact versions] GET error:', error);
    return NextResponse.json({ error: error?.message || 'No se pudieron cargar las versiones del artifact' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ artifactId: string }> }) {
  try {
    const auth = await requireAuth();
    const { artifactId } = await params;
    const body = await req.json().catch(() => ({}));
    const versionId = String(body?.versionId || '').trim();
    if (!versionId) return NextResponse.json({ error: 'versionId requerido' }, { status: 400 });

    const result = await restoreSupliaArtifactVersion(auth, { artifactId, versionId });
    const versions = await listSupliaArtifactVersions(auth, artifactId);
    return NextResponse.json({ ...result, versions, toast: `Restaurado a la version ${result.version.versionNumber}.` });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[SUPLIA/artifact versions] POST error:', error);
    return NextResponse.json({ error: error?.message || 'No se pudo restaurar la version del artifact' }, { status: 500 });
  }
}
