'use client';
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { dueAtOfDay, type PlanDraft } from '@/lib/commercial-opportunities/work-tasks';
import { cn } from '@/lib/utils';

export type PlannedTask = { title: string; ownerId: string | null; dueAt: string | null; evidence: string };
type Row = PlanDraft & { on: boolean };
const field = 'block h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

/**
 * «Convertir el plan en tareas» (OPP-21): every step of the report's plan with who does it and for when already proposed, to correct before
 * creating them all at once. The steps already in the list come unticked. Nothing is created until «Crear N tareas».
 */
export function PlanTasksDialog({ open, drafts, people, closeLabel, busy, error, onConfirm, onCancel }: {
  open: boolean; drafts: PlanDraft[]; people: Array<{ user_id: string; name: string }>;
  /** The day it closes («30 de octubre»), or null without one: says where the days come from. */
  closeLabel: string | null; busy: boolean; error?: string;
  onConfirm: (tasks: PlannedTask[]) => void; onCancel: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  // Opened again, it starts from the plan as it is now, not from what was left the last time; while open, what is typed stays.
  const latest = useRef(drafts); latest.current = drafts;
  useEffect(() => { if (open) setRows(latest.current.map(draft => ({ ...draft, on: !draft.exists }))); }, [open]);
  const change = (key: string, patch: Partial<Row>) => setRows(current => current.map(row => (row.key === key ? { ...row, ...patch } : row)));
  const chosen = rows.filter(row => row.on && row.title.trim().length >= 2);
  return <Dialog open={open} onOpenChange={next => { if (!next && !busy) onCancel(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Convertir el plan en tareas</DialogTitle>
        <DialogDescription>{closeLabel ? `Revisa quién hace cada una y para cuándo: las fechas llegan hasta el cierre, el ${closeLabel}.` : 'Revisa quién hace cada una y ponles fecha si la tienen: la oportunidad no tiene cierre.'}</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!chosen.length || busy) return;
        onConfirm(chosen.map(row => ({ title: row.title.replace(/\s+/g, ' ').trim(), ownerId: row.ownerId, dueAt: dueAtOfDay(row.day), evidence: row.evidence }))); }}>
        <ul className="divide-y rounded-xl border">
          {rows.map((row, index) => <li key={row.key} className={cn('grid gap-2 p-3 sm:grid-cols-[auto_minmax(0,1fr)_11rem_9.5rem] sm:items-center', !row.on && 'bg-muted/30')}>
            <Checkbox checked={row.on} disabled={busy} onCheckedChange={value => change(row.key, { on: value === true })} aria-label={`Incluir «${row.title}»`} className="mt-2 sm:mt-0" />
            <div className="min-w-0 space-y-1">
              <Input value={row.title} disabled={busy || !row.on} maxLength={500} onChange={event => change(row.key, { title: event.target.value })} aria-label={`Paso ${index + 1}`} className="h-9" />
              {row.exists ? <p className="text-xs text-muted-foreground">Ya está en la lista de tareas.</p> : null}
            </div>
            <select value={row.ownerId ?? ''} disabled={busy || !row.on} onChange={event => change(row.key, { ownerId: event.target.value || null })} aria-label={`Quién hace «${row.title}»`} className={field}>
              <option value="">Sin responsable</option>
              {people.map(person => <option key={person.user_id} value={person.user_id}>{person.name}</option>)}
            </select>
            <Input type="date" value={row.day ?? ''} disabled={busy || !row.on} onChange={event => change(row.key, { day: event.target.value || null })} aria-label={`Para cuándo «${row.title}»`} className="h-9" />
          </li>)}
        </ul>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancelar</Button>
          <Button type="submit" disabled={busy || !chosen.length}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {chosen.length === 1 ? 'Crear 1 tarea' : `Crear ${chosen.length} tareas`}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
