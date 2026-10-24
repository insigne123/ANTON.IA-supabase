// src/app/(app)/dashboard/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import {PersonalCredits} from '@/components/home/PersonalCredits';
import { HomeSummary } from '@/components/home/HomeSummary';
import { TodayPanel } from '@/components/home/TodayPanel';
import { RecommendedLeads } from '@/components/home/RecommendedLeads';
import { ReconnectCard } from '@/components/home/ReconnectCard';
import { TouchesCard } from '@/components/home/TouchesCard';
import { WeeklyGoalCard } from '@/components/home/WeeklyGoalCard';
import { LeadDropBanner } from '@/components/home/LeadDropBanner';
import { OpportunitiesTodayCard } from '@/components/home/OpportunitiesTodayCard';
import { WeeklyReport } from '@/components/weekly-report/WeeklyReport';
import { cn } from '@/lib/utils';

/** «Hoy» or «Tu semana» (the weekly report, which lived on its own page until Oct 2026): ?vista=semana opens the second. */
type View = 'hoy' | 'semana';
const viewInUrl = (): View => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('vista') === 'semana' ? 'semana' : 'hoy';
const TODAY = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long',timeZone:'America/Santiago' });

/**
 * «Hoy» (docs/inicio-hoy.md). The work first: the next step, today's contact and what is waiting, in the main column. The
 * week's goal, how the day goes and the credits sit beside it, so they never push the work down. «Oportunidades», «Llamadas y
 * LinkedIn» and «Para retomar» follow the pending work when something is due. On phones the order is step → contact of the day →
 * pending → opportunities → calls and LinkedIn → to reconnect → goal → summary → recommended.
 */
export default function DashboardPage() {
  const [view, setView] = useState<View>('hoy');
  useEffect(() => { const read = () => setView(viewInUrl()); read(); window.addEventListener('popstate', read); return () => window.removeEventListener('popstate', read); }, []);
  const show = (next: View) => {
    setView(next);
    if (viewInUrl() !== next) window.history.pushState(null, '', next === 'semana' ? '/dashboard?vista=semana' : '/dashboard');
  };
  // A link inside «Hoy» to «Tu semana» with its own parameters (the goals editor): the address first, so «Tu semana» reads them.
  const open = (href: string) => { window.history.pushState(null, '', href); setView(viewInUrl()); window.scrollTo({ top: 0 }); };
  // The date is read in the browser: the page is prerendered, and the server's day may not be the person's.
  const [today, setToday] = useState('');
  useEffect(() => {
    const update=()=>{const label = TODAY.format(new Date());setToday(label.charAt(0).toLocaleUpperCase('es-CL') + label.slice(1));};
    update();const timer=setInterval(update,30000);window.addEventListener('focus',update);
    return()=>{clearInterval(timer);window.removeEventListener('focus',update);};
  }, []);

  return (
    <div>
      <PageHeader
        title={view === 'semana' ? 'Tu semana' : 'Hoy'}
        eyebrow={today || undefined}
        description={view === 'semana' ? 'Cómo te fue, comparado con la semana anterior, y qué hacer después.' : 'Tu actividad de hoy y tus pendientes en esta organización.'}
      >
        <div role="group" aria-label="Vista de Hoy" className="inline-flex rounded-full bg-muted p-1">
          {([['hoy', 'Hoy'], ['semana', 'Tu semana']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => show(key)}
            className={cn('rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', view === key ? 'bg-background shadow-sm' : 'text-foreground/70 hover:text-foreground')}>{label}</button>)}
        </div>
        <Button asChild variant="ghost" className="flex-1 text-muted-foreground sm:flex-none">
          <Link href="/search">
            <Search aria-hidden="true" />
            Buscar prospectos
          </Link>
        </Button>
      </PageHeader>

      {view === 'semana' ? <WeeklyReport embedded /> : (
      /* items-start at every width: a stretched grid item would turn a card's h-full into the whole column. */
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4 xl:col-start-1">
          <TodayPanel afterPrimary={primary => <LeadDropBanner quietProfile={primary.href === '/profile'} />} />
          <OpportunitiesTodayCard />
          <TouchesCard />
          <ReconnectCard />
        </div>

        {/* On a wide and tall screen the week stays in view while the work scrolls; on a short one it would hide its own end (APP-01). */}
        <aside aria-label="Tu actividad de hoy" className="min-w-0 space-y-4 xl:col-start-2 xl:row-span-2 xl:row-start-1 [@media(min-width:1280px)_and_(min-height:900px)]:sticky [@media(min-width:1280px)_and_(min-height:900px)]:top-6">
          <WeeklyGoalCard onEditGoals={open} />
          <HomeSummary />
          <PersonalCredits />
        </aside>

        <div className="min-w-0 xl:col-start-1">
          <RecommendedLeads />
        </div>
      </div>)}
    </div>
  );
}
