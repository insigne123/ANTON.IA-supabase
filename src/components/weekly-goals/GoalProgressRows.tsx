'use client';

import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { GOAL_METRICS, type GoalProgress } from '@/lib/weekly-goals';

/** The goals that are on, each with its count and a bar: the main one (people contacted) first. */
export function GoalProgressRows({ goal, className }: { goal: GoalProgress; className?: string }) {
  return <ul className={cn('space-y-3', className)}>
    {GOAL_METRICS.filter(metric => goal.targets[metric.key] > 0).map(metric => {
      const done = goal.counts[metric.key], target = goal.targets[metric.key];
      const met = done >= target;
      return <li key={metric.key} className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 truncate">{metric.label}</span>
          <span className={cn('shrink-0 tabular-nums', met ? 'font-medium text-primary' : 'text-muted-foreground')}>
            <span className={met ? undefined : 'font-medium text-foreground'}>{done.toLocaleString('es-CL')}</span> de {target.toLocaleString('es-CL')}
            {met ? <span className="sr-only"> (cumplida)</span> : null}
          </span>
        </div>
        <Progress value={Math.min(100, (done / target) * 100)} className="h-1.5" aria-label={`${metric.label}: ${done} de ${target}`} />
      </li>;
    })}
  </ul>;
}
