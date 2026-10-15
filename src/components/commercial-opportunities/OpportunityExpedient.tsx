'use client';
// The expediente of one opportunity: what the AI already has, how to add the bases (Mercado Público protects them with a
// «No soy un robot», so the person downloads them in a minute), where to drop them, and the report's progress.
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, ExternalLink, FileText, Loader2, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { friendlyJobError, statusLabel } from '@/lib/commercial-opportunities/report-view';

export const ACCEPTED_FILES = '.pdf,.docx,.doc,.xlsx,.xls,.txt,.md,.csv';
export type ExpedientDocument = { id: string; name: string; extraction_status: string; source_kind: string; source_url: string | null; pages_read: number | null; pages_total: number | null; created_at: string };
export type PublicLinks = { ficha: string; attachments: string | null; forum: string | null; forms: number; code: string | null } | null;
type Upload = { name: string; state: 'uploading' | 'done' | 'error'; message?: string };

/** The public links of a Mercado Público tender, read once when its expediente opens. */
export function usePublicLinks(id: string | null, kind: string | undefined) {
  const [links, setLinks] = useState<PublicLinks>(null);
  useEffect(() => {
    setLinks(null);
    if (!id || kind !== 'tender') return;
    const controller = new AbortController();
    fetch(`/api/commercial-opportunities/${id}/sources`, { signal: controller.signal, cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).then(body => { if (!controller.signal.aborted) setLinks(body?.links ?? null); }).catch(() => undefined);
    return () => controller.abort();
  }, [id, kind]);
  return links;
}

/** Drag the files here, or choose them. Each file shows whether it was added or why not. */
export function DocumentDrop({ onUpload, disabled, compact }: { onUpload: (files: File[], report: (u: Upload[]) => void) => Promise<void>; disabled?: boolean; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const send = async (list: FileList | null) => { const files = Array.from(list || []); if (!files.length || disabled) return; await onUpload(files, setUploads); if (input.current) input.current.value = ''; };
  return <div>
    <div role="button" tabIndex={0} aria-label="Subir bases y anexos" aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) { e.preventDefault(); input.current?.click(); } }}
      onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); void send(e.dataTransfer.files); }}
      className={cn('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
        compact ? 'px-4 py-5' : 'px-6 py-8', over ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40', disabled && 'cursor-not-allowed opacity-60')}>
      <UploadCloud className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">Arrastra aquí las bases y anexos</p>
      <p className="text-xs text-muted-foreground">o haz clic para elegirlos · PDF, Word o Excel, hasta 20 MB cada uno</p>
    </div>
    <input ref={input} id="op-document" type="file" multiple accept={ACCEPTED_FILES} className="sr-only" onChange={e => void send(e.target.files)} />
    {uploads.length > 0 && <ul className="mt-3 space-y-1.5 text-sm" aria-live="polite">{uploads.map((u, i) => <li key={i} className="flex items-start gap-2">
      {u.state === 'uploading' ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
        : u.state === 'done' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cw-success" aria-hidden="true" /> : <span aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-center text-destructive">!</span>}
      <span className="min-w-0"><span className="break-words">{u.name}</span>{u.state === 'error' && <span className="block text-xs text-destructive">{u.message}</span>}{u.state === 'uploading' && <span className="block text-xs text-muted-foreground">Subiendo y leyendo…</span>}</span>
    </li>)}</ul>}
  </div>;
}

/** «Prepara el informe completo»: the four steps to add a tender's bases, or the plain upload for a received invitation. */
export function ExpedientGuide({ kind, url, links, documents, onUpload, onGenerate, generating, hasReport, busy, closed }: {
  kind: string; url: string | null; links: PublicLinks; documents: ExpedientDocument[]; onUpload: (files: File[], report: (u: Upload[]) => void) => Promise<void>;
  onGenerate: () => void; generating: boolean; hasReport: boolean; busy: boolean; closed?: string | null;
}) {
  const uploaded = documents.filter(d => d.source_kind === 'upload');
  const publicTender = kind === 'tender' && Boolean(url);
  const attachments = links?.attachments || url;
  if (kind === 'hiring' || kind === 'linkedin_post') return <section aria-labelledby="guide-title" className="rounded-2xl border bg-background p-5 sm:p-6">
    <h2 id="guide-title" className="text-lg font-semibold">Prepara la ficha comercial</h2>
    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">La IA revisa esta señal de LinkedIn y te dice si conviene contactar, a quién, con qué ángulo y con un primer mensaje listo.</p>
    <Button className="mt-4" onClick={onGenerate} disabled={generating || busy}>{generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}{hasReport ? 'Actualizar ficha comercial' : 'Generar ficha comercial'}</Button>
  </section>;
  return <section aria-labelledby="guide-title" className="rounded-2xl border bg-background p-5 sm:p-6">
    <h2 id="guide-title" className="text-lg font-semibold">{hasReport ? 'Completa el expediente' : 'Prepara el informe completo'}</h2>
    {closed && <p className="mt-2 rounded-xl bg-muted px-3 py-2 text-sm">Esta licitación cerró el {closed}: ya no se puede postular. El informe sirve para revisarla o como referencia para la próxima.</p>}
    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
      {publicTender ? 'La IA lee las bases y anexos para decirte si conviene postular, qué piden y qué hacer. Mercado Público protege esos archivos con un «No soy un robot», así que los descargas tú: toma un minuto.'
        : 'Sube la invitación, las bases y los anexos que recibiste. La IA los lee para decirte si conviene postular, qué piden y qué hacer.'}
    </p>
    <ol className="mt-5 space-y-5">
      {publicTender && <>
        <Step n={1} title="Abre los anexos de esta licitación">
          <Button asChild variant="outline" size="sm"><a href={attachments!} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />{links?.attachments ? 'Abrir «Ver anexos» en Mercado Público' : 'Abrir la licitación en Mercado Público'}</a></Button>
          <p className="mt-2 text-xs text-muted-foreground">{links?.attachments ? 'Se abre en otra pestaña con la lista de archivos.' : 'En la ficha, pulsa «Ver anexos» (ícono de documentos, arriba a la derecha).'} Si aparece «No soy un robot», márcalo.</p>
        </Step>
        <Step n={2} title="Descarga las bases y anexos">
          <p className="text-sm text-muted-foreground">Pulsa el ícono de descarga de cada archivo: bases administrativas, bases técnicas, anexos y aclaraciones. Quedan en tu carpeta Descargas.</p>
        </Step>
      </>}
      <Step n={publicTender ? 3 : 1} title={publicTender ? 'Súbelos aquí' : 'Sube los documentos'} done={uploaded.length > 0}>
        <DocumentDrop onUpload={onUpload} disabled={busy} compact />
        {uploaded.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{uploaded.length === 1 ? '1 documento subido' : `${uploaded.length} documentos subidos`}: {uploaded.map(d => d.name).join(', ')}</p>}
      </Step>
      <Step n={publicTender ? 4 : 2} title={hasReport ? 'Actualiza el informe' : 'Genera el informe'}>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onGenerate} disabled={generating || busy}>{generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {hasReport ? 'Actualizar informe' : uploaded.length || !publicTender ? 'Generar informe completo' : 'Generar informe sin bases'}</Button>
          {publicTender && !uploaded.length && !hasReport && <span className="text-xs text-muted-foreground">Sin bases el informe se arma solo con la ficha, los formularios y el foro.</span>}
        </div>
      </Step>
    </ol>
    {publicTender && <p className="mt-5 border-t pt-4 text-xs text-muted-foreground">Al generar el informe incorporamos solos la ficha oficial, los formularios para ofertar y las preguntas del foro de Mercado Público.</p>}
  </section>;
}
function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
    <span aria-hidden="true" className={cn('flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold', done ? 'bg-cw-success-soft text-cw-success' : 'bg-muted text-foreground')}>{done ? '✓' : n}</span>
    <div className="min-w-0"><h3 className="text-sm font-semibold leading-7">{title}</h3><div className="mt-1">{children}</div></div>
  </li>;
}

/** Where each document came from, in the words of this kind of opportunity. */
const sourceGroups = (kind?: string): Array<[string, string]> => [['upload', 'Subidos por tu equipo'],
  ['official', kind === 'tender' || kind === 'compra_agil' ? 'Traídos de Mercado Público' : kind === 'hiring' || kind === 'linkedin_post' ? 'Datos de la señal' : 'Traídos de la fuente'],
  ['public_web', 'Traídos de la web'], ['pasted', 'Texto recibido']];
/** The documents of the expediente, grouped by where they came from, with how much was read. */
export function DocumentList({ id, documents, kind }: { id: string; documents: ExpedientDocument[]; kind?: string }) {
  if (!documents.length) return <p className="rounded-2xl border p-5 text-sm text-muted-foreground">Todavía no hay documentos. Los que subas o traigamos de Mercado Público aparecerán aquí.</p>;
  return <div className="space-y-5">{sourceGroups(kind).map(([source, label]) => {
    const list = documents.filter(d => d.source_kind === source); if (!list.length) return null;
    return <section key={source} aria-label={label}><h3 className="mb-2 text-sm font-semibold">{label} <span className="font-normal tabular-nums text-muted-foreground">{list.length}</span></h3>
      <ul className="divide-y rounded-2xl border">{list.map(d => <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
        <span className="flex min-w-0 items-start gap-2"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0"><span className="block break-words text-sm font-medium">{d.name}</span>
            <span className={cn('text-xs', d.extraction_status === 'read' ? 'text-muted-foreground' : 'text-cw-warning')}>{statusLabel(d.extraction_status)}{d.pages_total ? ` · ${d.pages_read} de ${d.pages_total} páginas` : ''}</span></span></span>
        <span className="flex gap-2">
          {d.source_kind === 'official' && d.source_url && /\(texto del (Word|Excel)\)/.test(d.name) && <Button asChild variant="ghost" size="sm"><a href={d.source_url} target="_blank" rel="noopener noreferrer">Original</a></Button>}
          <Button asChild variant="outline" size="sm"><a href={`/api/commercial-opportunities/${id}/documents?document=${d.id}`}><Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Descargar</a></Button>
        </span>
      </li>)}</ul></section>;
  })}</div>;
}

/** While the report is being prepared: what is happening and how long it usually takes. `pending`: the retry was sent and
 * its answer is on its way, so the button says so instead of looking untouched for the seconds the reload takes. */
export function ReportProgress({ state, error, signal, pending = false, onRetry }: { state: string; error?: string | null; signal?: boolean; pending?: boolean; onRetry: () => void }) {
  if (state === 'failed' || state === 'blocked') return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/40 p-4 text-sm">
    <p><span className="font-medium">No pudimos terminar {signal ? 'la ficha comercial' : 'el informe'}.</span> {friendlyJobError(error)}</p>
    <Button size="sm" variant="outline" onClick={onRetry} disabled={pending} aria-busy={pending}>{pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}{pending ? 'Reintentando…' : 'Intentar de nuevo'}</Button></div>;
  return <div role="status" className="rounded-2xl border bg-muted/30 p-4">
    <p className="flex items-center gap-2 text-sm font-medium"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{state === 'queued' ? 'En cola: empieza en menos de un minuto' : signal ? 'Analizando la señal y preparando la ficha…' : 'Leyendo los documentos y redactando el informe…'}</p>
    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-1/3 animate-pulse rounded-full bg-primary" /></div>
    <p className="mt-2 text-xs text-muted-foreground">Suele tardar entre {signal ? '1 y 3' : '2 y 5'} minutos. Puedes seguir trabajando: {signal ? 'la ficha' : 'el informe'} aparecerá aquí y te avisaremos.</p>
  </div>;
}
