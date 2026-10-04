'use client';

import { useEffect, useState } from 'react';
import { Puzzle, CheckCircle2, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

// The extension opens this page with a one-time code in the hash (#nonce). Without it the approval cannot work, so the page
// says so at once instead of waiting for the 15 s timeout (Plan 9, PR-19).
const MISSING_NONCE = 'Abre esta página desde el panel de la extensión: el enlace no trae el código de conexión.';

export default function ExtensionConnectPage() {
  const [status, setStatus] = useState<'idle' | 'pending' | 'connected' | 'error'>('idle');
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState<string | null>(null);
  useEffect(() => {
    // Sent exactly as the bridge compares it (prospecting-bridge.js: event.data.nonce !== location.hash.slice(1)).
    const value = window.location.hash.slice(1);
    setNonce(value);
    if (!value.trim()) { setStatus('error'); setError(MISSING_NONCE); }
  }, []);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'ANTON_PROSPECT_CONNECTED') return;
      setStatus(event.data.ok ? 'connected' : 'error');
      setError(event.data.error || 'Abre esta página desde el panel de la extensión.');
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
  useEffect(() => {
    if (status !== 'pending') return;
    const timer = setTimeout(() => { setStatus('error'); setError('La extensión no respondió. Recárgala y vuelve a conectar desde su panel.'); }, 15000);
    return () => clearTimeout(timer);
  }, [status]);
  return <div className="mx-auto flex min-h-[65vh] max-w-lg items-center px-5 py-12">
    <section className="w-full rounded-3xl border border-border bg-card p-8 shadow-sm">
      <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-cw-accent-soft text-primary"><Puzzle aria-hidden="true" /></div>
      <h1 className="text-2xl font-semibold tracking-tight">ANTON.IA, junto a LinkedIn</h1>
      <p className="mt-3 text-sm leading-6 text-foreground/70">Conecta la extensión para guardar perfiles, investigar contactos y preparar mensajes con tu cuenta y organización actuales.</p>
      <p className="mt-4 text-sm leading-6 text-foreground/70">Después de conectar puedes cerrar esta pestaña. La conexión usa tu sesión de ANTON.IA y puedes desconectarla desde el panel de la extensión cuando quieras.</p>
      {status === 'connected' ? <p role="status" className="mt-6 flex items-center gap-2 text-sm text-cw-success"><CheckCircle2 aria-hidden="true" className="size-5" />Conectada. Vuelve al perfil de LinkedIn.</p>
        : <Button className="mt-6 w-full" disabled={status === 'pending' || !nonce} onClick={() => {
          if (!nonce) return;
          setStatus('pending'); setError('');
          window.postMessage({ type: 'ANTON_PROSPECT_APPROVE', nonce }, location.origin);
        }}>{status === 'pending' ? 'Conectando…' : 'Conectar mi cuenta'}<ArrowUpRight className="ml-2 size-4" aria-hidden="true" /></Button>}
      {status === 'error' && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </section>
  </div>;
}
