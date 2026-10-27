'use client';

import { CalendarClock } from 'lucide-react';
import { describeCoworkSchedule, type CoworkScheduleOffer } from '@/lib/cowork/schedules';
import { COWORK_DEFAULT_TIME_ZONE } from '@/lib/cowork/time-zone';
import { cwFadeRise, cwVariants, m } from './motion';
import { CwButton } from './ui';

/**
 * The task Cowork proposes when the person asks for something to repeat: its name, when it runs and the request, and one action,
 * «Revisar y programar», that opens the form of «Tareas programadas» with it. Nothing is scheduled until the person saves it there.
 */
export function CoworkScheduleOfferCard({ offer, live, onOpen }: { offer: CoworkScheduleOffer; live: boolean; onOpen: () => void }) {
  const when = describeCoworkSchedule({ ...offer, timeZone: COWORK_DEFAULT_TIME_ZONE });
  return <m.section {...cwVariants(cwFadeRise, live)} aria-label="Tarea para programar"
    className="rounded-2xl border border-cw-border bg-cw-elevated px-3.5 py-3 shadow-[var(--cw-shadow-sm)]">
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cw-accent-soft text-cw-accent">
        <CalendarClock className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium leading-5 text-cw-text">{offer.title}</p>
        <p className="text-[13px] leading-5 text-cw-muted">{when}</p>
        <p className="mt-1.5 line-clamp-2 text-[13px] leading-5 text-cw-muted">{offer.prompt}</p>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-[12.5px] leading-5 text-cw-muted">Aún no está programada: revísala y guárdala.</p>
      <CwButton size="sm" variant="primary" onClick={onOpen}><CalendarClock aria-hidden="true" />Revisar y programar</CwButton>
    </div>
  </m.section>;
}
