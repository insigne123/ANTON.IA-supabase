'use client';

import { Check, Star } from 'lucide-react';
import { InitialsAvatar } from '@/components/initials-avatar';
import { cn } from '@/lib/utils';

export type TeamMember = { user_id: string; name: string; role?: string | null };

/** A desk in the office: a small table with its screen, drawn with the same line as the report's «oficina». */
function Desk({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 72 26" aria-hidden="true" className="relative z-10 -mt-3 h-[26px] w-[72px] overflow-visible">
      {/* The desk in front of the person: its top, a laptop open toward them and a mug. */}
      <rect x="2" y="6" width="68" height="7" rx="3" className={cn('fill-background stroke-foreground/30', active && 'stroke-primary/60')} strokeWidth="1.4" />
      <path d="M22 6l3-5h16l3 5" className={cn('fill-muted stroke-foreground/35', active && 'stroke-primary/60')} strokeWidth="1.3" strokeLinejoin="round" />
      <rect x="52" y="1.5" width="6" height="4.5" rx="1" className="fill-background stroke-foreground/30" strokeWidth="1.2" />
      <path d="M10 13v12M62 13v12" className="stroke-foreground/25" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The opportunity's team as an office: each person at a desk, the responsible one first and marked. Decorative motion only
 * when the person allows it; the names and roles say the same in words.
 */
export function TeamOffice({ people, responsibleId, empty = 'Nadie trabaja esta oportunidad todavía.', className }: {
  people: TeamMember[]; responsibleId?: string | null; empty?: string; className?: string;
}) {
  const seated = [...people].sort((a, b) => Number(b.user_id === responsibleId) - Number(a.user_id === responsibleId));
  return (
    <div className={cn('rounded-2xl border border-border/60 bg-muted/30 p-4', className)}>
      {seated.length ? (
        <ul aria-label="Equipo de la oportunidad" className="flex flex-wrap justify-center gap-x-5 gap-y-4 sm:justify-start">
          {seated.map((person, index) => {
            const lead = person.user_id === responsibleId;
            return (
              <li key={person.user_id} className="flex w-[84px] flex-col items-center text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1"
                style={{ animationDelay: `${Math.min(index, 6) * 60}ms` }}>
                <span className={cn('relative motion-safe:animate-ghost-float')} style={{ animationDelay: `${index * 400}ms` }}>
                  <InitialsAvatar name={person.name} size="md" className={cn('ring-2 ring-background', lead && 'ring-primary/60')} />
                  {lead ? (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
                      <Star className="h-2.5 w-2.5 fill-current" />
                    </span>
                  ) : null}
                </span>
                <Desk active={lead} />
                <span className="mt-1 line-clamp-1 w-full text-xs font-medium text-foreground">{person.name}</span>
                <span className="text-[11px] text-muted-foreground">{lead ? 'Responsable' : 'Participa'}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="flex gap-1 opacity-60" aria-hidden="true"><Desk active={false} /><Desk active={false} /></span>
          {empty}
        </div>
      )}
    </div>
  );
}

/** Picking the first person makes them responsible; unpicking the responsible one passes it to the next. */
export function toggleTeamMember(team: { selected: string[]; responsibleId: string }, id: string) {
  const picked = team.selected.includes(id);
  const selected = picked ? team.selected.filter(other => other !== id) : [...team.selected, id];
  const responsibleId = picked && id === team.responsibleId ? selected[0] || '' : !team.responsibleId && !picked ? id : team.responsibleId;
  return { selected, responsibleId };
}

/**
 * Who works the opportunity, picked with a tap: each person a tile; a picked person can be made responsible with the star.
 */
export function TeamPicker({ members, selected, responsibleId, onChange }: {
  members: TeamMember[];
  selected: string[];
  responsibleId: string;
  onChange: (next: { selected: string[]; responsibleId: string }) => void;
}) {
  const toggle = (id: string) => onChange(toggleTeamMember({ selected, responsibleId }, id));
  return (
    <ul aria-label="Personas del workspace" className="grid gap-2 sm:grid-cols-2">
      {members.map(member => {
        const picked = selected.includes(member.user_id);
        const lead = picked && member.user_id === responsibleId;
        return (
          <li key={member.user_id} className={cn('flex items-center gap-2 rounded-xl border p-2 transition-colors', picked ? 'border-primary/50 bg-primary/5' : 'border-border/60')}>
            <button type="button" aria-pressed={picked} onClick={() => toggle(member.user_id)}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="relative">
                <InitialsAvatar name={member.name} size="sm" />
                {picked ? <span className="absolute -bottom-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background" aria-hidden="true"><Check className="h-2.5 w-2.5" /></span> : null}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{member.name}</span>
                <span className="block text-xs text-muted-foreground">{lead ? 'Responsable' : picked ? 'Participa' : member.role === 'admin' || member.role === 'owner' ? 'Administra el workspace' : 'Miembro'}</span>
              </span>
            </button>
            {picked ? (
              <button type="button" aria-pressed={lead} aria-label={lead ? `${member.name} es responsable` : `Hacer responsable a ${member.name}`}
                onClick={() => onChange({ selected, responsibleId: member.user_id })}
                className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  lead ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>
                <Star className={cn('h-4 w-4', lead && 'fill-current')} aria-hidden="true" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
