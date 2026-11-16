'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { authenticatedApiFetch } from '@/lib/authenticated-api-fetch';
import { LeadDropFlow } from './LeadDropFlow';

/**
 * «Tus contactos de hoy» as the menu opens it, under «Hoy» (16 Nov 2026, the owner: «que sea una subsección de Hoy, para que todo
 * conviva en la misma app y los usuarios puedan entrar a Cowork y todo eso»): the person's last contacts of the week, shown by the
 * same screen their emails open (LeadDropFlow). Without any, it says so and sends to «Hoy», where the next ones are offered.
 */
export function LatestDrop() {
  const { organizationId, loading: authLoading } = useAuth();
  const [state, setState] = useState<{ id: string | null } | 'error' | null>(null);
  const load = useCallback(async () => {
    if (!organizationId) return;
    setState(null);
    try {
      const response = await authenticatedApiFetch('/api/lead-drops/latest', { cache: 'no-store', headers: { 'x-organization-id': organizationId } });
      if (!response.ok) throw new Error('unavailable');
      const body = await response.json();
      setState({ id: typeof body?.latestId === 'string' ? body.latestId : null });
    } catch { setState('error'); }
  }, [organizationId]);
  useEffect(() => { void load(); }, [load]);

  if (state && state !== 'error' && state.id) return <LeadDropFlow key={state.id} dropId={state.id} />;
  const waiting = state === null && (authLoading || Boolean(organizationId));
  return <div className="mx-auto w-full max-w-3xl">
    <PageHeader title="Tus contactos de hoy" back={{ href: '/dashboard', label: 'Hoy' }} description="Las personas que elegimos para ti con tu cliente ideal, cada una con su campaña lista." />
    {waiting ? <p role="status" className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Abriendo tus contactos…</p>
      : state === 'error' || !state ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-5">
        <p role="alert" className="text-sm text-muted-foreground">No pudimos abrir tus contactos. Revisa tu conexión y vuelve a intentarlo.</p>
        <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />Reintentar</Button>
      </div>
      : <EmptyState icon={Sparkles} title="Esta semana no tienes contactos nuevos"
        description="Cuando te toquen, aparecen aquí y te llegan a tu correo, cada uno con por qué te lo recomendamos y su campaña escrita."
        action={<Button asChild><Link href="/dashboard">Ir a Hoy</Link></Button>} />}
  </div>;
}
