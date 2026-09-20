'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

/** Run-scoped file upload for code execution inputs. Lists what is already
 * uploaded; contents are never previewed or executed here. */
export function FileUpload({ runId, onError, onAccessDenied }: {
  runId: string; onError: (message: string) => void; onAccessDenied: () => void;
}) {
  const [files, setFiles] = useState<Array<{ name: string; size: number }>>([]);
  const [uploading, setUploading] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/cowork/runs/${runId}/files`, { cache: 'no-store' });
      const data = await response.json();
      if (response.status === 401 || response.status === 403) { onAccessDenied(); return; }
      if (!response.ok) throw new Error(data.error || 'No se pudieron listar los archivos.');
      setFiles(data.files || []);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudieron listar los archivos.');
    }
  }, [runId, onError, onAccessDenied]);
  useEffect(() => { void load(); }, [load]);
  async function upload(selected: FileList | null) {
    if (!selected || selected.length === 0 || uploading) return;
    setUploading(true);
    try {
      const form = new FormData();
      for (const file of Array.from(selected).slice(0, 8)) form.append('files', file, file.name);
      const response = await fetch(`/api/cowork/runs/${runId}/files`, { method: 'POST', body: form });
      const data = await response.json();
      if (response.status === 401 || response.status === 403) { onAccessDenied(); return; }
      if (!response.ok) throw new Error(data.error || 'No se pudo subir el archivo.');
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo subir el archivo.');
    } finally {
      setUploading(false);
    }
  }
  return <section aria-label="Archivos de entrada" className="space-y-2 rounded-xl border border-border p-5">
    <h3 className="font-medium">Archivos de entrada</h3>
    {files.length === 0
      ? <p className="text-sm text-muted-foreground">Sin archivos. Sube CSV, JSON, MD, TXT o XLSX (máx 20 MB cada uno) para usarlos en código.</p>
      : <ul className="space-y-1 text-sm">{files.map(file => <li key={file.name} className="break-words">{file.name}<span className="text-muted-foreground"> · {(file.size / 1024).toFixed(1)} KB</span></li>)}</ul>}
    <div>
      <Label htmlFor={`cowork-files-${runId}`} className="sr-only">Subir archivos</Label>
      <input id={`cowork-files-${runId}`} type="file" multiple accept=".csv,.json,.md,.txt,.xlsx" disabled={uploading}
        onChange={event => { void upload(event.target.files); event.target.value = ''; }}
        className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-muted/50 file:px-3 file:py-1.5 file:text-sm file:text-foreground disabled:opacity-50" />
    </div>
    {uploading && <p role="status" className="text-sm text-muted-foreground">Subiendo…</p>}
  </section>;
}
