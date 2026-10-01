'use client';

import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { profileCompleteness, type ProfileFormValues } from '@/lib/profile/profile-mappings';

/** How complete the profile is, and the next fields that most change what the AI writes and searches, each with its reason. */
export function ProfileCompleteness({ profile, onComplete }: { profile: ProfileFormValues; onComplete: (field: keyof ProfileFormValues) => void }) {
  const { done, total, percent, canDraft, missing } = profileCompleteness(profile);
  const next = missing.slice(0, 3);
  return (
    <section aria-labelledby="profile-progress-title" className="mb-4 rounded-[24px] border border-border/60 bg-card/90 p-5 dark:bg-card/75 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="profile-progress-title" className="text-sm font-semibold">Tu perfil: {done} de {total}</h2>
        <span className="text-xs text-muted-foreground">{percent === 100 ? 'Completo: la IA tiene todo para escribir a tu medida.' : 'Mientras más completo, más precisos los correos y las búsquedas.'}</span>
      </div>
      <Progress value={percent} className="mt-3 h-2" aria-label={`Perfil completo al ${percent} %`} />
      {!canDraft ? (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50/80 p-3 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
          Sin productos y servicios o una propuesta de valor, la IA no puede redactar tus correos. Complétalos con IA o escríbelos abajo.
        </p>
      ) : null}
      {next.length > 0 ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-3">
          {next.map((check) => (
            <li key={check.id} className="rounded-xl border border-border/60 bg-muted/20 p-3">
              <p className="text-sm font-medium">{check.label}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{check.why}</p>
              <Button type="button" variant="link" size="sm" className="mt-1 h-auto px-0 text-xs" onClick={() => onComplete(check.field)}>
                Completar<ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />Nada pendiente. Revísalo cuando cambie tu oferta.
        </p>
      )}
    </section>
  );
}
