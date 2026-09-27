'use client';

import { useCallback, useRef, useState } from 'react';
import { FileText, LoaderCircle, Upload, X } from 'lucide-react';
import { coworkMessageAttachments } from '@/lib/cowork/attachments';
import { coworkDisplayMessage, coworkFileSize } from '@/lib/cowork/presentation';
import { cn } from '@/lib/utils';

export type CoworkAttachment = { name: string; size: number };

/** Files for the next message: uploaded as soon as they are chosen or dropped,
 * and named at the end of the message when it is sent (attachments.ts). */
export function useCoworkAttachments({ onError, onAccessDenied }: { onError: (message: string) => void; onAccessDenied: () => void }) {
  const [files, setFiles] = useState<CoworkAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const busy = useRef(false);
  const add = useCallback((added: CoworkAttachment[]) => {
    setFiles(current => [...current.filter(file => !added.some(item => item.name === file.name)), ...added]);
  }, []);
  const upload = useCallback(async (selected: FileList | File[] | null) => {
    const chosen = Array.from(selected || []);
    if (!chosen.length || busy.current) return;
    busy.current = true;
    setUploading(true);
    try {
      const form = new FormData();
      for (const file of chosen) form.append('files', file, file.name);
      const response = await fetch('/api/cowork/files', { method: 'POST', body: form });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) { onAccessDenied(); return; }
      if (!response.ok) throw new Error(data.error || 'No se pudo subir el archivo.');
      add((data.files || []) as CoworkAttachment[]);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo subir el archivo.');
    } finally {
      busy.current = false;
      setUploading(false);
    }
  }, [add, onError, onAccessDenied]);
  const remove = useCallback((name: string) => setFiles(current => current.filter(file => file.name !== name)), []);
  const clear = useCallback(() => setFiles([]), []);
  return { files, uploading, upload, remove, clear, restore: add };
}

/** The files attached to the next message and, when open, the way to add more.
 * Dropping works on the whole message box; removing only detaches the file. */
export function CoworkAttachments({ id, files, uploading, open, onUpload, onRemove }: {
  id: string; files: CoworkAttachment[]; uploading: boolean; open: boolean;
  onUpload: (files: FileList | null) => void; onRemove: (name: string) => void;
}) {
  return <section aria-label="Archivos adjuntos" className="space-y-2">
    {files.length > 0 && <ul className="flex flex-wrap gap-1.5">
      {files.map(file => <li key={file.name} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-cw-border bg-cw-elevated py-1 pl-2 pr-1 text-[12.5px]">
        <FileText className="h-3.5 w-3.5 shrink-0 text-cw-muted" aria-hidden="true" />
        <span className="truncate">{file.name}</span><span className="shrink-0 text-cw-muted">{coworkFileSize(file.size)}</span>
        <button type="button" onClick={() => onRemove(file.name)} aria-label={`Quitar ${file.name} del mensaje`} title="Quitar del mensaje"
          className="shrink-0 rounded-md p-0.5 text-cw-muted hover:bg-cw-hover hover:text-cw-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </li>)}
    </ul>}
    {open && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-dashed border-cw-border-strong bg-cw-panel px-3 py-2.5">
      <label htmlFor={id} className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-cw-text hover:bg-cw-hover focus-within:ring-2 focus-within:ring-[color:var(--cw-accent-ring)]', uploading && 'pointer-events-none opacity-50')}>
        {uploading ? <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
        {uploading ? 'Subiendo…' : 'Elegir archivos'}
        <input id={id} type="file" multiple accept=".csv,.json,.md,.txt,.xlsx" disabled={uploading}
          onChange={event => { onUpload(event.target.files); event.target.value = ''; }} className="sr-only" />
      </label>
      <span className="text-[12px] text-cw-muted">o arrástralos al cuadro · Cowork lee CSV, JSON, MD y TXT de hasta 20 MB; un Excel lo analiza con código, con tu aprobación.</span>
    </div>}
    <p role="status" className="sr-only">{uploading ? 'Subiendo…' : files.length ? `${files.length} ${files.length === 1 ? 'archivo adjunto' : 'archivos adjuntos'}` : ''}</p>
  </section>;
}

/** The person's message as the chat shows it: the text, then its files as chips. */
export function CoworkUserMessage({ message }: { message: string }) {
  const { text, files } = coworkMessageAttachments(message);
  const shown = coworkDisplayMessage(text);
  return <div className="flex max-w-[85%] flex-col items-end gap-1.5">
    {shown && <p className="whitespace-pre-wrap break-words rounded-[18px] rounded-br-md bg-cw-user px-4 py-2.5 text-[15px] leading-[1.55] text-cw-text">{shown}</p>}
    {files.length > 0 && <ul aria-label="Archivos adjuntos" className="flex flex-wrap justify-end gap-1.5">
      {files.map(name => <li key={name} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-cw-border bg-cw-elevated px-2 py-1 text-[12.5px] text-cw-text">
        <FileText className="h-3.5 w-3.5 shrink-0 text-cw-muted" aria-hidden="true" /><span className="truncate">{name}</span>
      </li>)}
    </ul>}
  </div>;
}
