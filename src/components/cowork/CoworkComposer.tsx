'use client';

import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ArrowUp, Bookmark, CalendarClock, LoaderCircle, Mic, Paperclip, Square, X } from 'lucide-react';
import { coworkPastedImages } from '@/lib/cowork/attachments';
import type { CoworkExecutionMode } from '@/lib/cowork/execution-policy';
import {
  coworkComposerToken, coworkInsertMention, coworkMentionName, coworkTemplateBlank, coworkTemplates, type CoworkComposerToken, type CoworkMention,
} from '@/lib/cowork/mentions';
import { coworkSavedTemplates, type CoworkSavedPrompt } from '@/lib/cowork/saved-prompts';
import { cn } from '@/lib/utils';
import { COWORK_AUTONOMOUS_NOTE, ExecutionMode } from './ExecutionMode';
import { ComposerShortcutList, type ComposerShortcutItems, type CoworkContactOption } from './ComposerShortcuts';
import { AnimatePresence, CwCollapse } from './motion';
import { CwButton } from './ui';
import { useDictation } from './useDictation';

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
  /** Files are attached: the message can go without text. */
  hasAttachments?: boolean;
  /** A file is uploading: sending waits so the message names it. */
  attaching?: boolean;
  /** Files dropped anywhere on the box. */
  onDropFiles?: ((files: FileList | File[]) => void) | null;
  queued?: { text: string; note: string; onCancel: () => void; onSendNow?: (() => void) | null; sendNowLabel?: string } | null;
  footnote?: ReactNode;
  size?: 'large' | 'regular';
  /** «@» lists these saved contacts (V6); the picked one is reported so the message can carry its ID. */
  searchContacts?: ((query: string) => Promise<CoworkContactOption[]>) | null;
  onMention?: ((mention: CoworkMention) => void) | null;
  /** «/» at the start lists the home's templates (V6), after the saved requests (COW-06). */
  templates?: boolean;
  savedPrompts?: CoworkSavedPrompt[];
  /** «Pedidos guardados» (COW-06): offered once there is a request to keep, or there are saved ones to manage. */
  onSavePrompt?: (() => void) | null;
  /** «Programar este pedido» (scheduled tasks): offered once there is a request to repeat, only where the account has the tasks. */
  onSchedule?: (() => void) | null;
};

/** How long typing waits before asking for contacts, so each letter is not a request. */
const SEARCH_WAIT_MS = 150;

/** Persistent composer: Enter sends, Shift+Enter adds a line, grows with the text. */
export const CoworkComposer = forwardRef<CoworkComposerHandle, Props>(function CoworkComposer({
  id, value, onChange, onSubmit, placeholder, ready, sending, submitLabel, onStop, stopping = false,
  canAutonomous = false, mode, onModeChange, onToggleFiles, filesOpen = false, attachments, hasAttachments = false, attaching = false, onDropFiles,
  queued, footnote, size = 'regular', searchContacts = null, onMention = null, templates = false, savedPrompts = [], onSavePrompt = null, onSchedule = null,
}, ref) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [dragging, setDragging] = useState(false);
  // Dictation writes into the box (COW-13); sending or typing over it ends it, keeping what the box already says.
  const dictation = useDictation(onChange);
  const cancelDictation = dictation.cancel;
  useEffect(() => { if (sending) cancelDictation(); }, [sending, cancelDictation]);
  const submit = () => { cancelDictation(); onSubmit(); };
  const dictationNote = dictation.state === 'listening' ? 'Escuchando… Pulsa el micrófono para terminar.'
    : dictation.state === 'stopping' ? 'Terminando el dictado…' : dictation.problem || '';
  useImperativeHandle(ref, () => ({ focus: () => textarea.current?.focus() }), []);
  const listId = `${useId()}-shortcuts`;
  // The shortcut being typed («@mar», «/mej»), the active option, and the contacts found for it.
  const [token, setToken] = useState<CoworkComposerToken | null>(null);
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<{ query: string; items: CoworkContactOption[]; loading: boolean; failed: boolean }>({ query: '', items: [], loading: false, failed: false });
  // Escape closes the list for the shortcut it was on; typing a new one opens it again.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const selectAfter = useRef<{ start: number; end: number } | null>(null);
  const shortcut = token && dismissed !== token.start && ((token.kind === 'mention' && searchContacts) || (token.kind === 'template' && templates)) ? token : null;
  const list: ComposerShortcutItems | null = !shortcut ? null : shortcut.kind === 'template'
    ? { kind: 'template', items: [...coworkSavedTemplates(savedPrompts, shortcut.query), ...coworkTemplates(shortcut.query)] }
    : { kind: 'mention', items: found.query === shortcut.query ? found.items : [], loading: found.query !== shortcut.query || found.loading, failed: found.failed };
  const count = list?.items.length ?? 0;

  const readToken = () => {
    const node = textarea.current;
    if (!node || node.selectionStart !== node.selectionEnd) { setToken(null); return; }
    const next = coworkComposerToken(node.value, node.selectionStart);
    setToken(current => current?.kind === next?.kind && current?.start === next?.start && current?.query === next?.query ? current : next);
  };
  useEffect(() => { setActive(0); }, [shortcut?.kind, shortcut?.query]);
  useEffect(() => { if (token?.start !== dismissed) setDismissed(null); }, [token?.start, dismissed]);
  // Contacts for «@…», asked a moment after the last letter; an older answer never replaces a newer one.
  const mentionQuery = shortcut?.kind === 'mention' ? shortcut.query : null;
  useEffect(() => {
    if (mentionQuery === null || !searchContacts) return;
    let current = true;
    const timer = setTimeout(() => {
      setFound(state => ({ ...state, loading: true, failed: false }));
      searchContacts(mentionQuery).then(
        items => { if (current) setFound({ query: mentionQuery, items, loading: false, failed: false }); },
        () => { if (current) setFound({ query: mentionQuery, items: [], loading: false, failed: true }); },
      );
    }, SEARCH_WAIT_MS);
    return () => { current = false; clearTimeout(timer); };
  }, [mentionQuery, searchContacts]);
  // After a pick the text changes from above: the caret (or a template's [blank]) is placed once it renders.
  useLayoutEffect(() => {
    const node = textarea.current;
    const range = selectAfter.current;
    if (!node || !range) return;
    selectAfter.current = null;
    node.focus();
    node.setSelectionRange(range.start, range.end);
  }, [value]);

  const pick = (index: number) => {
    if (!list || !shortcut) return;
    if (list.kind === 'template') {
      const starter = list.items[index];
      if (!starter) return;
      selectAfter.current = coworkTemplateBlank(starter.prompt) ?? { start: starter.prompt.length, end: starter.prompt.length };
      onChange(starter.prompt);
    } else {
      const contact = list.items[index];
      if (!contact) return;
      const next = coworkInsertMention(value, shortcut, contact.name);
      selectAfter.current = { start: next.caret, end: next.caret };
      onMention?.({ id: contact.id, name: coworkMentionName(contact.name) });
      onChange(next.text);
    }
    setToken(null);
  };

  useEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = 'auto';
    const max = size === 'large' ? 280 : 240;
    node.style.height = `${Math.min(node.scrollHeight, max)}px`;
    node.style.overflowY = node.scrollHeight > max ? 'auto' : 'hidden';
  }, [value, size]);

  const canSend = ready && !sending && !attaching && (Boolean(value.trim()) || hasAttachments);
  const showStop = Boolean(onStop) && !sending;
  const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files');

  return <div className="relative w-full">
    {/* The message waiting for the current step opens its space above the box and closes it when it leaves. */}
    <CwCollapse show={Boolean(queued)}>
      {queued && <div className="pb-2">
        <div className="flex items-start gap-2 rounded-xl border border-cw-border bg-cw-panel px-3 py-2 text-[13px]">
          <LoaderCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cw-muted motion-safe:animate-spin" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-cw-muted">{queued.note}</p>
            <p className="truncate text-cw-text">«{queued.text}»</p>
          </div>
          {queued.onSendNow && <CwButton size="xs" variant="secondary" onClick={queued.onSendNow}>{queued.sendNowLabel || 'Reemplazar propuesta'}</CwButton>}
          <CwButton size="xs" variant="ghost" onClick={queued.onCancel} aria-label="Editar mensaje en espera"><X aria-hidden="true" />Editar</CwButton>
        </div>
      </div>}
    </CwCollapse>
    <AnimatePresence>
      {list && <ComposerShortcutList key={list.kind} id={listId} list={list} active={Math.min(active, Math.max(0, count - 1))} onPick={pick} onHover={setActive} />}
    </AnimatePresence>
    <form onSubmit={event => { event.preventDefault(); if (canSend) submit(); }}
      onDragOver={onDropFiles ? event => { if (!carriesFiles(event)) return; event.preventDefault(); setDragging(true); } : undefined}
      onDragLeave={onDropFiles ? event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); } : undefined}
      onDrop={onDropFiles ? event => { if (!carriesFiles(event)) return; event.preventDefault(); setDragging(false); onDropFiles(event.dataTransfer.files); } : undefined}
      className={cn(
        'group/composer rounded-[22px] border border-cw-border-strong bg-cw-elevated shadow-[var(--cw-shadow)] transition-[box-shadow,border-color]',
        'focus-within:border-cw-border-strong focus-within:shadow-[0_0_0_4px_var(--cw-accent-soft),var(--cw-shadow)]',
        dragging && 'border-cw-accent shadow-[0_0_0_4px_var(--cw-accent-soft),var(--cw-shadow)]',
      )}>
      <label htmlFor={id} className="sr-only">Escribe tu mensaje</label>
      <textarea
        ref={textarea}
        id={id}
        value={value}
        maxLength={20000}
        rows={size === 'large' ? 3 : 1}
        onChange={event => {
          if (dictation.state !== 'idle') cancelDictation();
          if (dictation.problem) dictation.clearProblem();
          onChange(event.target.value);
          requestAnimationFrame(readToken);
        }}
        onSelect={readToken}
        onBlur={() => setToken(null)}
        // A screenshot pasted into the box is attached like a dropped file (COW-11); pasted text stays text.
        onPaste={onDropFiles ? event => {
          const images = coworkPastedImages(event.clipboardData, new Date());
          if (!images.length) return;
          event.preventDefault();
          onDropFiles(images);
        } : undefined}
        aria-autocomplete={searchContacts || templates ? 'list' : undefined}
        aria-controls={list && count ? listId : undefined}
        aria-activedescendant={list && count ? `${listId}-${Math.min(active, count - 1)}` : undefined}
        onKeyDown={event => {
          if (list && !event.nativeEvent.isComposing) {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(shortcut?.start ?? null); return; }
            if (count && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault();
              setActive(current => (current + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
              return;
            }
            if (count && (event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) { event.preventDefault(); pick(Math.min(active, count - 1)); return; }
          }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (canSend) submit();
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
      {dictation.supported && <p role="status" className={cn('px-4 text-[12.5px] leading-5 text-cw-muted', dictationNote ? 'pb-1' : 'sr-only')}>{dictationNote}</p>}
      {list && <span className="sr-only" role="status">{count ? `${count} ${list.kind === 'mention' ? (count === 1 ? 'contacto' : 'contactos') : (count === 1 ? 'plantilla' : 'plantillas')}. Usa las flechas para elegir.` : ''}</span>}
      <div className="flex items-center gap-1 px-2 pb-2 pt-1">
        {onToggleFiles && <CwButton size="icon-sm" variant="ghost" onClick={onToggleFiles} aria-expanded={filesOpen}
          aria-label={filesOpen ? 'Ocultar archivos' : 'Adjuntar archivos'} title="Adjuntar archivos" disabled={sending}>
          <Paperclip aria-hidden="true" />
        </CwButton>}
        {dictation.supported && <CwButton size="icon-sm" variant="ghost" disabled={sending || dictation.state === 'stopping'}
          onClick={() => { if (dictation.state === 'listening') dictation.stop(); else dictation.start(value); }}
          aria-pressed={dictation.state === 'listening'} aria-label={dictation.state === 'listening' ? 'Terminar dictado' : 'Dictar'}
          title={dictation.state === 'listening' ? 'Terminar dictado' : 'Dictar: tu navegador escribe lo que dices'}
          className={cn(dictation.state === 'listening' && 'bg-cw-accent-soft text-cw-accent hover:bg-cw-accent-soft hover:text-cw-accent')}>
          <Mic aria-hidden="true" />
        </CwButton>}
        {onSavePrompt && (value.trim().length >= 10 || savedPrompts.length > 0) && <CwButton size="icon-sm" variant="ghost" onClick={onSavePrompt} disabled={sending}
          aria-label={value.trim().length >= 10 ? 'Guardar este pedido' : 'Pedidos guardados'}
          title={value.trim().length >= 10 ? 'Guardar este pedido: luego lo usas escribiendo «/»' : 'Pedidos guardados'}>
          <Bookmark aria-hidden="true" />
        </CwButton>}
        {onSchedule && value.trim().length >= 10 && <CwButton size="icon-sm" variant="ghost" onClick={onSchedule} disabled={sending}
          aria-label="Programar este pedido" title="Programar este pedido: Cowork lo hará solo, cuando tú elijas">
          <CalendarClock aria-hidden="true" />
        </CwButton>}
        {canAutonomous && <ExecutionMode id={`${id}-mode`} value={mode} onChange={onModeChange} disabled={sending} />}
        <div className="ml-auto flex items-center gap-2">
          {showStop
            ? <button type="button" onClick={() => onStop?.()} disabled={stopping} aria-label="Detener" title="Detener"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-cw-text text-cw-bg transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] disabled:opacity-40">
              {stopping ? <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />}
            </button> : null}
          {(!showStop || value.trim() || hasAttachments) && <button type="submit" disabled={!canSend} aria-label={submitLabel} title={submitLabel}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-cw-accent-fill text-cw-on-accent shadow-[var(--cw-shadow-sm)] transition-[background-color,color,opacity] hover:bg-cw-accent-fill-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-cw-hover disabled:text-cw-muted disabled:shadow-none">
              {sending ? <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden="true" />}
            </button>}
        </div>
      </div>
    </form>
    {canAutonomous && mode === 'autonomous' && <p className="mt-2 px-1 text-center text-[11.5px] text-cw-muted">{COWORK_AUTONOMOUS_NOTE}</p>}
    {footnote && <div className="mt-2 px-1 text-center text-[11.5px] text-foreground/70">{footnote}</div>}
  </div>;
});
