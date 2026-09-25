'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import { ArrowUp, LoaderCircle, Paperclip, Square, X } from 'lucide-react';
import type { CoworkExecutionMode } from '@/lib/cowork/execution-policy';
import { cn } from '@/lib/utils';
import { ExecutionMode } from './ExecutionMode';
import { CwButton } from './ui';

export type CoworkComposerHandle = { focus: () => void };

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  ready: boolean;
  sending: boolean;
  submitLabel: string;
  /** Shows a stop button while the current step runs and the box is empty. */
  onStop?: (() => void) | null;
  stopping?: boolean;
  canAutonomous?: boolean;
  mode: CoworkExecutionMode;
  onModeChange: (mode: CoworkExecutionMode) => void;
  onToggleFiles?: (() => void) | null;
  filesOpen?: boolean;
  attachments?: ReactNode;
  queued?: { text: string; note: string; onCancel: () => void; onSendNow?: (() => void) | null } | null;
  footnote?: ReactNode;
  size?: 'large' | 'regular';
};

/** Persistent composer: Enter sends, Shift+Enter adds a line, grows with the text. */
export const CoworkComposer = forwardRef<CoworkComposerHandle, Props>(function CoworkComposer({
  id, value, onChange, onSubmit, placeholder, ready, sending, submitLabel, onStop, stopping = false,
  canAutonomous = false, mode, onModeChange, onToggleFiles, filesOpen = false, attachments, queued, footnote, size = 'regular',
}, ref) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => textarea.current?.focus() }), []);

  useEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = 'auto';
    const max = size === 'large' ? 280 : 240;
    node.style.height = `${Math.min(node.scrollHeight, max)}px`;
    node.style.overflowY = node.scrollHeight > max ? 'auto' : 'hidden';
  }, [value, size]);

  const canSend = ready && !sending && Boolean(value.trim());
  const showStop = Boolean(onStop) && !value.trim() && !sending;

  return <div className="w-full">
    {queued && <div className="cw-rise mb-2 flex items-start gap-2 rounded-xl border border-cw-border bg-cw-panel px-3 py-2 text-[13px]">
      <LoaderCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cw-muted motion-safe:animate-spin" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-cw-muted">{queued.note}</p>
        <p className="truncate text-cw-text">«{queued.text}»</p>
      </div>
      {queued.onSendNow && <CwButton size="xs" variant="secondary" onClick={queued.onSendNow}>Enviar ahora</CwButton>}
      <CwButton size="xs" variant="ghost" onClick={queued.onCancel} aria-label="Editar mensaje en espera"><X aria-hidden="true" />Editar</CwButton>
    </div>}
    <form onSubmit={event => { event.preventDefault(); if (canSend) onSubmit(); }}
      className={cn(
        'group/composer rounded-[22px] border border-cw-border-strong bg-cw-elevated shadow-[var(--cw-shadow)] transition-[box-shadow,border-color]',
        'focus-within:border-cw-border-strong focus-within:shadow-[0_0_0_4px_var(--cw-accent-soft),var(--cw-shadow)]',
      )}>
      <label htmlFor={id} className="sr-only">{size === 'large' ? 'Describe tu trabajo' : 'Escribe tu mensaje'}</label>
      <textarea
        ref={textarea}
        id={id}
        value={value}
        maxLength={20000}
        rows={size === 'large' ? 3 : 1}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (canSend) onSubmit();
          }
        }}
        placeholder={placeholder}
        disabled={sending}
        className={cn(
          'block w-full resize-none border-0 bg-transparent px-4 text-cw-text shadow-none outline-none placeholder:text-cw-faint focus:outline-none focus:ring-0 disabled:opacity-60',
          size === 'large' ? 'min-h-[92px] pt-4 text-[16px] leading-6' : 'min-h-[52px] pt-[15px] text-[15.5px] leading-6',
        )}
      />
      {attachments && <div className="px-3 pb-1">{attachments}</div>}
      <div className="flex items-center gap-1 px-2 pb-2 pt-1">
        {onToggleFiles && <CwButton size="icon-sm" variant="ghost" onClick={onToggleFiles} aria-expanded={filesOpen}
          aria-label={filesOpen ? 'Ocultar archivos' : 'Adjuntar archivos'} title="Adjuntar archivos" disabled={sending}>
          <Paperclip aria-hidden="true" />
        </CwButton>}
        {canAutonomous && <ExecutionMode id={`${id}-mode`} value={mode} onChange={onModeChange} disabled={sending} />}
        <div className="ml-auto flex items-center gap-2">
          {showStop
            ? <button type="button" onClick={() => onStop?.()} disabled={stopping} aria-label="Detener trabajo" title="Detener"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-cw-text text-cw-bg transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] disabled:opacity-40">
              {stopping ? <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />}
            </button>
            : <button type="submit" disabled={!canSend} aria-label={submitLabel} title={submitLabel}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-cw-accent text-cw-on-accent shadow-[var(--cw-shadow-sm)] transition-[background-color,opacity] hover:bg-cw-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-35">
              {sending ? <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden="true" />}
            </button>}
        </div>
      </div>
    </form>
    {footnote && <div className="mt-2 px-1 text-center text-[11.5px] text-cw-faint">{footnote}</div>}
  </div>;
});
