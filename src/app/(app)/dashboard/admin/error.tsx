'use client';

import { CircleAlert, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function AdminDashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[1320px] pb-10">
      <Card className="rounded-[24px] border-destructive/25 bg-card/90">
        <CardContent className="flex flex-col items-start gap-5 p-6 sm:p-8">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <CircleAlert className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">No pudimos abrir Administración</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              La información no está disponible en este momento. Intenta cargarla nuevamente.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={reset} className="rounded-xl">
            <RefreshCw aria-hidden="true" /> Reintentar
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
