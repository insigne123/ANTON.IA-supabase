'use client';
import { useId, useRef, useState, type ComponentProps } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { InitialsAvatar } from '@/components/initials-avatar';
import { insertMention, mentionAt, mentionMatches, type MentionPerson } from '@/lib/commercial-opportunities/activity-notes';
import { cn } from '@/lib/utils';

type Props = Omit<ComponentProps<'textarea'>, 'value' | 'onChange'> & { value: string; onValueChange: (value: string) => void; people: MentionPerson[] };

/**
 * A note box where «@» suggests the people who can read the opportunity (OPP-28): typing narrows the list, the arrows move in it, Enter or
 * Tab picks one and Escape closes it. The name goes in whole («@Diego Fuentes »), which is how the note names them.
 */
export function MentionTextarea({ value, onValueChange, people, className, onKeyDown, ...props }: Props) {
  const box = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  // Escape closes the list for that «@» only: the next one opens it again.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const at = mentionAt(value, caret);
  const matches = at && at.start !== dismissed ? mentionMatches(people, at.query) : [];
  const open = matches.length > 0;
  const shown = Math.min(active, Math.max(0, matches.length - 1));
  const follow = (element: HTMLTextAreaElement) => { setCaret(element.selectionStart ?? element.value.length); };
  const pick = (person: MentionPerson) => {
    if (!at) return;
    const next = insertMention(value, at, person.name);
    onValueChange(next.text); setCaret(next.caret); setActive(0);
    requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(next.caret, next.caret); });
  };
  return <div className="relative">
    <Textarea ref={box} value={value} className={className} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open ? `${listId}-${shown}` : undefined}
      onChange={event => { onValueChange(event.target.value); follow(event.target); setActive(0); }}
      onSelect={event => follow(event.currentTarget)} onClick={event => follow(event.currentTarget)}
      onKeyDown={event => {
        if (open) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive((shown + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length); return; }
          if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); pick(matches[shown]); return; }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(at!.start); return; }
        }
        onKeyDown?.(event);
      }} {...props} />
    {open ? <ul id={listId} role="listbox" aria-label="Personas para mencionar"
      className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in-0">
      {matches.map((person, index) => <li key={person.user_id} id={`${listId}-${index}`} role="option" aria-selected={index === shown}
        // The textarea keeps the focus: a press picks without blurring it.
        onMouseDown={event => { event.preventDefault(); pick(person); }} onMouseEnter={() => setActive(index)}
        className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm', index === shown && 'bg-accent text-accent-foreground')}>
        <InitialsAvatar name={person.name} size="sm" /><span className="truncate">{person.name}</span></li>)}
    </ul> : null}
  </div>;
}
