'use client';

import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { dropHref } from '@/lib/lead-drops';
import { usePersonalHome } from './usePersonalHome';

type Response = { drop: { id: string; dropDate: string; total: number; left: number } | null };

/** «Contactos de la semana» in «Hoy» while some are left to save (src/lib/lead-drops.ts); nothing otherwise. */
export function LeadDropBanner() {
  const { data } = usePersonalHome<Response>('/api/lead-drops/latest');
  const drop = data?.drop;
  if (!drop) return null;
  return <Card className="rounded-2xl border-primary/25 bg-primary/5">
    <CardContent className="space-y-3 p-4">
      <div className="space-y-1">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />Contactos de la semana</h2>
        <p className="text-sm text-muted-foreground">{drop.left === drop.total
          ? `${drop.total === 1 ? 'Un contacto nuevo' : `${drop.total} contactos nuevos`} para ti, con correo verificado. Guardarlos no gasta créditos.`
          : `Te ${drop.left === 1 ? 'falta guardar 1' : `faltan guardar ${drop.left}`} de ${drop.total}.`}</p>
      </div>
      <Button asChild size="sm" className="w-full justify-between"><Link href={dropHref(drop.id)}>Ver y guardar<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
    </CardContent>
  </Card>;
}
