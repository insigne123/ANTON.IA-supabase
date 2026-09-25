'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { coworkShortTime, coworkStatusCopy, type CoworkIconKey, type CoworkThreadSummary } from '@/lib/cowork/presentation';
import { CoworkIcon, CoworkMark, CwStatusPill } from './ui';

export const COWORK_SUGGESTIONS: Array<{ icon: CoworkIconKey; title: string; prompt: string }> = [
  { icon: 'reply', title: 'Revisar mis pendientes', prompt: 'Revisa mis pendientes de hoy: respuestas por atender, seguimientos vencidos y reuniones por confirmar. Prioriza lo más urgente y dime qué hago primero.' },
  { icon: 'globe', title: 'Buscar nuevos prospectos', prompt: 'Busca gerentes de recursos humanos en empresas de más de 200 empleados en Santiago de Chile.' },
  { icon: 'chart', title: 'Informe de la semana', prompt: 'Prepara un informe de mis métricas de los últimos 7 días: envíos, respuestas y tasas, con lo que conviene mejorar.' },
  { icon: 'campaign', title: 'Armar una campaña', prompt: 'Arma una campaña de seguimiento para mis contactos guardados del sector logística. Muéstrame los mensajes antes de crearla.' },
  { icon: 'shield', title: 'Revisar entregabilidad', prompt: 'Revisa la entregabilidad de mi dominio y dime qué corregir para no caer en spam.' },
  { icon: 'contacts', title: 'Revisar un contacto', prompt: 'Revisa a [nombre del contacto] y dime si está listo para contactar.' },
];

function greeting(hour: number) {
  if (hour < 5 || hour >= 20) return 'Buenas noches';
  if (hour < 13) return 'Buenos días';
  return 'Buenas tardes';
}

/** Start screen: one clear action (the composer), a few concrete starting points. */
export function CoworkHome({ composer, threads, ready, loading, onSuggestion, onOpenThread }: {
  composer: ReactNode;
  threads: CoworkThreadSummary[];
  ready: boolean;
  loading: boolean;
  onSuggestion: (prompt: string) => void;
  onOpenThread: (id: string) => void;
}) {
  const [hello, setHello] = useState('Hola');
  useEffect(() => { setHello(greeting(new Date().getHours())); }, []);
  const pending = threads.filter(thread => ['waiting_approval', 'running', 'queued', 'waiting_workers'].includes(thread.status)).slice(0, 3);
  const recent = threads.filter(thread => !pending.includes(thread)).slice(0, 4);

  return <div className="cw-scroll flex h-full min-h-0 flex-col overflow-y-auto">
    <div className="mx-auto flex w-full max-w-[46rem] flex-1 flex-col justify-center px-4 py-10 sm:px-6 md:py-16">
      <div className="cw-rise mb-7 flex flex-col items-center text-center">
        <CoworkMark size={44} className="mb-4" />
        <h1 className="font-cw-heading text-2xl font-semibold leading-tight tracking-[-0.025em] text-cw-text sm:text-[2rem]">{hello}. ¿En qué avanzamos hoy?</h1>
        <p className="mt-2 max-w-[34rem] text-[14.5px] leading-6 text-cw-muted">Consulto tus contactos, CRM, campañas y métricas, y preparo informes o borradores. Antes de cambiar algo te pido aprobación.</p>
      </div>
      <div className="cw-rise [animation-delay:60ms]">{composer}</div>
      {!ready && !loading && <p className="mt-3 text-center text-[13px] text-cw-muted">El procesamiento todavía no está disponible. Puedes consultar los trabajos guardados.</p>}
      <div className="cw-rise mt-5 flex flex-wrap justify-center gap-2 [animation-delay:120ms]">
        {COWORK_SUGGESTIONS.map(item => <button key={item.title} type="button" onClick={() => onSuggestion(item.prompt)}
          className="inline-flex items-center gap-2 rounded-full border border-cw-border bg-cw-elevated px-3.5 py-2 text-[13.5px] text-cw-text shadow-[var(--cw-shadow-sm)] transition-colors hover:border-cw-border-strong hover:bg-cw-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">
          <CoworkIcon name={item.icon} className="h-4 w-4 text-cw-accent" />{item.title}
        </button>)}
      </div>
      {(pending.length > 0 || recent.length > 0) && <div className="cw-rise mt-10 [animation-delay:180ms]">
        <h2 className="mb-2 px-1 text-[12.5px] font-medium text-cw-muted">{pending.length ? 'Continúa donde quedaste' : 'Recientes'}</h2>
        <ul className="divide-y divide-cw-border overflow-hidden rounded-2xl border border-cw-border bg-cw-elevated">
          {[...pending, ...recent].slice(0, 5).map(thread => {
            const status = coworkStatusCopy(thread.status);
            return <li key={thread.rootId}>
              <button type="button" onClick={() => onOpenThread(thread.id)}
                className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-cw-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--cw-accent-ring)]">
                <span className="min-w-0 flex-1 truncate text-[14px] text-cw-text">{thread.title}</span>
                <CwStatusPill tone={status.tone}>{status.label}</CwStatusPill>
                <span className="hidden w-12 shrink-0 text-right text-[12px] text-cw-faint sm:inline">{coworkShortTime(thread.updatedAt)}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-cw-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </button>
            </li>;
          })}
        </ul>
      </div>}
    </div>
  </div>;
}
