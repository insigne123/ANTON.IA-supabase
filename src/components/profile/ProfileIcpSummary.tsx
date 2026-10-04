'use client';

import Link from 'next/link';
import { ArrowRight, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { icpSummary } from '@/lib/profile/icp-summary';

const SHOWN = 3;

/**
 * Who the search looks for, at the top of Perfil (Plan 9, PR-19): the ideal customer at a glance, «Editar» to jump to its
 * fields and «Buscar prospectos», which starts from it. With unsaved changes the search would use the old values, so it
 * asks to save first.
 */
export function ProfileIcpSummary({ profile, dirty, onEdit }: {
  profile: Parameters<typeof icpSummary>[0];
  dirty: boolean;
  onEdit: () => void;
}) {
  const { defined, rows } = icpSummary(profile);
  return (
    <section aria-labelledby="profile-icp-summary-title" className="mb-4 rounded-[24px] border border-border/60 bg-card/90 p-5 dark:bg-card/75 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id="profile-icp-summary-title" className="flex items-center gap-2 text-sm font-semibold">
            <Target className="h-4 w-4 text-primary" aria-hidden="true" />Tu cliente ideal
          </h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {defined
              ? 'A quién buscamos cuando partes de «Tu cliente ideal» en Búsqueda.'
              : 'Aún no defines a quién le vendes. Con cargos o industrias, Búsqueda parte desde aquí.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={defined ? 'ghost' : 'outline'} size="sm" className="rounded-xl" onClick={onEdit}>
            {defined ? 'Editar' : 'Definir mi cliente ideal'}
          </Button>
          {defined && !dirty ? (
            <Button asChild variant="outline" size="sm" className="rounded-xl">
              <Link href="/search">Buscar prospectos<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </Button>
          ) : null}
        </div>
      </div>
      {defined ? (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((row) => (
            <div key={row.id} className="min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {row.values.length > 0 ? (
                  <>
                    {row.values.slice(0, SHOWN).map((value) => (
                      <span key={value} className="max-w-full truncate rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">{value}</span>
                    ))}
                    {row.values.length > SHOWN ? <span className="px-1 py-0.5 text-xs text-foreground/70">+{row.values.length - SHOWN}</span> : null}
                  </>
                ) : <span className="text-sm text-foreground/70">{row.empty}</span>}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {defined && dirty ? <p className="mt-3 text-xs text-foreground/70" role="status">Guarda los cambios para buscar con ellos.</p> : null}
    </section>
  );
}
