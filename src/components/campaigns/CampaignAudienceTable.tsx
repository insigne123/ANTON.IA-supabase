'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { audiencePersonStatus, seniorityLabel, type AudiencePerson } from '@/lib/bulk-campaigns';
import { cn } from '@/lib/utils';

/**
 * The people a search found, as a table (Plan 6, PR-D1): who they are, where they work and whether they can be written to.
 * A person the app cannot write to stays visible with the reason, never selectable. On a phone the company and the reason go
 * under the name, so nothing hides behind a sideways scroll (9 Nov 2026 review).
 */
export function CampaignAudienceTable({ people, selected, max, busy, onToggle }: {
  people: AudiencePerson[];
  selected: string[];
  max: number;
  busy: boolean;
  onToggle: (email: string, checked: boolean) => void;
}) {
  const full = selected.length >= max;
  return (
    <div className="max-h-96 min-w-0 overflow-y-auto rounded-xl border">
      <Table className="sm:min-w-[36rem]">
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead scope="col" className="w-12"><span className="sr-only">Seleccionar</span></TableHead>
            <TableHead scope="col">Persona</TableHead>
            <TableHead scope="col" className="hidden sm:table-cell">Empresa y cargo</TableHead>
            <TableHead scope="col" className="hidden sm:table-cell">Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {people.map(person => {
            const checked = selected.includes(person.email);
            const status = audiencePersonStatus(person);
            const name = person.name || person.email;
            const role = [person.title, person.seniority ? seniorityLabel(person.seniority) : ''].filter(Boolean).join(' · ') || 'Cargo sin dato';
            const statusText = status.text || 'Disponible';
            return (
              <TableRow key={person.email} data-state={checked ? 'selected' : undefined} className={cn(person.blockedReason && 'text-muted-foreground')}>
                <TableCell className="align-top">
                  <Checkbox
                    className="mt-0.5"
                    aria-label={`Seleccionar a ${name}`}
                    disabled={busy || Boolean(person.blockedReason) || (!checked && full)}
                    checked={checked}
                    onCheckedChange={value => onToggle(person.email, value === true)}
                  />
                </TableCell>
                <TableCell className="min-w-0 align-top">
                  <span className="block break-words font-medium text-foreground">{name}</span>
                  <span className="block break-all text-xs text-muted-foreground">{person.email}</span>
                  <span className="mt-1 block text-xs text-muted-foreground sm:hidden">{person.company || 'Empresa sin nombre'} · {role}</span>
                  <span className={cn('mt-1 block text-xs sm:hidden', status.blocked ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>{statusText}</span>
                </TableCell>
                <TableCell className="hidden align-top sm:table-cell">
                  <span className="block">{person.company || 'Empresa sin nombre'}</span>
                  <span className="block text-xs text-muted-foreground">{role}</span>
                </TableCell>
                <TableCell className="hidden align-top text-xs sm:table-cell">
                  <span className={cn('block', status.blocked ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>{statusText}</span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
