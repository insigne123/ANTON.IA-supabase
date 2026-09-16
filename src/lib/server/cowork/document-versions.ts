import type { AuthContext } from '@/lib/server/auth-utils';
import { z } from 'zod';

export async function listCoworkDocumentVersions(auth: AuthContext, runId: string) {
  z.string().uuid().parse(runId);
  const client = auth.supabase;
  const current = await client.from('cowork_document_versions').select('document_id,revision')
    .eq('run_id', runId).eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
  if (current.error) throw current.error;
  if (!current.data) return { documentId: null, currentRevision: null, versions: [] };
  const lineage: string[] = [];
  let cursor: string | null = runId;
  while (cursor && lineage.length < 50) {
    if (lineage.includes(cursor)) throw new Error('Invalid document lineage');
    const parent: { data: { id: string; parent_run_id: string | null } | null; error: unknown } = await client.from('cowork_runs').select('id,parent_run_id')
      .eq('id', cursor).eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
    if (parent.error || !parent.data) throw new Error('Document history unavailable');
    lineage.push(cursor);
    cursor = parent.data.parent_run_id;
  }
  const versions = await client.from('cowork_document_versions').select('revision,run_id,title,created_at')
    .eq('document_id', current.data.document_id).eq('user_id', auth.user.id).eq('organization_id', auth.organizationId)
    .in('run_id', lineage).order('revision', { ascending: false }).limit(50);
  if (versions.error) throw versions.error;
  return { documentId: current.data.document_id, currentRevision: current.data.revision, versions: versions.data || [], truncated: Boolean(cursor) };
}
