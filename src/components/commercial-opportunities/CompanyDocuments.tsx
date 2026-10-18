'use client';
// «Documentos de la empresa» inside the tender profile: the folder with each file's expiry, a way to add one, renew its
// date and remove it. Files go up at once; they do not wait for «Guardar ficha».
import { useEffect, useState } from 'react';
import { Download, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { COMPANY_DOCUMENT_KINDS, companyDocumentLabel, companyDocumentStatus, suggestedExpiry, type CompanyDocument, type CompanyDocumentKind } from '@/lib/commercial-opportunities/company-documents';

const API = '/api/commercial-opportunities/company-documents';
const TONE = { vigente: 'text-cw-success', por_vencer: 'text-cw-warning', vencido: 'text-destructive', sin_fecha: 'text-muted-foreground' } as const;
async function json(response: Response) { const value = await response.json(); if (!response.ok) throw new Error(value.error || 'No se pudo completar la acción.'); return value; }

/** One document of the folder: its status in words, a download, and its date or removal right there. */
export function CompanyDocumentRow({ document, busy, onRenew, onDelete }: { document: CompanyDocument; busy: boolean;
  onRenew: (expiresAt: string | null) => void; onDelete: () => void }) {
  const [mode, setMode] = useState<'view' | 'renew' | 'delete'>('view');
  const [date, setDate] = useState(document.expiresAt || '');
  const { status } = companyDocumentStatus(document.expiresAt);
  return (
    <li className="space-y-2 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{document.label}</p>
          <p className={cn('text-xs', TONE[status])}>{companyDocumentLabel(document.expiresAt)}</p>
        </div>
        <a href={`${API}?document=${document.id}`} className="inline-flex h-7 shrink-0 items-center rounded-md px-2 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Descargar ${document.label}`}><Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Descargar</a>
      </div>
      {mode === 'view' ? (
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => setMode('renew')}>Cambiar vencimiento</Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" disabled={busy} onClick={() => setMode('delete')}>Quitar</Button>
        </div>
      ) : mode === 'renew' ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); onRenew(date || null); setMode('view'); }}>
          <div className="space-y-1"><Label htmlFor={`renew-${document.id}`} className="text-xs">Vence el</Label>
            <Input id={`renew-${document.id}`} type="date" value={date} onChange={event => setDate(event.target.value)} className="h-8 w-40 text-sm" /></div>
          <Button type="submit" size="sm" className="h-8" disabled={busy}>Guardar</Button>
          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setMode('view')}>Cancelar</Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs">
          <span>¿Quitar este documento?</span>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setMode('view')}>No</Button>
          <Button type="button" size="sm" variant="destructive" className="h-7 px-2 text-xs" disabled={busy} onClick={() => { setMode('view'); onDelete(); }}>Quitar</Button>
        </div>
      )}
    </li>
  );
}

/** The add form: kind, a name, the file and its expiry (suggested from the issue date for an F30 or a certificate). */
export function CompanyDocumentForm({ busy, onAdd }: { busy: boolean; onAdd: (input: { kind: CompanyDocumentKind; label: string; expiresAt: string; file: File }) => void }) {
  const [kind, setKind] = useState<CompanyDocumentKind>('f30');
  const [label, setLabel] = useState<string>(COMPANY_DOCUMENT_KINDS.f30.label);
  const [issued, setIssued] = useState('');
  const [expires, setExpires] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const lapses = Boolean(COMPANY_DOCUMENT_KINDS[kind].days);
  return (
    <form className="space-y-3 rounded-xl border p-3" onSubmit={event => { event.preventDefault(); if (file) onAdd({ kind, label: label.trim(), expiresAt: expires, file }); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="doc-kind">Documento</Label>
          <select id="doc-kind" value={kind} className="block h-10 w-full rounded-md border bg-background px-3 text-sm"
            onChange={event => { const next = event.target.value as CompanyDocumentKind; setKind(next); setLabel(COMPANY_DOCUMENT_KINDS[next].label); setExpires(issued ? suggestedExpiry(next, issued) || '' : ''); }}>
            {Object.entries(COMPANY_DOCUMENT_KINDS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
          </select></div>
        <div className="space-y-1.5"><Label htmlFor="doc-label">Nombre</Label>
          <Input id="doc-label" value={label} maxLength={200} onChange={event => setLabel(event.target.value)} /></div>
      </div>
      <p className="text-xs text-muted-foreground">{COMPANY_DOCUMENT_KINDS[kind].hint}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {lapses ? <div className="space-y-1.5"><Label htmlFor="doc-issued">Emitido el</Label>
          <Input id="doc-issued" type="date" value={issued} onChange={event => { setIssued(event.target.value); setExpires(suggestedExpiry(kind, event.target.value) || expires); }} /></div> : null}
        <div className="space-y-1.5"><Label htmlFor="doc-expires">Vence el {lapses ? '' : '(opcional)'}</Label>
          <Input id="doc-expires" type="date" value={expires} onChange={event => setExpires(event.target.value)} /></div>
      </div>
      <div className="space-y-1.5"><Label htmlFor="doc-file">Archivo (PDF o Word, hasta 20 MB)</Label>
        <Input id="doc-file" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => setFile(event.target.files?.[0] ?? null)} /></div>
      <Button type="submit" size="sm" variant="outline" disabled={busy || !file || label.trim().length < 2}>
        {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="mr-2 h-3.5 w-3.5" aria-hidden="true" />}Subir documento
      </Button>
    </form>
  );
}

export function CompanyDocuments() {
  const [documents, setDocuments] = useState<CompanyDocument[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const load = async () => {
    try { const value = await json(await fetch(API, { cache: 'no-store' })); setAvailable(value.available); setDocuments(value.documents); }
    catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudieron cargar los documentos.'); }
  };
  useEffect(() => { void load(); }, []);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true); setProblem('');
    try { await work(); await load(); } catch (e) { setProblem(e instanceof Error ? e.message : 'No se pudo guardar.'); } finally { setBusy(false); }
  };
  const add = (input: { kind: CompanyDocumentKind; label: string; expiresAt: string; file: File }) => act(async () => {
    const form = new FormData(); form.set('kind', input.kind); form.set('label', input.label); form.set('expiresAt', input.expiresAt); form.set('file', input.file);
    await json(await fetch(API, { method: 'POST', body: form })); setAdding(false);
  });
  const post = (body: unknown) => fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json);
  if (!available) return null;
  return (
    <section aria-labelledby="tp-documents" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 id="tp-documents" className="text-sm font-semibold">Documentos de la empresa</h3>
          <p className="text-xs text-muted-foreground">Los que piden casi todas las bases. Te avisamos antes de que venzan y la IA sabe cuáles tienes vigentes.</p>
        </div>
        {!adding ? <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(true)}>Agregar</Button> : null}
      </div>
      {problem ? <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{problem}</p> : null}
      {adding ? <CompanyDocumentForm busy={busy} onAdd={input => void add(input)} /> : null}
      {documents === null ? <p role="status" className="text-xs text-muted-foreground">Cargando documentos…</p>
        : !documents.length ? (!adding ? <p className="rounded-xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">Aún no hay documentos. Empieza por el F30 y el certificado de vigencia.</p> : null)
        : <ul className="divide-y rounded-xl border">{documents.map(document => <CompanyDocumentRow key={document.id} document={document} busy={busy}
            onRenew={expiresAt => void act(() => post({ action: 'update', id: document.id, kind: document.kind, label: document.label, expiresAt }))}
            onDelete={() => void act(() => post({ action: 'delete', id: document.id }))} />)}</ul>}
    </section>
  );
}
