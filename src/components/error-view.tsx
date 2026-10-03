'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';

/** What a person sees when a screen fails to render: what happened, a retry and a way out. Never the raw error. */
export function ErrorView({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div role="alert" className="flex min-h-[60vh] items-center justify-center px-4 py-16">
      <div className="max-w-md text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-cw-danger-soft text-rose-800 dark:text-rose-200">
          <TriangleAlert className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground">Esta pantalla no se pudo cargar</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Algo falló al mostrarla. Tus datos no se perdieron: vuelve a intentarlo y, si se repite, escríbenos con la hora en que pasó.
        </p>
        {error.digest ? <p className="mt-2 font-mono text-xs text-muted-foreground">Código: {error.digest}</p> : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={reset}>Reintentar</Button>
          <Button asChild variant="outline"><Link href="/">Ir a Hoy</Link></Button>
        </div>
      </div>
    </div>
  );
}
