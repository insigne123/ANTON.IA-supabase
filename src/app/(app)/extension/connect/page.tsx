'use client';

import { useEffect, useState } from 'react';
import { Puzzle, CheckCircle2, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ExtensionConnectPage() {
  const [status, setStatus] = useState<'idle' | 'pending' | 'connected' | 'error'>('idle');
  const [error, setError] = useState('');
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
  return <main className="mx-auto flex min-h-[65vh] max-w-lg items-center px-5 py-12">
    <section className="w-full rounded-3xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300"><Puzzle aria-hidden="true" /></div>
      <h1 className="text-2xl font-semibold tracking-tight">Anton.IA, junto a LinkedIn.</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Conecta la extensión para guardar perfiles, investigar contactos y preparar mensajes con tu cuenta y organización actuales.</p>
      <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">Mantén esta pestaña abierta mientras trabajas. Puedes desconectar desde el panel en cualquier momento.</p>
      {status === 'connected' ? <p role="status" className="mt-6 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 aria-hidden="true" className="size-5" />Conectada. Vuelve al perfil de LinkedIn.</p>
        : <Button className="mt-6 w-full" disabled={status === 'pending'} onClick={() => {
          setStatus('pending'); setError('');
          window.postMessage({ type: 'ANTON_PROSPECT_APPROVE', nonce: location.hash.slice(1) }, location.origin);
        }}>{status === 'pending' ? 'Conectando…' : 'Conectar mi cuenta'}<ArrowUpRight className="ml-2 size-4" aria-hidden="true" /></Button>}
      {status === 'error' && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
    </section>
  </main>;
}
