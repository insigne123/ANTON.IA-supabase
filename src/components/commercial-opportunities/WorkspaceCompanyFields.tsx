'use client';

import type { ReactNode } from 'react';
import { Briefcase, CalendarClock, MapPin } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type Draft = Record<string, any>;
const PRIORITIES = [['hiring', 'Avisos de trabajo'], ['balanced', 'Ambos por igual'], ['posts', 'Publicaciones']] as const;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const lines = (text: unknown) => String(text || '').split('\n').map(line => line.trim()).filter(Boolean);

/** One group of the form: a title, a line that says what it is for, and its fields on a quiet surface. */
function Group({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{hint}</p>
        </div>
      </div>
      <div className="space-y-4 rounded-2xl border bg-muted/30 p-4 sm:p-5">{children}</div>
    </section>
  );
}

const areaClass = 'resize-y bg-background leading-6';

/**
 * «Tu empresa»: what the company sells (the AI reads it to search and to decide what fits), where it works and
 * what it does not do, and when the daily search runs. The form around it saves (OpportunityWorkWorkspace.tsx).
 */
export function WorkspaceCompanyFields({ draft, field }: { draft: Draft; field: (name: string, value: unknown) => void }) {
  const services = lines(draft.services).length;
  return (
    <div className="space-y-7">
      <Group icon={<Briefcase />} title="Qué vende tu empresa" hint="La IA lo lee para buscar y para decidir qué oportunidades te convienen.">
        <div className="space-y-2">
          <Label htmlFor="op-offer">Qué ofrece</Label>
          <Textarea id="op-offer" rows={6} required className={areaClass} value={draft.offer || ''} onChange={event => field('offer', event.target.value)}
            placeholder="Ej.: Automatizamos la consulta de causas judiciales de postulantes para empresas que contratan en volumen. Entregamos un reporte por persona en menos de 24 horas." />
        </div>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="op-services">Servicios o productos</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{services ? `${services} ${services === 1 ? 'servicio' : 'servicios'}` : 'Uno por línea'}</span>
          </div>
          <Textarea id="op-services" rows={5} required className={areaClass} value={draft.services || ''} onChange={event => field('services', event.target.value)}
            placeholder={'Ej.:\nVerificación de antecedentes de postulantes\nMonitoreo de causas laborales'} />
        </div>
      </Group>

      <Group icon={<MapPin />} title="Alcance" hint="Opcional. Ayuda a descartar lo que queda fuera de tu zona o de lo que haces.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="op-territories">Dónde trabajas</Label>
            <Textarea id="op-territories" rows={3} className={areaClass} value={draft.territories || ''} onChange={event => field('territories', event.target.value)} placeholder={'Ej.:\nRegión Metropolitana\nValparaíso'} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="op-exclusions">Qué no ofreces</Label>
            <Textarea id="op-exclusions" rows={3} className={areaClass} value={draft.exclusions || ''} onChange={event => field('exclusions', event.target.value)} placeholder="Ej.: No hacemos reclutamiento ni vendemos software de terceros" />
          </div>
        </div>
      </Group>

      <Group icon={<CalendarClock />} title="Búsqueda diaria" hint="Cada mañana revisamos licitaciones, Compra Ágil y LinkedIn con tu oferta.">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="op-automation" className="min-w-0 space-y-0.5 font-normal">
            <span className="block text-sm font-medium">Buscar oportunidades nuevas cada día</span>
            <span className="block text-xs text-muted-foreground">{draft.automation ? `A las ${String(Number(draft.hour) || 0).padStart(2, '0')}:00, hora de Chile.` : 'Pausada: solo buscas cuando pulsas «Actualizar oportunidades».'}</span>
          </Label>
          <Switch id="op-automation" checked={Boolean(draft.automation)} onCheckedChange={checked => field('automation', checked)} />
        </div>
        <div className={cn('grid gap-4 border-t pt-4 sm:grid-cols-[10rem_minmax(0,1fr)]', !draft.automation && 'opacity-60')}>
          <div className="space-y-2">
            <Label htmlFor="op-hour">Hora</Label>
            <select id="op-hour" value={String(Number(draft.hour) || 0)} disabled={!draft.automation} onChange={event => field('hour', Number(event.target.value))}
              className="block h-10 w-full rounded-md border bg-background px-3 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed">
              {HOURS.map(hour => <option key={hour} value={hour}>{`${String(hour).padStart(2, '0')}:00`}</option>)}
            </select>
          </div>
          <div className="min-w-0 space-y-2">
            <p id="op-priority-label" className="text-sm font-medium leading-none">En LinkedIn, primero</p>
            <div role="group" aria-labelledby="op-priority-label" className="grid grid-cols-3 rounded-xl bg-muted p-1">
              {PRIORITIES.map(([value, label]) => <button key={value} type="button" aria-pressed={(draft.priority || 'balanced') === value} onClick={() => field('priority', value)}
                className={cn('min-w-0 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm',
                  (draft.priority || 'balanced') === value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{label}</button>)}
            </div>
          </div>
        </div>
      </Group>
    </div>
  );
}
