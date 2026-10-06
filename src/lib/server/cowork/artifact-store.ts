import type { SupabaseClient } from '@supabase/supabase-js';
import { coworkArtifactFileParts } from '@/lib/cowork/design-brief';
import type { CoworkCodeArtifact } from './code-artifact';
import { loadCoworkArtifactData } from './artifact-data';
import type { CoworkArtifactStore } from './designer-run';

/**
 * Where code artifacts live (Plan 12, 3b): the run's prefix of the private `cowork-artifacts` bucket, as the
 * executor's outputs do. The page (`artifact-…-vN.html`) is recorded in an artifact.created event, so the
 * artifacts route serves it sandboxed; its code (`….code.json`) is never recorded and never served: only
 * the Designer reads it back to make the next version.
 */

const BUCKET = 'cowork-artifacts';
type Scope = { userId: string; organizationId: string };

export function coworkArtifactStore(client: SupabaseClient, scope: Scope, runId: string, options: { opportunities: boolean }): CoworkArtifactStore {
  const prefix = `${scope.organizationId}/${scope.userId}`;
  const artifactEvents = () => client.from('cowork_run_events').select('run_id,payload')
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).eq('kind', 'artifact.created');
  return {
    loadData: tables => loadCoworkArtifactData(client, scope, tables, { opportunities: options.opportunities }),
    async loadPrevious(name) {
      if (!coworkArtifactFileParts(name)) return null;
      const { data, error } = await artifactEvents().eq('payload->>name', name).order('created_at', { ascending: false }).limit(1);
      const row = (data || [])[0] as { run_id?: string } | undefined;
      if (error || !row?.run_id) return null;
      const file = await client.storage.from(BUCKET).download(`${prefix}/${row.run_id}/${name}.code.json`);
      if (file.error || !file.data) return null;
      try {
        const code = JSON.parse(await file.data.text()) as Partial<CoworkCodeArtifact>;
        return { html: String(code.html ?? ''), css: String(code.css ?? ''), js: String(code.js ?? '') };
      } catch { return null; }
    },
    async nextVersion(key) {
      const { data, error } = await artifactEvents().eq('payload->>key', key).limit(200);
      if (error) throw new Error('No se pudieron leer las versiones del artefacto.');
      const versions = ((data || []) as Array<{ payload?: { version?: unknown } }>).map(row => Number(row.payload?.version)).filter(Number.isFinite);
      return (versions.length ? Math.max(...versions) : 0) + 1;
    },
    async save({ name, html, code }) {
      const path = `${prefix}/${runId}/${name}`;
      const page = Buffer.from(html, 'utf8');
      const uploaded = await client.storage.from(BUCKET).upload(path, page, { upsert: true, contentType: 'text/html; charset=utf-8' });
      if (uploaded.error) throw new Error('No se pudo guardar el artefacto.');
      const source = await client.storage.from(BUCKET).upload(`${path}.code.json`, Buffer.from(JSON.stringify(code), 'utf8'),
        { upsert: true, contentType: 'application/json' });
      if (source.error) throw new Error('No se pudo guardar el código del artefacto.');
      return { path, size: page.length };
    },
    async recordArtifact(payload) {
      const { error } = await client.from('cowork_run_events').insert({
        run_id: runId, user_id: scope.userId, organization_id: scope.organizationId, kind: 'artifact.created', payload,
      });
      if (error) throw new Error('No se pudo registrar el artefacto.');
    },
  };
}
