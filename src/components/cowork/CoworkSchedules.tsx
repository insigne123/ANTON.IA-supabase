'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { CalendarClock, LoaderCircle, MoreHorizontal, Pause, Pencil, Play, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { COWORK_SCHEDULE_LIMITS, coworkScheduleWhen, type CoworkScheduleFrequency } from '@/lib/cowork/schedules';
import { coworkScheduleHint } from '@/lib/cowork/schedule-hint';
import { COWORK_DEFAULT_TIME_ZONE, coworkZoneLabel } from '@/lib/cowork/time-zone';
import { cn } from '@/lib/utils';
import { CwButton } from './ui';

/** What the API sends for each task (server/cowork/schedules.ts, coworkTaskFromRow). */
export type CoworkScheduledTaskView = {
  id: string; title: string; prompt: string; frequency: CoworkScheduleFrequency; time: string; weekday: number | null; monthDay: number | null;
  timeZone: string; description: string; status: 'proposed' | 'active' | 'paused'; nextRunAt: string | null; lastRunAt: string | null;
  lastStatus: 'admitted' | 'skipped' | 'failed' | null; runCount: number;
};

type Draft = { title: string; prompt: string; frequency: CoworkScheduleFrequency; weekday: number; monthDay: number; time: string };
const EMPTY_DRAFT: Draft = { title: '', prompt: '', frequency: 'weekly', weekday: 1, monthDay: 1, time: '09:00' };
const FREQUENCIES: Array<{ value: CoworkScheduleFrequency; label: string }> = [
  { value: 'daily', label: 'Todos los días' }, { value: 'weekdays', label: 'De lunes a viernes' },
  { value: 'weekly', label: 'Una vez por semana' }, { value: 'monthly', label: 'Una vez al mes' },
];
const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const field = 'h-9 w-full rounded-lg border border-cw-border-strong bg-cw-elevated px-2.5 text-[13.5px] text-cw-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] disabled:opacity-60';

const draftOf = (task: CoworkScheduledTaskView): Draft => ({
  title: task.title, prompt: task.prompt, frequency: task.frequency, weekday: task.weekday ?? 1, monthDay: task.monthDay ?? 1, time: task.time,
});

/** What the form sends: the day that does not belong to the frequency is left out. */
const bodyOf = (draft: Draft) => ({
  title: draft.title.trim(), prompt: draft.prompt.trim(), frequency: draft.frequency, time: draft.time,
  ...(draft.frequency === 'weekly' ? { weekday: draft.weekday } : {}), ...(draft.frequency === 'monthly' ? { monthDay: draft.monthDay } : {}),
});

/** When the task ran last, as the person counts it: today at its time, yesterday, a few days ago, or the date. */
export function coworkScheduleLastRun(iso: string, now = new Date()) {
  const then = new Date(iso);
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(then)) / 86_400_000);
  if (days <= 0) return `hoy a las ${then.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;
  return `el ${then.toLocaleDateString('es-CL', { day: 'numeric', month: 'long' })}`;
}

/** The line under a task: when it fires next, or why it does not, and what happened the last time. */
export function coworkScheduleStatusLine(task: CoworkScheduledTaskView, now = new Date()) {
  const next = task.status === 'active' && task.nextRunAt ? `Próxima: ${coworkScheduleWhen(new Date(task.nextRunAt), task.timeZone)}` : 'Pausada';
  if (task.status === 'paused' && task.lastStatus === 'failed') return 'Pausada porque no pudo iniciarse tres veces seguidas';
  const last = task.lastStatus === 'admitted' && task.lastRunAt ? `Última vez: ${coworkScheduleLastRun(task.lastRunAt, now)}`
    : task.lastStatus === 'skipped' ? 'La última vez se omitió: el sistema estaba detenido'
      : task.lastStatus === 'failed' ? 'La última vez no pudo iniciarse y se reintenta' : '';
  return [next, last].filter(Boolean).join(' · ');
}

/**
 * «Tareas programadas»: the requests Cowork does by itself at the time you choose («cada lunes, dime a quién escribir hoy»). Each run
 * starts a conversation in your list; whatever needs a decision waits there for your approval. Create, edit, pause, run now and delete.
 */
export function CoworkSchedules({ open, onOpenChange, onStarted, initialPrompt = '' }: {
  open: boolean; onOpenChange: (open: boolean) => void; onStarted?: () => void;
  /** A request to repeat («Programar» in the message box): the form opens with it, and with the when it already says. */
  initialPrompt?: string;
}) {
  const [tasks, setTasks] = useState<CoworkScheduledTaskView[] | null>(null);
  const [limit, setLimit] = useState<number>(COWORK_SCHEDULE_LIMITS.active);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<{ editing: string | null; draft: Draft } | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const ids = useId();

  const load = useCallback(async () => {
    setError(''); setTasks(null);
    try {
      const response = await fetch('/api/cowork/schedules', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No pudimos leer tus tareas programadas.');
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      if (typeof data.limits?.active === 'number') setLimit(data.limits.active);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No pudimos leer tus tareas programadas.');
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    setNotice(''); setConfirming(null); setProblem('');
    const text = initialPrompt.trim();
    if (text) {
      const hint = coworkScheduleHint(text);
      setForm({ editing: null, draft: {
        title: hint.title.slice(0, COWORK_SCHEDULE_LIMITS.titleMax), prompt: text.slice(0, COWORK_SCHEDULE_LIMITS.promptMax),
        frequency: hint.frequency ?? 'weekly', weekday: hint.weekday ?? 1, monthDay: hint.monthDay ?? 1, time: hint.time ?? '09:00',
      } });
    } else setForm(null);
    void load();
  }, [open, initialPrompt, load]);

  const call = async (id: string, request: () => Promise<Response>, failure: string) => {
    setBusy(id); setNotice('');
    try {
      const response = await request();
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || failure);
      return data as Record<string, any>;
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : failure);
      return null;
    } finally {
      setBusy(null);
    }
  };
  const replace = (task: CoworkScheduledTaskView) => setTasks(current => (current || []).map(item => item.id === task.id ? task : item));
  const json = (method: string, body?: unknown): RequestInit => ({ method, cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  const save = async () => {
    if (!form || busy) return;
    const { editing, draft } = form;
    setProblem('');
    if (draft.title.trim().length < 3) return setProblem('Ponle un nombre de al menos 3 letras.');
    if (draft.prompt.trim().length < COWORK_SCHEDULE_LIMITS.promptMin) return setProblem('Escribe el pedido completo, como se lo harías a Cowork.');
    setBusy('form');
    try {
      const response = await fetch(editing ? `/api/cowork/schedules/${editing}` : '/api/cowork/schedules', json(editing ? 'PATCH' : 'POST', bodyOf(draft)));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No pudimos guardar la tarea.');
      const task = data.task as CoworkScheduledTaskView;
      setTasks(current => editing ? (current || []).map(item => item.id === task.id ? task : item) : [...(current || []), task]);
      setForm(null);
      setNotice(editing ? 'Listo, guardé los cambios.' : `Programada: ${task.description.charAt(0).toLowerCase()}${task.description.slice(1)}.`);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'No pudimos guardar la tarea.');
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (task: CoworkScheduledTaskView) => {
    const data = await call(task.id, () => fetch(`/api/cowork/schedules/${task.id}`, json('PATCH', { enabled: task.status !== 'active' })), 'No pudimos cambiar la tarea.');
    if (data?.task) { replace(data.task); setNotice(data.task.status === 'active' ? 'Reanudada.' : 'En pausa: no se ejecutará hasta que la reanudes.'); }
  };
  const runNow = async (task: CoworkScheduledTaskView) => {
    const data = await call(task.id, () => fetch(`/api/cowork/schedules/${task.id}/run`, json('POST')), 'No pudimos ejecutarla ahora.');
    if (data) { setNotice('Empezó: la conversación aparece en tu lista en unos segundos.'); onStarted?.(); void load(); }
  };
  const remove = async (task: CoworkScheduledTaskView) => {
    const data = await call(task.id, () => fetch(`/api/cowork/schedules/${task.id}`, json('DELETE')), 'No pudimos eliminarla.');
    setConfirming(null);
    if (data) { setTasks(current => (current || []).filter(item => item.id !== task.id)); setNotice('Eliminada. Las conversaciones que ya empezó siguen en tu lista.'); }
  };

  const active = (tasks || []).filter(task => task.status === 'active').length;
  const full = active >= limit;
  const draft = form?.draft ?? EMPTY_DRAFT;
  // The server keeps the organization's zone for every task: the ones already saved say which.
  const zone = tasks?.[0]?.timeZone || COWORK_DEFAULT_TIME_ZONE;
  const set = (patch: Partial<Draft>) => setForm(current => current && { ...current, draft: { ...current.draft, ...patch } });

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[88vh] max-w-lg gap-0 overflow-hidden border-cw-border bg-cw-bg p-0 text-cw-text sm:rounded-2xl">
      <div className="border-b border-cw-border px-5 pb-3.5 pt-5 pr-12">
        <DialogTitle className="text-[16px] font-semibold text-cw-text">Tareas programadas</DialogTitle>
        <DialogDescription className="mt-1 text-[13px] leading-5 text-cw-muted">
          Cowork hace este pedido por ti a la hora que elijas y te deja el resultado en una conversación. Si algo necesita tu decisión, queda como propuesta: nada se envía sin tu aprobación.
        </DialogDescription>
      </div>

      <div className="cw-scroll max-h-[62vh] space-y-3 overflow-y-auto px-5 py-4">
        {form ? <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-3.5" aria-label={form.editing ? 'Editar tarea programada' : 'Nueva tarea programada'}>
          <div>
            <label htmlFor={`${ids}-title`} className="mb-1 block text-[12.5px] font-medium text-cw-text">Nombre</label>
            <input id={`${ids}-title`} className={field} value={draft.title} maxLength={COWORK_SCHEDULE_LIMITS.titleMax} autoFocus
              placeholder="Resumen del lunes" onChange={event => set({ title: event.target.value })} />
          </div>
          <div>
            <label htmlFor={`${ids}-prompt`} className="mb-1 block text-[12.5px] font-medium text-cw-text">Qué debe hacer</label>
            <textarea id={`${ids}-prompt`} className={cn(field, 'h-28 resize-y py-2 leading-5')} value={draft.prompt} maxLength={COWORK_SCHEDULE_LIMITS.promptMax}
              aria-describedby={`${ids}-prompt-help`} placeholder="Dime quién respondió esta semana, a quién escribir hoy y por qué."
              onChange={event => set({ prompt: event.target.value })} />
            <p id={`${ids}-prompt-help`} className="mt-1 text-[12px] leading-4 text-cw-muted">Escríbelo completo: quien lo ejecuta no tiene esta conversación.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${ids}-frequency`} className="mb-1 block text-[12.5px] font-medium text-cw-text">Con qué frecuencia</label>
              <select id={`${ids}-frequency`} className={field} value={draft.frequency} onChange={event => set({ frequency: event.target.value as CoworkScheduleFrequency })}>
                {FREQUENCIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`${ids}-time`} className="mb-1 block text-[12.5px] font-medium text-cw-text">A las <span className="font-normal text-cw-muted">· {coworkZoneLabel(zone)}</span></label>
              <input id={`${ids}-time`} type="time" className={field} value={draft.time} required onChange={event => set({ time: event.target.value })} />
            </div>
          </div>
          {draft.frequency === 'weekly' && <div>
            <label htmlFor={`${ids}-weekday`} className="mb-1 block text-[12.5px] font-medium text-cw-text">Qué día</label>
            <select id={`${ids}-weekday`} className={field} value={draft.weekday} onChange={event => set({ weekday: Number(event.target.value) })}>
              {WEEKDAYS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
            </select>
          </div>}
          {draft.frequency === 'monthly' && <div>
            <label htmlFor={`${ids}-monthday`} className="mb-1 block text-[12.5px] font-medium text-cw-text">Qué día del mes</label>
            <select id={`${ids}-monthday`} className={field} value={draft.monthDay} onChange={event => set({ monthDay: Number(event.target.value) })}>
              {Array.from({ length: 28 }, (_, index) => index + 1).map(day => <option key={day} value={day}>{day}</option>)}
            </select>
          </div>}
          {problem && <p role="alert" className="text-[13px] text-cw-danger">{problem}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <CwButton size="sm" variant="ghost" disabled={busy === 'form'} onClick={() => { setForm(null); setProblem(''); }}>Cancelar</CwButton>
            <CwButton size="sm" variant="primary" type="submit" disabled={busy === 'form'}>
              {busy === 'form' ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> : null}{form.editing ? 'Guardar cambios' : 'Programar'}
            </CwButton>
          </div>
        </form> : <>
          {tasks === null && !error && <p role="status" className="flex items-center gap-2 text-[13px] text-cw-muted">
            <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />Cargando…
          </p>}
          {error && <div className="space-y-2">
            <p role="alert" className="text-[13px] text-cw-danger">{error}</p>
            <CwButton size="xs" variant="secondary" onClick={() => void load()}><RotateCcw aria-hidden="true" />Reintentar</CwButton>
          </div>}
          {tasks && tasks.length === 0 && <div className="rounded-xl border border-dashed border-cw-border px-4 py-6 text-center">
            <CalendarClock className="mx-auto h-5 w-5 text-cw-muted" aria-hidden="true" />
            <p className="mt-2 text-[13.5px] font-medium text-cw-text">Todavía no programaste nada</p>
            <p className="mt-1 text-[12.5px] leading-5 text-cw-muted">Pide algo que quieras recibir sin acordarte: «cada lunes, dime a quién escribir hoy» o «todas las mañanas, revisa si hay respuestas nuevas».</p>
          </div>}
          {tasks && tasks.length > 0 && <ul className="divide-y divide-cw-border rounded-xl border border-cw-border bg-cw-elevated">
            {tasks.map(task => <li key={task.id} className="flex items-start gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className={cn('break-words text-[13.5px] font-medium leading-5', task.status === 'active' ? 'text-cw-text' : 'text-cw-muted')}>{task.title}</p>
                <p className="text-[12.5px] leading-5 text-cw-muted">{task.description}</p>
                <p className="text-[12px] leading-5 text-cw-muted">{coworkScheduleStatusLine(task)}</p>
              </div>
              {confirming === task.id
                ? <div className="flex shrink-0 items-center gap-1">
                  <CwButton size="xs" variant="danger" disabled={busy === task.id} onClick={() => void remove(task)}>{busy === task.id ? 'Eliminando…' : 'Sí, eliminar'}</CwButton>
                  <CwButton size="xs" variant="ghost" disabled={busy === task.id} onClick={() => setConfirming(null)}>No</CwButton>
                </div>
                : <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <CwButton size="icon-sm" variant="ghost" className="-mr-1.5 h-7 w-7 shrink-0" aria-label={`Opciones de «${task.title}»`} disabled={busy === task.id}>
                      {busy === task.id ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> : <MoreHorizontal aria-hidden="true" />}
                    </CwButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48 rounded-xl border-cw-border bg-cw-elevated p-1 text-cw-text shadow-[var(--cw-shadow)]">
                    <DropdownMenuItem onSelect={() => void runNow(task)} className="gap-2 rounded-lg px-2.5 py-2 text-[13px] focus:bg-cw-hover focus:text-cw-text">
                      <Play className="h-4 w-4 text-cw-muted" aria-hidden="true" />Ejecutar ahora
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => { setForm({ editing: task.id, draft: draftOf(task) }); setProblem(''); setNotice(''); }}
                      className="gap-2 rounded-lg px-2.5 py-2 text-[13px] focus:bg-cw-hover focus:text-cw-text">
                      <Pencil className="h-4 w-4 text-cw-muted" aria-hidden="true" />Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void toggle(task)} disabled={task.status !== 'active' && full}
                      className="gap-2 rounded-lg px-2.5 py-2 text-[13px] focus:bg-cw-hover focus:text-cw-text">
                      {task.status === 'active' ? <><Pause className="h-4 w-4 text-cw-muted" aria-hidden="true" />Pausar</> : <><Play className="h-4 w-4 text-cw-muted" aria-hidden="true" />Reanudar</>}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setConfirming(task.id)}
                      className="gap-2 rounded-lg px-2.5 py-2 text-[13px] text-cw-danger focus:bg-cw-danger-soft focus:text-cw-danger">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />Eliminar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>}
            </li>)}
          </ul>}
          {tasks && <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-[12px] text-cw-muted">{full ? `Tienes ${limit} tareas activas, el máximo. Pausa o elimina una para crear otra.` : tasks.length ? `${active} de ${limit} activas` : ''}</p>
            <CwButton size="sm" variant="primary" disabled={full} onClick={() => { setForm({ editing: null, draft: EMPTY_DRAFT }); setProblem(''); setNotice(''); }}>
              <Plus aria-hidden="true" />Nueva tarea
            </CwButton>
          </div>}
        </>}
      </div>
      <p role="status" className={cn('border-t border-cw-border px-5 py-2.5 text-[12.5px] text-cw-muted', !notice && 'sr-only')}>{notice}</p>
    </DialogContent>
  </Dialog>;
}

/**
 * Whether the tasks are on for this account (the list answers `enabled`). The rail and the message box show their buttons only then, so
 * an account without the feature sees what it always saw.
 */
/**
 * Whether the account has «Tareas programadas», how many are on and when the next one fires: the rail names them instead of
 * hiding them behind an icon (COW-19). `refresh` reads them again, after the dialog closes.
 */
export function useCoworkSchedules() {
  const [summary, setSummary] = useState<{ available: boolean; active: number; next: string | null }>({ available: false, active: 0, next: null });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let disposed = false;
    fetch('/api/cowork/schedules', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (disposed || data?.enabled !== true) return;
        const active = ((data.tasks || []) as CoworkScheduledTaskView[]).filter(task => task.status === 'active' && task.nextRunAt)
          .sort((a, b) => Date.parse(a.nextRunAt!) - Date.parse(b.nextRunAt!));
        setSummary({ available: true, active: active.length, next: active[0] ? coworkScheduleWhen(new Date(active[0].nextRunAt!), active[0].timeZone) : null });
      })
      .catch(() => undefined);
    return () => { disposed = true; };
  }, [version]);
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  return { ...summary, refresh };
}
