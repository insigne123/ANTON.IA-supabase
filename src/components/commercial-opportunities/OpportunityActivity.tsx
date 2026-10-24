'use client';
import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { InitialsAvatar } from '@/components/initials-avatar';
import { isEditableNote, mentionParts, type MentionPerson } from '@/lib/commercial-opportunities/activity-notes';
import { MentionTextarea } from './MentionTextarea';

export type ActivityRow = { id: string; actor_id: string | null; kind: string; body: string; created_at: string; data?: Record<string, unknown> | null };
type Props = {
  activity: ActivityRow[];
  /** Everyone in the workspace, for the names of who did what. */
  members: MentionPerson[];
  /** Who a note can name: the team of the opportunity and the administrators. */
  mentionable: MentionPerson[];
  userId: string | null; busy: boolean; when: (at: string) => string;
  /** The note being written: kept by the page, so it survives a look at another part of the opportunity. */
  note: string; onNote: (text: string) => void;
  onAdd: (text: string) => Promise<boolean>;
  onEdit: (id: string, text: string) => Promise<boolean>;
  onDelete: (row: ActivityRow) => void;
};

/** The note with the people it names apart, as the team reads them. */
function NoteText({ text, people }: { text: string; people: MentionPerson[] }) {
  return <>{mentionParts(text, people).map((part, index) => part.userId ? <span key={index} className="font-medium text-primary">{part.text}</span> : <span key={index}>{part.text}</span>)}</>;
}

/**
 * «Actividad» (OPP-28): what the team wrote and what happened, the latest first. A note can name people with «@», who hear about it; whoever
 * wrote a note can correct it («editada») or delete it. Decisions, blocks and what the app writes stay as they are.
 */
export function OpportunityActivity({ activity, members, mentionable, userId, busy, when, note, onNote, onAdd, onEdit, onDelete }: Props) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const nameOf = (id: string | null) => members.find(member => member.user_id === id)?.name || 'El sistema';
  return <section aria-labelledby="op-activity" className="space-y-4">
    <h2 id="op-activity" className="font-semibold">Actividad del equipo</h2>
    <form onSubmit={event => { event.preventDefault(); if (!note.trim()) return; void onAdd(note.trim()).then(saved => { if (saved) onNote(''); }); }} className="space-y-2">
      <Label htmlFor="op-note">Registrar avance o nota</Label>
      <MentionTextarea id="op-note" value={note} onValueChange={onNote} people={mentionable} maxLength={4000} aria-describedby="op-note-hint"
        placeholder="Ej.: enviamos las consultas al comprador; @Diego Fuentes, ¿puedes revisar la respuesta?" />
      <p id="op-note-hint" className="text-xs text-muted-foreground">Escribe @ y el nombre para avisarle a alguien del equipo.</p>
      <Button disabled={busy || !note.trim()}>Guardar avance</Button>
    </form>
    <ol aria-label="Actividad" className="ml-3.5 space-y-5 border-l border-border/70 pl-6">
      {activity.map(row => {
        const who = nameOf(row.actor_id);
        const own = isEditableNote(row, userId);
        const edited = typeof row.data?.editedAt === 'string';
        return <li key={row.id} className="relative">
          <InitialsAvatar name={who} size="sm" className="absolute -left-[38px] top-0 ring-4 ring-background" />
          {editing?.id === row.id ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (!editing.text.trim()) return;
            void onEdit(row.id, editing.text.trim()).then(saved => { if (saved) setEditing(null); }); }}>
            <MentionTextarea aria-label="Editar la nota" value={editing.text} onValueChange={text => setEditing({ id: row.id, text })} people={mentionable} maxLength={4000} autoFocus
              onKeyDown={event => { if (event.key === 'Escape') setEditing(null); }} />
            <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy || !editing.text.trim()}>Guardar</Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>Cancelar</Button></div>
          </form> : <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="whitespace-pre-line break-words text-sm leading-6"><NoteText text={row.body} people={members} /></p>
              <p className="text-xs text-muted-foreground">{who} · {when(row.created_at)}{edited ? ' · editada' : ''}</p>
            </div>
            {own ? <DropdownMenu><DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" disabled={busy} aria-label="Opciones de tu nota"><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></Button>
            </DropdownMenuTrigger><DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing({ id: row.id, text: row.body })}>Editar</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDelete(row)}>Eliminar</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu> : null}
          </div>}
        </li>;
      })}
    </ol>
  </section>;
}
