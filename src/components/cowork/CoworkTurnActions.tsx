'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, PencilLine, RefreshCw, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { COWORK_FEEDBACK_REASONS, type CoworkFeedback, type CoworkFeedbackReason, type CoworkTurnVersions } from '@/lib/cowork/turn-actions';
import { cn } from '@/lib/utils';
import { CwButton } from './ui';

/**
 * The gestures of any AI chat on a finished turn (Plan 13): edit your last message, another version of the answer, the
 * versions side by side and 👍 / 👎. They sit where the eye already is: under your message and under the answer.
 */

/** Your last message, editable in place: «Enviar» asks again with the new words, «Cancelar» (or Esc) leaves it as it was. */
export function CoworkEditMessage({ initial, onSend, onCancel }: { initial: string; onSend: (text: string) => Promise<boolean>; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const hint = useId();
  useEffect(() => {
    const node = field.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, []);
  useEffect(() => {
    const node = field.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 320)}px`;
  }, [text]);
  const changed = text.trim() && text.trim() !== initial.trim();
  const send = async () => {
    if (!changed || sending) return;
    setSending(true);
    if (!await onSend(text)) setSending(false);
  };
  return <div className="w-full max-w-[85%] rounded-[18px] border border-cw-border-strong bg-cw-elevated p-2 shadow-[var(--cw-shadow-sm)] focus-within:border-cw-accent focus-within:ring-2 focus-within:ring-[color:var(--cw-accent-ring)]">
    <label className="sr-only" htmlFor={`${hint}-field`}>Edita tu mensaje</label>
    <textarea id={`${hint}-field`} ref={field} value={text} rows={2} maxLength={20000} aria-describedby={hint} disabled={sending}
      onChange={event => setText(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); }
      }}
      className="block w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-[1.55] text-cw-text outline-none placeholder:text-cw-faint focus-visible:outline-none" />
    <div className="flex flex-wrap items-center justify-end gap-2 px-1 pt-1">
      <p id={hint} className="mr-auto text-[12px] text-cw-muted">Cowork responde de nuevo a tu mensaje editado.</p>
      <CwButton size="sm" variant="ghost" onClick={onCancel} disabled={sending}>Cancelar</CwButton>
      <CwButton size="sm" variant="primary" onClick={() => void send()} disabled={!changed || sending}>{sending ? 'Enviando…' : 'Enviar'}</CwButton>
    </div>
  </div>;
}

/** ‹ 2 / 3 › under a message with more than one version: each opens where its conversation went on. */
export function CoworkVersionSwitcher({ versions, onSelect, disabled = false }: { versions: CoworkTurnVersions; onSelect: (id: string) => void; disabled?: boolean }) {
  const { index, total, ids } = versions;
  return <div role="group" aria-label="Versiones de este mensaje" className="flex items-center gap-0.5 text-[12.5px] text-cw-muted">
    <CwButton size="icon-sm" variant="ghost" className="h-7 w-7" aria-label="Versión anterior" disabled={disabled || index <= 0}
      onClick={() => onSelect(ids[index - 1])}><ChevronLeft aria-hidden="true" /></CwButton>
    <span className="min-w-[2.75rem] text-center tabular-nums" aria-live="polite">{index + 1} / {total}</span>
    <CwButton size="icon-sm" variant="ghost" className="h-7 w-7" aria-label="Versión siguiente" disabled={disabled || index >= total - 1}
      onClick={() => onSelect(ids[index + 1])}><ChevronRight aria-hidden="true" /></CwButton>
  </div>;
}

/** The pencil beside your last message. */
export function CoworkEditButton({ onClick }: { onClick: () => void }) {
  return <CwButton size="icon-sm" variant="ghost" className="h-8 w-8" aria-label="Editar mensaje" title="Editar" onClick={onClick}>
    <PencilLine aria-hidden="true" />
  </CwButton>;
}

function IconAction({ label, pressed, onClick, children, disabled = false }: { label: string; pressed?: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return <CwButton size="icon-sm" variant="ghost" className={cn('h-8 w-8', pressed && 'bg-cw-accent-soft text-cw-accent hover:bg-cw-accent-soft hover:text-cw-accent')}
    aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>{children}</CwButton>;
}

/**
 * Under a finished answer: copy, 👍 / 👎 (👎 asks, in one click, what was missing) and «Otra versión» on the latest one.
 * Always in view under the latest answer, on hover under the older ones; on touch screens always.
 */
export function CoworkAnswerActions({ text, latest, rating, onFeedback, onRegenerate }: {
  text: string;
  latest: boolean;
  /** What you already said about this answer. */
  rating: 'up' | 'down' | null;
  onFeedback: ((feedback: CoworkFeedback) => Promise<boolean>) | null;
  onRegenerate: (() => void) | null;
}) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState<'up' | 'down' | null>(rating);
  const [asking, setAsking] = useState(false);
  const [thanks, setThanks] = useState(false);
  useEffect(() => { setShown(rating); }, [rating]);
  useEffect(() => {
    if (!thanks) return;
    const timer = setTimeout(() => setThanks(false), 4000);
    return () => clearTimeout(timer);
  }, [thanks]);
  const rate = async (next: 'up' | 'down') => {
    if (!onFeedback) return;
    const value = shown === next ? null : next;
    const before = shown;
    setShown(value);
    setAsking(value === 'down');
    if (!await onFeedback({ rating: value, reason: null, comment: null })) { setShown(before); setAsking(false); return; }
    if (value === 'up') setThanks(true);
  };
  return <div className="space-y-2">
    <div className={cn('-ml-1.5 flex flex-wrap items-center gap-0.5 transition-opacity',
      !latest && !asking && 'opacity-100 sm:opacity-0 sm:group-hover/reply:opacity-100 sm:focus-within:opacity-100')}>
      <IconAction label={copied ? 'Respuesta copiada' : 'Copiar respuesta'} onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
      }}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</IconAction>
      {onFeedback && <>
        <IconAction label="Buena respuesta" pressed={shown === 'up'} onClick={() => void rate('up')}><ThumbsUp aria-hidden="true" /></IconAction>
        <IconAction label="Mala respuesta" pressed={shown === 'down'} onClick={() => void rate('down')}><ThumbsDown aria-hidden="true" /></IconAction>
      </>}
      {onRegenerate && <CwButton size="xs" variant="ghost" className="ml-1 h-8 px-2 text-[13px]" onClick={onRegenerate} title="Pedir otra versión de esta respuesta">
        <RefreshCw aria-hidden="true" />Otra versión
      </CwButton>}
      <span role="status" className="ml-2 text-[12.5px] text-cw-muted">{thanks ? 'Gracias, nos ayuda a mejorar Cowork.' : ''}</span>
    </div>
    {asking && onFeedback && <FeedbackReasons onClose={() => setAsking(false)}
      onSend={async (reason, comment) => {
        if (!await onFeedback({ rating: 'down', reason, comment })) return false;
        setAsking(false); setThanks(true);
        return true;
      }} />}
  </div>;
}

/** After 👎: what was missing, in one click, and anything else in your words. */
function FeedbackReasons({ onSend, onClose }: { onSend: (reason: CoworkFeedbackReason | null, comment: string | null) => Promise<boolean>; onClose: () => void }) {
  const [reason, setReason] = useState<CoworkFeedbackReason | null>(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const heading = useId();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  return <div role="group" aria-labelledby={heading} className="max-w-xl rounded-2xl border border-cw-border bg-cw-elevated p-3 shadow-[var(--cw-shadow-sm)]"
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
    <div className="flex items-start gap-2">
      <p id={heading} className="flex-1 text-[13.5px] font-medium text-cw-text">¿Qué faltó? Nos ayuda a mejorar.</p>
      <CwButton size="icon-sm" variant="ghost" className="-mr-1 -mt-1 h-7 w-7" aria-label="Cerrar" onClick={onClose}><X aria-hidden="true" /></CwButton>
    </div>
    <div className="mt-2 flex flex-wrap gap-1.5">
      {COWORK_FEEDBACK_REASONS.map((option, index) => <button key={option.id} ref={index === 0 ? first : undefined} type="button" aria-pressed={reason === option.id}
        onClick={() => setReason(current => current === option.id ? null : option.id)}
        className={cn('rounded-full border px-3 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]',
          reason === option.id ? 'border-cw-accent bg-cw-accent-soft font-medium text-cw-accent' : 'border-cw-border text-cw-text hover:border-cw-border-strong hover:bg-cw-panel')}>
        {option.label}
      </button>)}
    </div>
    <label className="sr-only" htmlFor={`${heading}-comment`}>Comentario (opcional)</label>
    <textarea id={`${heading}-comment`} value={comment} onChange={event => setComment(event.target.value)} rows={2} maxLength={500}
      placeholder="Cuéntanos qué esperabas (opcional)"
      className="mt-2 block w-full resize-none rounded-xl border border-cw-border bg-cw-panel px-3 py-2 text-[13.5px] text-cw-text outline-none placeholder:text-cw-faint focus-visible:border-cw-accent focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]" />
    <div className="mt-2 flex justify-end">
      <CwButton size="sm" variant="primary" disabled={sending || (!reason && !comment.trim())}
        onClick={async () => { setSending(true); if (!await onSend(reason, comment.trim() || null)) setSending(false); }}>
        {sending ? 'Enviando…' : 'Enviar'}
      </CwButton>
    </div>
  </div>;
}
