import Link from 'next/link';
import { Compass } from 'lucide-react';

import { Button } from '@/components/ui/button';

export const metadata = { title: 'Página no encontrada' };

/** Any address the app does not have, or a page this account cannot open. */
export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div className="max-w-md text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <Compass className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground">No encontramos esta página</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          La dirección no existe o tu cuenta no tiene acceso a ella. Si llegaste desde un enlace guardado, puede que la pantalla haya cambiado de lugar.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild><Link href="/">Ir a Hoy</Link></Button>
          <Button asChild variant="outline"><Link href="/ayuda">Centro de ayuda</Link></Button>
        </div>
      </div>
    </main>
  );
}
