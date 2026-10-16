'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { BellPlus, CalendarPlus, Check, Download, Highlighter, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { REMINDER_OPTIONS, emptyMark, googleCalendarUrl, reportCalendarFile, type ReminderId, type ReportMark, type ReportMarks } from '@/lib/commercial-opportunities/report-marks';

export type MarkChange = { key: string; label: string; done?: boolean; highlight?: boolean; note?: string };

/**
 * The team's marks on one screen: at once on screen, back as they were if the server says no. Without the table (or
 * without a way to save) the screen reads as before, with nothing to tick.
 */
export function useReportMarks(initial: { available: boolean; items: ReportMarks } | null | undefined, onMark?: (change: MarkChange) => Promise<ReportMark | null>) {
  const interactive = Boolean(initial?.available && onMark);
  const [marks, setMarks] = useState<ReportMarks>(initial?.items ?? {});
  useEffect(() => { setMarks(initial?.items ?? {}); }, [initial]);
  const [saving, setSaving] = useState(false);
  const change = async (input: MarkChange) => {
    if (!onMark) return;
    const before = marks[input.key];
    setMarks(current => ({ ...current, [input.key]: { ...(current[input.key] ?? emptyMark(input.key)),
      ...(input.done !== undefined ? { done: input.done } : {}), ...(input.highlight !== undefined ? { highlight: input.highlight } : {}), ...(input.note !== undefined ? { note: input.note.trim() } : {}) } }));
    setSaving(true);
    const saved = await onMark(input).catch(() => null);
    setSaving(false);
    setMarks(current => { const next = { ...current }; if (saved) next[input.key] = saved; else if (before) next[input.key] = before; else delete next[input.key]; return next; });
  };
  return { interactive, marks, saving, change };
}

/** A round check the size of a fingertip: «listo» or not, with the item's name for screen readers. */
export function DoneCheck({ done, label, disabled, onChange }: { done: boolean; label: string; disabled?: boolean; onChange: (done: boolean) => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={done} aria-label={`Listo: ${label}`} disabled={disabled} onClick={() => onChange(!done)}
      className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50',
        done ? 'border-cw-success bg-cw-success text-white dark:text-background' : 'border-muted-foreground/40 hover:border-primary')}>
      {done ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" /> : null}
    </button>
  );
}

/** The item's quiet tools: highlight it and write a note. They appear on hover or focus and stay when in use. */
export function ItemTools({ mark, label, disabled, onChange, onNote }: { mark: ReportMark; label: string; disabled?: boolean; onChange: (change: MarkChange) => void; onNote: () => void }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-pressed={mark.highlight} aria-label={mark.highlight ? `Quitar destacado: ${label}` : `Destacar: ${label}`}
        onClick={() => onChange({ key: mark.key, label, highlight: !mark.highlight })}
        className={cn('h-7 w-7', mark.highlight ? 'text-cw-warning' : 'text-muted-foreground/70 hover:text-foreground')}>
        <Highlighter className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={mark.note ? `Editar nota: ${label}` : `Agregar nota: ${label}`} onClick={onNote}
        className={cn('h-7 w-7', mark.note ? 'text-primary' : 'text-muted-foreground/70 hover:text-foreground')}>
        <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </span>
  );
}

/** A note beside its item: warm paper, the author and when. Editing happens in place. */
export function NoteCard({ mark, label, editing, author, when, disabled, onSave, onCancel, onEdit }: {
  mark: ReportMark; label: string; editing: boolean; author?: string | null; when?: string | null; disabled?: boolean;
  onSave: (note: string) => void; onCancel: () => void; onEdit: () => void;
}) {
  const [draft, setDraft] = useState(mark.note);
  useEffect(() => { if (editing) setDraft(mark.note); }, [editing, mark.note]);
  if (!editing && !mark.note) return null;
  const id = `note-${mark.key.replace(':', '-')}`;
  return (
    <aside aria-label={`Nota: ${label}`} className="rounded-xl border border-cw-warning/25 bg-cw-warning-soft px-3 py-2.5 text-sm shadow-[0_1px_0_rgba(0,0,0,0.03)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-1">
      {editing ? (
        <form className="space-y-2" onSubmit={event => { event.preventDefault(); onSave(draft); }}>
          <label htmlFor={id} className="sr-only">Nota para {label}</label>
          <Textarea id={id} autoFocus value={draft} maxLength={2000} rows={3} onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Escape') onCancel(); if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onSave(draft); } }}
            placeholder="Ej.: lo ve Ana con el banco; pedir la boleta el lunes." className="min-h-[72px] resize-y border-cw-warning/30 bg-background/80 text-sm" />
          <div className="flex justify-end gap-1.5">
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onCancel}>Cancelar</Button>
            <Button type="submit" size="sm" className="h-7 px-3 text-xs" disabled={disabled || draft.trim() === mark.note.trim()}>Guardar nota</Button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={onEdit} className="block w-full rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <p className="whitespace-pre-wrap leading-6 text-foreground">{mark.note}</p>
          {author || when ? <p className="mt-1 text-[11px] text-muted-foreground">{[author, when].filter(Boolean).join(' · ')}</p> : null}
        </button>
      )}
    </aside>
  );
}

/** One item of the report with its marks: the check, the text, the tools and its note beside it on wide screens. */
export function MarkedItem({ markKey, label, marks, checkable = true, disabled, onChange, authorOf, whenOf, children }: {
  markKey: string; label: string; marks: Record<string, ReportMark> | null; checkable?: boolean; disabled?: boolean;
  onChange: (change: MarkChange) => void; authorOf?: (userId?: string | null) => string | null; whenOf?: (at?: string | null) => string | null; children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  if (!marks) return <>{children}</>;
  const mark = marks[markKey] ?? emptyMark(markKey);
  return (
    <div id={`mark-${markKey.replace(':', '-')}`} className={cn('group/item grid scroll-mt-24 gap-3 rounded-xl transition-colors xl:grid-cols-[minmax(0,1fr)_15rem]',
      mark.highlight && '-mx-2 bg-cw-warning-soft/70 px-2 py-1 ring-1 ring-cw-warning/20')}>
      <div className="flex min-w-0 items-start gap-3">
        {checkable ? <DoneCheck done={mark.done} label={label} disabled={disabled} onChange={done => onChange({ key: markKey, label, done })} /> : null}
        <div className={cn('min-w-0 flex-1', mark.done && checkable && '[&_.mark-title]:text-muted-foreground [&_.mark-title]:line-through [&_.mark-title]:decoration-muted-foreground/40')}>{children}</div>
        <span className={cn('transition-opacity', mark.highlight || mark.note || editing ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover/item:opacity-100 sm:group-focus-within/item:opacity-100')}>
          <ItemTools mark={mark} label={label} disabled={disabled} onChange={onChange} onNote={() => setEditing(true)} />
        </span>
      </div>
      <NoteCard mark={mark} label={label} editing={editing} disabled={disabled} author={authorOf?.(mark.updatedBy)} when={whenOf?.(mark.updatedAt)}
        onEdit={() => setEditing(true)} onCancel={() => setEditing(false)}
        onSave={note => { onChange({ key: markKey, label, note }); setEditing(false); }} />
    </div>
  );
}

function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const fileName = (title: string) => `${title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Oportunidad'}.ics`;

/** «Recordarme»: when to be told (the same day, a day, three days or a week before) and where (Google Calendar or a file). */
export function ReminderMenu({ title, events, label = 'Recordarme', compact = false }: {
  title: string; events: Array<{ uid: string; label: string; date: string; at: Date; details?: string }>; label?: string; compact?: boolean;
}) {
  const [reminder, setReminder] = useState<ReminderId>('1d');
  if (!events.length) return null;
  const single = events.length === 1 ? events[0] : null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant={compact ? 'ghost' : 'outline'} size="sm" className={cn(compact ? 'h-7 px-2 text-xs text-muted-foreground' : '')}>
          <BellPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div>
          <p className="text-sm font-semibold">{single ? single.label : `${events.length} fechas`}</p>
          <p className="text-xs text-muted-foreground">{single ? single.date : 'Cada una con el aviso que elijas.'}</p>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-muted-foreground">Avísame</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {REMINDER_OPTIONS.map(option => (
              <button key={option.id} type="button" aria-pressed={reminder === option.id} onClick={() => setReminder(option.id)}
                className={cn('rounded-lg border px-2 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  reminder === option.id ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border hover:bg-muted/60')}>
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-1.5">
          {single ? (
            <Button asChild size="sm" className="justify-start">
              <a href={googleCalendarUrl({ title, label: single.label, date: single.date, at: single.at, reminder, details: single.details })} target="_blank" rel="noopener noreferrer">
                <CalendarPlus className="mr-2 h-4 w-4" aria-hidden="true" />Agregar a Google Calendar
              </a>
            </Button>
          ) : null}
          <Button type="button" size="sm" variant={single ? 'outline' : 'default'} className="justify-start"
            onClick={() => saveFile(fileName(title), reportCalendarFile({ title, events: events.map(event => ({ ...event, reminder })) }))}>
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />{single ? 'Descargar para otro calendario' : 'Descargar todas (.ics)'}
          </Button>
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">
          {single ? 'En Google Calendar el aviso queda como un evento en el momento que elegiste. ' : ''}El archivo .ics funciona en Google Calendar, Outlook y Apple Calendar.
        </p>
      </PopoverContent>
    </Popover>
  );
}
