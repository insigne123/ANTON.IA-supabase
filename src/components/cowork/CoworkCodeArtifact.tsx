'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTheme } from 'next-themes';
import { LoaderCircle, Send, TriangleAlert, Wrench } from 'lucide-react';
import type { CoworkArtifact } from '@/lib/cowork/presentation';
import {
  coworkArtifactChangeMessage, coworkArtifactFixMessage, coworkArtifactFrameMessage, coworkArtifactFrameUrl, coworkArtifactThemeMessage,
} from '@/lib/cowork/code-artifact-frame';
import { coworkArtifactUrls } from './ArtifactPreview';
import { CwButton } from './ui';

type CodeArtifact = Extract<CoworkArtifact, { kind: 'code' }>;
type FrameState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string; line: number | null } | { kind: 'escaped' };

/**
 * A code artifact on the canvas (Plan 12, 3b): the page the Designer wrote, in a sandboxed frame with an
 * opaque origin (no app, cookies or network; the page frames only itself), following the app's theme.
 * When it fails it says so and offers «Arreglarlo»; below it, «Pedir cambios» sends a change tied to it.
 */
export function CoworkCodeArtifact({ artifact, onSend, sendHint }: {
  artifact: CodeArtifact;
  /** Sends a message to the conversation; null while one cannot be sent (a turn is running). */
  onSend: ((message: string) => void) | null;
  sendHint?: string;
}) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light';
  const frame = useRef<HTMLIFrameElement>(null);
  const loads = useRef(0);
  const [state, setState] = useState<FrameState>({ kind: 'loading' });
  const [change, setChange] = useState('');
  const { viewUrl, downloadUrl } = coworkArtifactUrls(artifact.runId, artifact.name);
  // The address keeps the theme it opened with: later changes travel by message, without reloading the frame.
  const [src] = useState(() => coworkArtifactFrameUrl(viewUrl, theme, typeof window === 'undefined' ? '' : window.location.origin));

  useEffect(() => {
    loads.current = 0;
    setState({ kind: 'loading' });
    const onMessage = (event: MessageEvent) => {
      const message = coworkArtifactFrameMessage(event, frame.current?.contentWindow ?? null);
      if (!message) return;
      if (message.type === 'error') setState({ kind: 'error', message: message.message, line: message.line });
      else setState(current => (current.kind === 'loading' ? { kind: 'ready' } : current));
    };
    window.addEventListener('message', onMessage);
    // A page that never says it is ready still shows after a few seconds (an old browser, a slow phone).
    const fallback = window.setTimeout(() => setState(current => (current.kind === 'loading' ? { kind: 'ready' } : current)), 6000);
    return () => { window.removeEventListener('message', onMessage); window.clearTimeout(fallback); };
  }, [artifact.id]);

  useEffect(() => {
    frame.current?.contentWindow?.postMessage(coworkArtifactThemeMessage(theme), '*');
  }, [theme]);

  function onLoad() {
    loads.current += 1;
    // The frame only loads once: a second load is the artifact trying to leave its page, and it goes away.
    if (loads.current > 1) setState({ kind: 'escaped' });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!onSend || !change.trim()) return;
    onSend(coworkArtifactChangeMessage(artifact, change));
    setChange('');
  }

  return <div className="flex h-full min-h-0 flex-col">
    {state.kind === 'error' && <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-cw-border bg-cw-danger-soft px-4 py-2.5 text-[13px] text-cw-danger">
      <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1"><b className="font-semibold">Este artefacto falló.</b> {state.message}{state.line ? ` (línea ${state.line})` : ''}</span>
      {onSend && <CwButton size="sm" variant="secondary" onClick={() => onSend(coworkArtifactFixMessage(artifact, state))}>
        <Wrench aria-hidden="true" />Arreglarlo
      </CwButton>}
    </div>}
    <div className="relative min-h-0 flex-1 bg-cw-panel">
      {state.kind === 'escaped'
        ? <div className="flex h-full items-center justify-center p-6 text-center text-[14px] text-cw-muted">
          <p>Detuvimos este artefacto porque intentó salir de su espacio. <a className="font-medium text-cw-accent underline-offset-2 hover:underline" href={downloadUrl}>Descarga el archivo</a> para revisarlo.</p>
        </div>
        : <iframe ref={frame} key={artifact.id} title={artifact.title} src={src} sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={onLoad}
          className="h-full w-full border-0" />}
      {state.kind === 'loading' && <div aria-live="polite" className="pointer-events-none absolute inset-0 flex items-center justify-center bg-cw-panel text-[13px] text-cw-muted">
        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Dibujando el artefacto…
      </div>}
    </div>
    <form onSubmit={submit} className="flex shrink-0 items-center gap-2 border-t border-cw-border bg-cw-elevated px-3 py-2.5 sm:px-4">
      <label htmlFor={`cambios-${artifact.id}`} className="sr-only">Pedir cambios a este artefacto</label>
      <input id={`cambios-${artifact.id}`} value={change} onChange={event => setChange(event.target.value)} maxLength={500}
        placeholder={onSend ? 'Pide un cambio: «agrega un gráfico por mes», «solo minería»…' : (sendHint || 'Espera a que Cowork termine para pedir cambios')}
        disabled={!onSend}
        className="h-9 min-w-0 flex-1 rounded-[10px] border border-cw-border bg-cw-elevated px-3 text-[14px] text-cw-text placeholder:text-cw-faint focus-visible:border-cw-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] disabled:opacity-60" />
      <CwButton type="submit" size="sm" variant="primary" disabled={!onSend || !change.trim()}>
        <Send aria-hidden="true" />Pedir cambios
      </CwButton>
    </form>
  </div>;
}
