'use client';

import Link from 'next/link';
import { ArrowRight, CheckCircle2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { GoalProgressRows } from '@/components/weekly-goals/GoalProgressRows';
import { goalMet, goalNextStep, goalsOff, paceSentence, sourceText, type GoalProgress } from '@/lib/weekly-goals';
import { usePersonalHome } from './usePersonalHome';

type Response = { week: { label: string; end: string }; goal: GoalProgress; ready: number; admin: boolean };
const EDIT_GOALS = '/dashboard?vista=semana&informe=equipo&metas=1';

/**
 * «Meta de la semana» in «Hoy» (src/lib/weekly-goals.ts): how far the person got, whether they are on pace, and the next step.
 * «Cambiar las metas del equipo» stays on the same page, so «Hoy» opens the editor itself with `onEditGoals`: a link to the
 * same page with other parameters would change the address and nothing else. A new tab still follows the link.
 */
export function WeeklyGoalCard({ onEditGoals }: { onEditGoals?: (href: string) => void } = {}) {
  const { data, loading, error, load } = usePersonalHome<Response>('/api/weekly-goals');
  if (error) return <Card className="rounded-2xl"><CardContent className="flex items-center justify-between gap-3 p-4">
    <p role="alert" className="text-sm text-muted-foreground">No pudimos leer tu meta de la semana.</p>
    <Button variant="ghost" size="sm" onClick={() => void load()}><RefreshCw aria-hidden="true" />Reintentar</Button>
  </CardContent></Card>;
  if (loading && !data) return <Skeleton className="h-48 rounded-2xl" aria-label="Cargando tu meta de la semana" />;
  if (!data || goalsOff(data.goal.targets)) return null;
  const met = goalMet(data.goal);
  const step = goalNextStep(data.goal, data.ready);
  return <Card className="rounded-2xl" data-tour="weekly-goal">
    <CardContent className="space-y-4 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Meta de la semana</h2>
        <span className="text-xs text-muted-foreground">{data.week.label}</span>
      </div>
      <GoalProgressRows goal={data.goal} />
      <p className="flex items-start gap-2 text-sm leading-5">
        {met ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : null}
        <span>{paceSentence(data.goal, new Date())}</span>
      </p>
      {step && !met ? <Button asChild variant="outline" size="sm" className="w-full justify-between">
        <Link href={step.href}>{step.text}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
      </Button> : null}
      <p className="text-xs leading-5 text-muted-foreground">{sourceText(data.goal.source, data.admin)}{data.admin ? <>{' '}
        <Link href={EDIT_GOALS} className="underline underline-offset-2 hover:text-foreground" onClick={event => {
          if (!onEditGoals || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault(); onEditGoals(EDIT_GOALS);
        }}>Cambiar las metas del equipo</Link></> : null}</p>
    </CardContent>
  </Card>;
}
