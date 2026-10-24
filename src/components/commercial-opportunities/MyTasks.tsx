'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { myTaskGroups, taskDue, TASK_STATUS_LABELS, type MyTask } from '@/lib/commercial-opportunities/work-tasks';
import { cn } from '@/lib/utils';

type Props = {
  /** null while they are read. */
  tasks: MyTask[] | null; error: string; busy: boolean;
  /** Opens the opportunity on «Plan y tareas». */
  onOpen: (opportunityId: string) => void;
  onDone: (task: MyTask) => Promise<unknown>;
  onRetry: () => void;
  now?: Date;
};

/**
 * «Mis tareas» (OPP-27): what this person has to do in every opportunity they work, in the order it is needed (late ones first, in red),
 * each with its opportunity one click away. Ticking one marks it done and takes it off the list.
 */
export function MyTasks({ tasks, error, busy, onOpen, onDone, onRetry, now }: Props) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  useEffect(() => setGone(new Set()), [tasks]);
  if (error) return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
    <p>{error}</p><Button size="sm" variant="outline" onClick={onRetry}>Reintentar</Button></div>;
  if (!tasks) return <div role="status" className="flex items-center gap-2 rounded-xl border p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Cargando tus tareas…</div>;
  const groups = myTaskGroups(tasks.filter(task => !gone.has(task.id)), now);
  if (!groups.length) return <div className="rounded-2xl border"><EmptyState icon={CheckCircle2} title="No tienes tareas pendientes" headingLevel="h2"
    description="Cuando te den una tarea en una oportunidad, aparece aquí con su fecha." /></div>;
  return <div className="space-y-6">
    {groups.map(group => <section key={group.key} aria-labelledby={`my-tasks-${group.key}`} className="space-y-2">
      <h2 id={`my-tasks-${group.key}`} className={cn('text-sm font-semibold', group.key === 'late' && 'text-destructive')}>{group.label} <span className="font-normal tabular-nums text-muted-foreground">{group.tasks.length}</span></h2>
      <ul className="divide-y rounded-2xl border">{group.tasks.map(task => {
        const due = taskDue(task.due_at, task.status, now);
        return <li key={task.id} className="flex items-start gap-3 px-4 py-3">
          <Checkbox checked={false} disabled={busy} className="mt-0.5 h-5 w-5 rounded-full" aria-label={`Marcar «${task.title}» como hecha`}
            onCheckedChange={() => { setGone(current => new Set(current).add(task.id)); void onDone(task); }} />
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-medium">{task.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {due ? <span className={cn(due.late && 'font-medium text-destructive')}>{due.label}</span> : null}
              {task.status === 'working' || task.status === 'blocked' ? <span className={cn('rounded-full px-2 py-0.5 font-medium', task.status === 'blocked' ? 'bg-cw-warning-soft text-cw-warning' : 'bg-primary/10 text-primary')}>{TASK_STATUS_LABELS[task.status]}</span> : null}
              <button type="button" onClick={() => onOpen(task.opportunity.id)} className="min-w-0 max-w-full truncate rounded text-left text-foreground/80 underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {task.opportunity.title}</button>
            </div>
          </div>
        </li>;
      })}</ul>
    </section>)}
  </div>;
}
