import { AlertTriangle } from 'lucide-react';

import { checkEmailAgainstName, displayLeadName } from '@/lib/lead-name';
import { cn } from '@/lib/utils';

const MASKED_HINT = 'El proveedor oculta el apellido hasta que buscas el correo.';

/** A contact's name: «Rafael D.» while the provider hides the surname, with why (docs/contactos-identidad.md). */
export function LeadName({ name, fallback = 'Sin nombre', className }: { name?: string | null; fallback?: string; className?: string }) {
  const shown = displayLeadName(name);
  if (!shown.text) return <span className={className}>{fallback}</span>;
  if (!shown.masked) return <span className={className}>{shown.text}</span>;
  return (
    <span className={className} title={MASKED_HINT}>
      {shown.text}
      <span className="ml-1.5 text-xs font-normal text-muted-foreground">apellido al buscar el correo</span>
    </span>
  );
}

/** A quiet warning when the email seems to belong to someone else («rgodoy@…» for «Rafael Durán»). Nothing otherwise. */
export function EmailOwnerWarning({ email, name, className }: { email?: string | null; name?: string | null; className?: string }) {
  const check = checkEmailAgainstName(email, name);
  if (check.verdict !== 'mismatch') return null;
  return (
    <p className={cn('mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300', className)} role="note">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span>Este correo podría ser de otra persona. Revísalo antes de escribirle.</span>
    </p>
  );
}
