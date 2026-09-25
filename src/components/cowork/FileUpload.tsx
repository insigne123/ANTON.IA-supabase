'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileText, LoaderCircle, Upload } from 'lucide-react';
import { coworkFileSize } from '@/lib/cowork/presentation';
import { cn } from '@/lib/utils';

/** Run-scoped file upload for code execution inputs. Lists what is already
 * uploaded; contents are never previewed or executed here. */
export function FileUpload({ runId, onError, onAccessDenied }: {
  runId: string; onError: (message: string) => void; onAccessDenied: () => void;
}) {
  const [files, setFiles] = useState<Array<{ name: string; size: number }>>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
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
  return <section aria-label="Archivos de entrada" onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
    onDrop={event => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer?.files || null); }}
    className={cn('space-y-2 rounded-xl border border-dashed px-3 py-2.5 transition-colors', dragging ? 'border-cw-accent bg-cw-accent-soft' : 'border-cw-border-strong bg-cw-panel')}>
    {files.length > 0 && <ul className="flex flex-wrap gap-1.5">
      {files.map(file => <li key={file.name} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-cw-border bg-cw-elevated px-2 py-1 text-[12.5px]">
        <FileText className="h-3.5 w-3.5 shrink-0 text-cw-muted" aria-hidden="true" />
        <span className="truncate">{file.name}</span><span className="shrink-0 text-cw-muted">{coworkFileSize(file.size)}</span>
      </li>)}
    </ul>}
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <label htmlFor={`cowork-files-${runId}`} className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-cw-text hover:bg-cw-hover focus-within:ring-2 focus-within:ring-[color:var(--cw-accent-ring)]', uploading && 'pointer-events-none opacity-50')}>
        {uploading ? <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
        {uploading ? 'Subiendo…' : 'Elegir archivos'}
        <input id={`cowork-files-${runId}`} type="file" multiple accept=".csv,.json,.md,.txt,.xlsx" disabled={uploading}
          onChange={event => { void upload(event.target.files); event.target.value = ''; }} className="sr-only" />
      </label>
      <span className="text-[12px] text-cw-muted">o arrástralos aquí · CSV, JSON, MD, TXT o XLSX (máx. 20 MB). Se usan cuando el trabajo ejecuta código.</span>
    </div>
    {uploading && <p role="status" className="sr-only">Subiendo…</p>}
  </section>;
}
