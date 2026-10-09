'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Eye, EyeOff, FileText } from 'lucide-react';
import { coworkFileSize } from '@/lib/cowork/presentation';
import { CwButton } from './ui';

const PREVIEWABLE = new Set(['html', 'png', 'svg']);

export function coworkArtifactUrls(runId: string, name: string) {
  return {
    viewUrl: `/api/cowork/runs/${runId}/artifacts?name=${encodeURIComponent(name)}&view=1`,
    downloadUrl: `/api/cowork/runs/${runId}/artifacts?name=${encodeURIComponent(name)}`,
  };
}

/** Isolated preview of a generated artifact. HTML renders on demand inside a
 * sandboxed frame with an opaque origin (no allow-same-origin): it cannot
 * reach the app DOM, cookies or the network; the server also serves it with a
 * sandbox CSP. Images render as plain pictures. Anything else is download
 * only. */
export function ArtifactPreview({ runId, name, size, defaultOpen = false, onAccessDenied }: {
  runId: string; name: string; size?: number; defaultOpen?: boolean; onAccessDenied?: () => void;
}) {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const previewable = PREVIEWABLE.has(ext);
  const [open, setOpen] = useState(defaultOpen && previewable);
  const { viewUrl, downloadUrl } = coworkArtifactUrls(runId, name);
  const [preview, setPreview] = useState<{url:string;state:'loading'|'ready'|'error';error?:string;assembled?:boolean}|null>(null);
  const [retry, setRetry] = useState(0);
  const denied = useRef(onAccessDenied); denied.current = onAccessDenied;
  useEffect(() => {
    if (!open) {setPreview(null);return;}
    const controller=new AbortController();setPreview({url:viewUrl,state:'loading'});
    void fetch(viewUrl,{cache:'no-store',signal:controller.signal}).then(async response=>{
      if(response.status===401||response.status===403)denied.current?.();
      if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||'No se pudo abrir la vista previa.');}
      if(!controller.signal.aborted)setPreview({url:viewUrl,state:'ready',assembled:response.headers.get('X-ANTON-Preview')==='assembled-not-verified'});
    }).catch(error=>{if(!controller.signal.aborted)setPreview({url:viewUrl,state:'error',error:error instanceof Error?error.message:'No se pudo abrir la vista previa.'});});
    return()=>controller.abort();
  },[open,viewUrl,retry]);
  const ready=open&&preview?.url===viewUrl&&preview.state==='ready';
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-cw-border bg-cw-elevated px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cw-accent-soft text-cw-accent"><FileText className="h-[18px] w-[18px]" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <a className="block truncate text-[14px] font-medium text-cw-text underline-offset-2 hover:underline" href={downloadUrl}>{name}</a>
        <p className="text-[12px] text-cw-muted">{ext ? ext.toUpperCase() : 'Archivo'}{typeof size === 'number' ? ` · ${coworkFileSize(size)}` : ''}</p>
      </div>
      <div className="flex gap-1.5">
        {previewable && <CwButton size="sm" variant="ghost" onClick={() => setOpen(value => !value)} aria-expanded={open}>
          {open ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}{open ? 'Ocultar vista previa' : 'Vista previa'}
        </CwButton>}
        <a href={downloadUrl} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-cw-border bg-cw-elevated px-3 text-[13px] font-medium text-cw-text hover:bg-cw-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">
          <Download className="h-4 w-4" aria-hidden="true" />Descargar
        </a>
      </div>
    </div>
    {open && (!preview || preview.url!==viewUrl || preview.state==='loading') && <p role="status" className="text-[13px] text-cw-muted">Preparando la vista previa…</p>}
    {open && preview?.url===viewUrl&&preview.state==='error'&&<div role="alert" className="space-y-2 rounded-xl border border-cw-border bg-cw-panel p-3 text-[13px] text-cw-danger">
      <p>{preview.error}</p><CwButton size="sm" variant="secondary" onClick={()=>setRetry(value=>value+1)}>Reintentar vista previa</CwButton>
    </div>}
    {ready && (ext === 'html'
      ? <iframe title={`Vista previa de ${name}`} src={viewUrl} sandbox="allow-scripts allow-forms"
          className="h-[60vh] min-h-80 w-full rounded-2xl border border-cw-border bg-cw-elevated" />
      // eslint-disable-next-line @next/next/no-img-element
      : <img src={viewUrl} alt={`Vista previa de ${name}`} className="max-h-[60vh] w-auto max-w-full rounded-2xl border border-cw-border bg-cw-elevated" />)}
    {open && ext === 'html' && <p className="text-[12px] text-cw-muted">Vista aislada: sin acceso a la app ni a la red.</p>}
    {ready&&preview.assembled&&<p className="text-[12px] text-cw-muted">Usa los archivos de la misma versión publicada. Revisa el resultado antes de utilizarlo.</p>}
    {!previewable && <p className="text-[12.5px] text-cw-muted">Este formato no tiene vista previa. Descárgalo para abrirlo.</p>}
  </div>;
}
