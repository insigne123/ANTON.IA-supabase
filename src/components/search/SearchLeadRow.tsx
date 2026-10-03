'use client';

import type { ReactNode } from 'react';

import { TeamLockBadge } from '@/components/collaboration/TeamLockBadge';
import { InitialsAvatar } from '@/components/initials-avatar';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import type { Lead as UILaed } from '@/lib/types';
import { cn } from '@/lib/utils';

type TeamLock = Parameters<typeof TeamLockBadge>[0]['lock'];

/**
 * One person in the results of «Buscar prospectos»: checkbox, initials, name and role, company and the marks that matter
 * before saving. Someone already saved or contacted cannot be selected again, and the row says why.
 */
export function SearchLeadRow({ lead, selected, saved, contacted, onSelect, lock, showCompany = true, details }: {
  lead: UILaed;
  selected: boolean;
  saved: boolean;
  contacted: boolean;
  onSelect: (checked: boolean) => void;
  lock?: TeamLock;
  showCompany?: boolean;
  /** Email or phone lines (LinkedIn profile search). */
  details?: ReactNode;
}) {
  const disabled = saved || contacted;
  const place = [lead.company && showCompany ? lead.company : '', lead.location && lead.location !== '—' ? lead.location : '']
    .filter((part) => part && part !== '—')
    .join(' · ');
  return (
    <div
      data-state={selected ? 'selected' : undefined}
      className={cn(
        'flex items-start gap-3 rounded-xl border border-border/60 bg-card p-3 transition-colors',
        selected && 'border-primary/50 bg-primary/5',
      )}
    >
      <Checkbox
        aria-label={disabled ? `${lead.name}: ${saved ? 'ya guardado' : 'ya contactado'}` : `Seleccionar ${lead.name}`}
        disabled={disabled}
        checked={selected}
        onCheckedChange={(checked) => onSelect(Boolean(checked))}
        className="mt-2.5"
      />
      <InitialsAvatar name={lead.name} size="md" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{lead.name}</p>
            <p className="line-clamp-2 text-sm text-foreground/70">{lead.title}</p>
          </div>
          {saved ? <Badge variant="success" className="shrink-0">Guardado</Badge> : contacted ? <Badge variant="info" className="shrink-0">Contactado</Badge> : null}
        </div>
        {place ? <p className="mt-1 truncate text-xs text-foreground/70">{place}</p> : null}
        {lead.email ? <p className="mt-0.5 truncate text-xs text-foreground/70">{lead.email}</p> : null}
        {details}
        <TeamLockBadge lock={lock} className="mt-1" />
      </div>
    </div>
  );
}
