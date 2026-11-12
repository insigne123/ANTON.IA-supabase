'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { CheckCircle2, CircleHelp, ExternalLink, Loader2, UserRoundSearch, XCircle } from 'lucide-react';
import { InitialsAvatar } from '@/components/initials-avatar';
import { Button } from '@/components/ui/button';
import { safeAvatarUrl } from '@/lib/avatar';
import { decideIdentityReview, fetchIdentityReview } from '@/lib/leads-client';
import { IDENTITY_VERDICT_LABEL, type IdentityReviewCheck, type IdentityReviewView } from '@/lib/search/identity-review';
import type { Lead } from '@/lib/schemas/leads';

const CHECK_ICON: Record<IdentityReviewCheck['status'], { Icon: typeof CheckCircle2; tone: string; label: string }> = {
  ok: { Icon: CheckCircle2, tone: 'text-cw-success', label: 'Coincide' },
  doubt: { Icon: CircleHelp, tone: 'text-cw-warning', label: 'Con dudas' },
  no: { Icon: XCircle, tone: 'text-destructive', label: 'No coincide' },
};

/**
 * Apollo answered a LinkedIn profile search with someone at another address (src/lib/server/identity-reviews.ts). The person sees whom it
 * found, can open both profiles, reads what the AI makes of it, and decides. «Es la misma persona» brings the contact already paid for.
 */
export function IdentityReviewCard({ review: initial, onAccepted, onRejected, onDismiss }: {
  review: IdentityReviewView;
  onAccepted: (lead: Lead) => void;
  onRejected: () => void;
  onDismiss: () => void;
}) {
  const [review, setReview] = useState(initial);
  const [judging, setJudging] = useState(!initial.verdict);
  const [deciding, setDeciding] = useState<'same' | 'different' | null>(null);
  const [failure, setFailure] = useState('');

  useEffect(() => {
    if (initial.verdict) return;
    const controller = new AbortController();
    fetchIdentityReview(initial.id, controller.signal)
      .then((next) => setReview(next))
      .catch(() => undefined)
      .finally(() => { if (!controller.signal.aborted) setJudging(false); });
    return () => controller.abort();
  }, [initial.id, initial.verdict]);

  const decide = async (decision: 'same' | 'different') => {
    setDeciding(decision);
    setFailure('');
    try {
      const result = await decideIdentityReview(review.id, decision, review.requestedLinkedinUrl);
      if (decision === 'same' && result.lead) onAccepted(result.lead);
      else onRejected();
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      setFailure(code === 'IDENTITY_REVIEW_NOT_FOUND' ? 'Esta revisión ya venció. Busca el perfil de nuevo.'
        : code === 'IDENTITY_REVIEW_DECIDED' ? 'Ya respondiste esta revisión.'
          : code === 'IDENTITY_REVIEW_BOUND_TO_OTHER' ? 'Esa dirección ya está asociada a otra persona en tu equipo.'
            : 'No pudimos guardar tu respuesta. Prueba de nuevo.');
    } finally {
      setDeciding(null);
    }
  };

  const person = review.candidate;
  const photo = safeAvatarUrl(person.photoUrl);
  const place = [person.city, person.country].filter(Boolean).join(', ');
  const role = [person.title, person.organizationName].filter(Boolean).join(' · ');
  const verdict = review.verdict;

  return (
    <section aria-labelledby="identity-review-title" data-testid="identity-review"
      className="mb-4 space-y-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
      <div className="space-y-1">
        <h2 id="identity-review-title" className="flex items-center gap-2 text-base font-semibold">
          <UserRoundSearch className="h-4 w-4 text-primary" aria-hidden="true" />
          ¿Es la misma persona?
        </h2>
        <p className="text-sm text-foreground/70">
          Apollo encontró a esta persona con otra dirección de LinkedIn. Suele pasar cuando alguien la cambia.
        </p>
      </div>

      <div className="flex items-center gap-3">
        {photo ? (
          <Image src={photo} width={48} height={48} className="h-12 w-12 shrink-0 rounded-full object-cover" alt="" unoptimized />
        ) : (
          <InitialsAvatar name={person.fullName} size="lg" />
        )}
        <div className="min-w-0">
          <p className="truncate font-medium">{person.fullName || 'Sin nombre'}</p>
          {role ? <p className="text-sm text-foreground/70">{role}</p> : null}
          {place ? <p className="truncate text-xs text-foreground/60">{place}</p> : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <a href={review.requestedLinkedinUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
          Perfil que pegaste <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
        {person.linkedinUrl ? (
          <a href={person.linkedinUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
            Perfil que encontró Apollo <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ) : null}
      </div>

      <div className="rounded-xl bg-muted/50 p-3" aria-live="polite">
        {judging && !verdict ? (
          <p className="flex items-center gap-2 text-sm text-foreground/70">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> La IA está comparando los dos perfiles…
          </p>
        ) : verdict ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{IDENTITY_VERDICT_LABEL[verdict.verdict]}</p>
            {verdict.summary ? <p className="text-sm text-foreground/70">{verdict.summary}</p> : null}
            {verdict.checks.length ? (
              <ul className="space-y-1.5">
                {verdict.checks.slice(0, 4).map((check, index) => {
                  const { Icon, tone, label } = CHECK_ICON[check.status];
                  return (
                    <li key={index} className="flex items-start gap-2 text-sm">
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} aria-label={label} />
                      <span>{check.text}</span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-foreground/70">No pudimos comparar los perfiles. Ábrelos y decide tú.</p>
        )}
      </div>

      {failure ? <p role="alert" className="text-sm text-destructive">{failure}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={Boolean(deciding)} onClick={() => void decide('same')}>
          {deciding === 'same' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Es la misma persona
        </Button>
        <Button size="sm" variant="outline" disabled={Boolean(deciding)} onClick={() => void decide('different')}>
          {deciding === 'different' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          No es
        </Button>
        <Button size="sm" variant="ghost" disabled={Boolean(deciding)} onClick={onDismiss}>Ocultar</Button>
      </div>
      <p className="text-xs text-foreground/60">
        {review.hasContact
          ? 'Si es la misma persona, verás su contacto sin gastar otro crédito.'
          : 'Apollo no trajo correo para esta persona; si es la misma, verás su nombre, cargo y empresa.'}
      </p>
    </section>
  );
}
