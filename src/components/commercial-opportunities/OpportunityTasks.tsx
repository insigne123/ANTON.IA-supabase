'use client';
import { useEffect, useState } from 'react';
import { ChevronDown, ListChecks, MoreHorizontal, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { orderTasks, taskDue, TASK_STATUS_LABELS, type OpportunityTask, type TaskStatus } from '@/lib/commercial-opportunities/work-tasks';
import { cn } from '@/lib/utils';

type Person = { user_id: string; name: string };
type Props = {
  tasks: OpportunityTask[]; people: Person[]; busy: boolean;
  /** How many steps of the report's plan are not tasks yet: «Convertir el plan en tareas» shows while there are. */
  planLeft: number;
  /** Whether this person can delete a task: who created it, who is in charge of the opportunity or an administrator. */
  canDelete: (task: OpportunityTask) => boolean;
  onPlan: () => void; onCreate: () => void; onEdit: (task: OpportunityTask) => void;
  onStatus: (task: OpportunityTask, status: TaskStatus) => Promise<unknown>;
  onOwner: (task: OpportunityTask, ownerId: string | null) => void;
  onDelete: (task: OpportunityTask) => void;
  now?: Date;
};

/**
 * «Plan y tareas» (OPP-27): what is still to do by the day it is due, late ones in red, and what is done apart. Ticking one marks it done at
 * once; its owner changes from the row; editing, the stage and deleting are in its menu. With a report, its plan becomes tasks at once.
 */
export function OpportunityTasks({ tasks, people, busy, planLeft, canDelete, onPlan, onCreate, onEdit, onStatus, onOwner, onDelete, now }: Props) {
  // A tick shows at once; the list read again after the save confirms it (or takes it back).
  const [ticked, setTicked] = useState<Record<string, TaskStatus>>({});
  useEffect(() => setTicked({}), [tasks]);
  const shown = tasks.map(task => (ticked[task.id] ? { ...task, status: ticked[task.id] } : task));
  const { open, done } = orderTasks(shown);
  const [showDone, setShowDone] = useState(false);
  const nameOf = (id: string | null) => people.find(person => person.user_id === id)?.name ?? null;
  const tick = (task: OpportunityTask, status: TaskStatus) => { setTicked(current => ({ ...current, [task.id]: status })); void onStatus(task, status); };
  const row = (task: OpportunityTask) => {
    const due = taskDue(task.due_at, task.status, now);
    const finished = task.status === 'done';
    const owner = nameOf(task.owner_id);
    return <li key={task.id} className="flex items-start gap-3 px-4 py-3">
      <Checkbox checked={finished} disabled={busy} onCheckedChange={value => tick(task, value === true ? 'done' : 'pending')} className="mt-0.5 h-5 w-5 rounded-full"
        aria-label={finished ? `Marcar «${task.title}» como pendiente` : `Marcar «${task.title}» como hecha`} />
      <div className="min-w-0 flex-1">
        <p className={cn('break-words text-sm font-medium', finished && 'text-muted-foreground line-through decoration-muted-foreground/60')}>{task.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {due ? <span className={cn(due.late && 'font-medium text-destructive')}>{due.label}</span> : null}
          {task.status === 'working' || task.status === 'blocked' ? <span className={cn('rounded-full px-2 py-0.5 font-medium', task.status === 'blocked' ? 'bg-cw-warning-soft text-cw-warning' : 'bg-primary/10 text-primary')}>{TASK_STATUS_LABELS[task.status]}</span> : null}
          {/* Who does it, changed from the row: only the people of the team can have it. */}
          <DropdownMenu><DropdownMenuTrigger asChild>
            <button type="button" disabled={busy} aria-label={`Responsable de «${task.title}»: ${owner ?? 'sin responsable'}. Cambiar`}
              className="inline-flex items-center gap-1 rounded-md px-1 -mx-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
              {owner ?? 'Sin responsable'}<ChevronDown className="h-3 w-3" aria-hidden="true" /></button>
          </DropdownMenuTrigger><DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={task.owner_id ?? ''} onValueChange={value => { if (value !== (task.owner_id ?? '')) onOwner(task, value || null); }}>
              {people.map(person => <DropdownMenuRadioItem key={person.user_id} value={person.user_id}>{person.name}</DropdownMenuRadioItem>)}
              <DropdownMenuRadioItem value="">Sin responsable</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent></DropdownMenu>
        </div>
        {task.evidence ? <p className="mt-1 break-words text-sm text-muted-foreground">{task.evidence}</p> : null}
      </div>
      <DropdownMenu><DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" disabled={busy} aria-label={`Más acciones de «${task.title}»`}><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></Button>
      </DropdownMenuTrigger><DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onEdit(task)}>Editar</DropdownMenuItem>
        {task.status !== 'working' && !finished ? <DropdownMenuItem onSelect={() => tick(task, 'working')}>Marcar en curso</DropdownMenuItem> : null}
        {task.status !== 'blocked' && !finished ? <DropdownMenuItem onSelect={() => tick(task, 'blocked')}>Marcar bloqueada</DropdownMenuItem> : null}
        {task.status === 'working' || task.status === 'blocked' ? <DropdownMenuItem onSelect={() => tick(task, 'pending')}>Volver a pendiente</DropdownMenuItem> : null}
        {canDelete(task) ? <><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDelete(task)}>Eliminar</DropdownMenuItem></> : null}
      </DropdownMenuContent></DropdownMenu>
    </li>;
  };
  // One main action: turning the plan into tasks while there is none; after, creating one by hand.
  const planFirst = planLeft > 0 && tasks.length === 0;
  return <section aria-labelledby="op-tasks" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="op-tasks" className="font-semibold">Plan de trabajo{open.length ? <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">{open.length === 1 ? '1 por hacer' : `${open.length} por hacer`}</span> : null}</h2>
      <div className="flex flex-wrap gap-2">
        {planLeft > 0 ? <Button variant={planFirst ? 'default' : 'outline'} disabled={busy} onClick={onPlan}><ListChecks className="mr-2 h-4 w-4" aria-hidden="true" />
          {planFirst ? 'Convertir el plan en tareas' : planLeft === 1 ? 'Agregar 1 paso del plan' : `Agregar ${planLeft} pasos del plan`}</Button> : null}
        <Button variant={planFirst ? 'ghost' : 'outline'} disabled={busy} onClick={onCreate}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />Crear tarea</Button>
      </div>
    </div>
    {!tasks.length ? <p className="rounded-xl border p-5 text-sm text-muted-foreground">{planLeft > 0
      ? 'El informe trae un plan de trabajo: conviértelo en tareas con responsable y fecha, y ajústalas antes de crearlas.'
      : 'Crea la primera tarea. Cuando generes el informe, podrás convertir su plan en tareas con un clic.'}</p> : null}
    {open.length ? <ul aria-label="Por hacer" className="divide-y rounded-2xl border">{open.map(row)}</ul>
      : tasks.length ? <p className="rounded-xl border p-5 text-sm text-muted-foreground">Todo hecho. Crea otra tarea si falta algo.</p> : null}
    {done.length ? <div className="space-y-2">
      <button type="button" aria-expanded={showDone} onClick={() => setShowDone(value => !value)}
        className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronDown className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', showDone && 'rotate-180')} aria-hidden="true" />Hechas · <span className="tabular-nums">{done.length}</span></button>
      {showDone ? <ul aria-label="Hechas" className="divide-y rounded-2xl border">{done.map(row)}</ul> : null}
    </div> : null}
  </section>;
}
