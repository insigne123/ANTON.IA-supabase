'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { audiencePersonStatus, type AudiencePerson } from '@/lib/bulk-campaigns';
import { cn } from '@/lib/utils';

/**
 * The people a search found, as a table (Plan 6, PR-D1): who they are, where they work and whether they can be written to.
 * A person the app cannot write to stays visible with the reason, never selectable.
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
      <Table className="min-w-[36rem]">
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead scope="col" className="w-12"><span className="sr-only">Seleccionar</span></TableHead>
            <TableHead scope="col">Persona</TableHead>
            <TableHead scope="col">Empresa y cargo</TableHead>
            <TableHead scope="col">Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {people.map(person => {
            const checked = selected.includes(person.email);
            const status = audiencePersonStatus(person);
            const name = person.name || person.email;
            return (
              <TableRow key={person.email} data-state={checked ? 'selected' : undefined} className={cn(person.blockedReason && 'text-muted-foreground')}>
                <TableCell className="align-top">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    aria-label={`Seleccionar a ${name}`}
                    disabled={busy || Boolean(person.blockedReason) || (!checked && full)}
                    checked={checked}
                    onChange={event => onToggle(person.email, event.target.checked)}
                  />
                </TableCell>
                <TableCell className="align-top">
                  <span className="block font-medium text-foreground">{name}</span>
                  <span className="block break-all text-xs text-muted-foreground">{person.email}</span>
                </TableCell>
                <TableCell className="align-top">
                  <span className="block">{person.company || 'Empresa sin nombre'}</span>
                  <span className="block text-xs text-muted-foreground">{[person.title, person.seniority].filter(Boolean).join(' · ') || 'Cargo sin dato'}</span>
                </TableCell>
                <TableCell className="align-top text-xs">
                  {status.text ? (
                    <span className={cn('block', status.blocked ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>{status.text}</span>
                  ) : <span className="text-muted-foreground">Disponible</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
