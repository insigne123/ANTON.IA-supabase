'use client';

import type { ReactNode } from 'react';

import { TeamLockBadge } from '@/components/collaboration/TeamLockBadge';
import { InitialsAvatar } from '@/components/initials-avatar';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { teamLockClaimed } from '@/lib/team-lock';
import type { Lead as UILaed } from '@/lib/types';
import { cn } from '@/lib/utils';

type TeamLock = Parameters<typeof TeamLockBadge>[0]['lock'];

/**
 * One person in the results of «Buscar prospectos»: checkbox, initials, name and role, company and the marks that matter
 * before saving. Someone already saved or contacted, or held by another member («Adjudicado a Ana · le quedan 12 días»),
 * cannot be selected, and the row says why.
 */
export function SearchLeadRow({ lead, selected, saved, contacted, onSelect, lock, showCompany = true, details, fit }: {
  lead: UILaed;
  selected: boolean;
  saved: boolean;
  contacted: boolean;
  onSelect: (checked: boolean) => void;
  lock?: TeamLock;
  showCompany?: boolean;
  /** Email or phone lines (LinkedIn profile search). */
  details?: ReactNode;
  /** The «probabilidad de calce» (LeadFitBadge). */
  fit?: ReactNode;
}) {
  const claimed = !saved && !contacted && teamLockClaimed(lock);
  const disabled = saved || contacted || claimed;
  const place = [lead.company && showCompany ? lead.company : '', lead.location && lead.location !== '—' ? lead.location : '']
    .filter((part) => part && part !== '—')
    .join(' · ');
  return (
    <div
      data-state={selected ? 'selected' : undefined}
      className={cn(
        // Audit B4: a row, not a card (about 56 px instead of 90): eight to ten people fit on a screen.
        'flex items-start gap-3 rounded-xl border border-border/60 bg-card px-3 py-2 transition-colors',
        selected && 'border-primary/50 bg-primary/5',
      )}
    >
      <Checkbox
        aria-label={disabled ? `${lead.name}: ${saved ? 'ya guardado' : contacted ? 'ya contactado' : 'adjudicado a otra persona del equipo'}` : `Seleccionar ${lead.name}`}
        disabled={disabled}
        checked={selected}
        onCheckedChange={(checked) => onSelect(Boolean(checked))}
        className="mt-1.5"
      />
      <InitialsAvatar name={lead.name} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          {/* flex-1: the name takes the room the marks leave, instead of shrinking to nothing beside «Guardado». */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{lead.name}</p>
            <p className="flex min-w-0 items-center gap-1.5 text-sm text-foreground/70">
              <span className="truncate" title={lead.title || undefined}>{lead.title}</span>
              {lead.titleMatch ? <TitleMatchBadge match={lead.titleMatch} /> : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {fit}
            {saved ? <Badge variant="success" className="shrink-0">Guardado</Badge> : contacted ? <Badge variant="info" className="shrink-0">Contactado</Badge>
              : claimed ? <Badge variant="warning" className="shrink-0">Adjudicado</Badge> : null}
          </div>
        </div>
        {place || lead.email ? <p className="mt-0.5 truncate text-xs text-foreground/70">{[place, lead.email].filter(Boolean).join(' · ')}</p> : null}
        {details}
        <TeamLockBadge lock={lock} className="mt-1" />
      </div>
    </div>
  );
}

const TITLE_MATCH_TEXT = { exact: 'Cargo exacto', similar: 'Cargo similar', related: 'Cargo relacionado' } as const;
const TITLE_MATCH_HINT = {
  exact: 'Es el cargo que buscaste, aunque esté escrito distinto.',
  similar: 'Hace lo mismo con otro nombre o un nivel parecido.',
  related: 'Un área vecina que suele decidir o influir en la misma compra.',
} as const;

/** How the person's title matches the searched one, as the AI classified it (src/lib/server/search/title-ai.ts). */
function TitleMatchBadge({ match }: { match: keyof typeof TITLE_MATCH_TEXT }) {
  return <Badge variant={match === 'exact' ? 'success' : match === 'similar' ? 'info' : 'neutral'} className="shrink-0 px-1.5 py-0 text-[11px] font-normal"
    title={TITLE_MATCH_HINT[match]}>{TITLE_MATCH_TEXT[match]}</Badge>;
}
