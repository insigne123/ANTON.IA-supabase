import type { SupabaseClient } from '@supabase/supabase-js';

/** Where Cowork keeps what the person uploads: `${organizationId}/${userId}/${runId}/${name}`. */
export const COWORK_UPLOAD_BUCKET = 'cowork-uploads';

export type CoworkUpload = { runId: string; size: number; updatedAt: string };

/** The person's own uploads by name, newest first, across up to 100 run folders
 * with 50 files each. «Adjuntar archivos» stores a file in the turn on screen,
 * so it usually lives in an earlier run than the one that reads or uses it. */
export async function listCoworkUploads(client: SupabaseClient, scope: { userId: string; organizationId: string }) {
  const root = `${scope.organizationId}/${scope.userId}`;
  const { data: runs, error } = await client.storage.from(COWORK_UPLOAD_BUCKET).list(root, { limit: 100 });
  if (error) throw new Error('No se pudieron listar los archivos.');
  const uploads = new Map<string, CoworkUpload[]>();
  for (const run of runs || []) {
    if (!run.name) continue;
    const { data: files, error: runError } = await client.storage.from(COWORK_UPLOAD_BUCKET).list(`${root}/${run.name}`, { limit: 50 });
    if (runError) continue;
    for (const file of files || []) {
      if (!file.name) continue;
      uploads.set(file.name, [...(uploads.get(file.name) || []),
        { runId: run.name, size: Number(file.metadata?.size || 0), updatedAt: String(file.updated_at || file.created_at || '') }]);
    }
  }
  for (const copies of uploads.values()) copies.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return uploads;
}
