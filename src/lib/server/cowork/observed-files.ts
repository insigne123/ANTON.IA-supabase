import type { SupabaseClient } from '@supabase/supabase-js';
import { listCoworkUploads, type CoworkUpload } from './uploads';
import { coworkPublishedFiles } from '@/lib/cowork/published-files';
import type { CoworkEvent } from '@/lib/cowork/contracts';
export type CoworkObservedFile = CoworkUpload & { bucket?: 'cowork-artifacts'; sha256?: string };
/** Logical workspace assets are scoped immutable outputs, independent of the executor's lifetime.
 * Reuse is explicit through observed file names and a fresh reviewed input manifest. */
export async function listCoworkObservedFiles(client: SupabaseClient, scope: { userId: string; organizationId: string }): Promise<Map<string, CoworkObservedFile[]>> {
  const files: Map<string, CoworkObservedFile[]> = await listCoworkUploads(client, scope);
  if (process.env.COWORK_BUILD_WORKSPACES_ENABLED !== 'true') return files;
  const found = await client.from('cowork_run_events').select('run_id,kind,payload,created_at,sequence')
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).in('kind', ['artifact.created', 'effect.completed'])
    .order('created_at', { ascending: false }).limit(200);
  if (found.error) throw new Error('No se pudieron consultar los archivos guardados del workspace.');
  for (const row of found.data || []) {
    const published = coworkPublishedFiles([row as CoworkEvent]);
    for (const file of published) files.set(file.name, [...(files.get(file.name) || []),
      { runId: String(row.run_id), size: file.size ?? 0, updatedAt: String(row.created_at), bucket: 'cowork-artifacts', ...(file.sha256 ? { sha256: file.sha256 } : {}) }]);
  }
  for (const versions of files.values()) versions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return files;
}
