'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Brain, LoaderCircle, Pencil, RotateCcw, Trash2, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { CwButton } from './ui';

type Memory = { id: string; text: string; scope: 'personal' | 'organization'; mine: boolean; canForget: boolean; canEdit?: boolean; updatedAt: string | null };

const field = 'w-full rounded-lg border border-cw-border-strong bg-cw-elevated px-2.5 text-[13.5px] text-cw-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] disabled:opacity-60';

/**
 * «Lo que Cowork recuerda» (Plan 13): what its turns read about you and your organization, and «Olvidar» for each, as in Claude
 * or ChatGPT. Something new is remembered from the chat («recuerda que…»), with a card to approve, or written here (COW-05):
 * «Recordar» adds a sentence for you or for the team, and «Corregir» changes the words of one you may forget.
 */
export function CoworkMemories({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const ids = useId();
  const [draft, setDraft] = useState('');
  const [shareWithTeam, setShareWithTeam] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    setError(''); setMemories(null);
    try {
      const response = await fetch('/api/cowork/memories', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No pudimos leer lo que Cowork recuerda.');
      setMemories(Array.isArray(data.memories) ? data.memories : []);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'No pudimos leer lo que Cowork recuerda.');
    }
  }, []);
  useEffect(() => { if (open) { setNotice(''); setConfirming(null); void load(); } }, [open, load]);

  const forget = async (memory: Memory) => {
    setForgetting(memory.id); setNotice('');
    try {
      const response = await fetch(`/api/cowork/memories/${memory.id}`, { method: 'DELETE', cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No pudimos olvidar ese recuerdo.');
      setMemories(current => (current || []).filter(item => item.id !== memory.id));
      setNotice('Listo, Cowork ya no lo usará.');
    } catch (problem) {
      setNotice(problem instanceof Error ? problem.message : 'No pudimos olvidar ese recuerdo.');
    } finally {
      setForgetting(null); setConfirming(null);
    }
  };

  const add = async () => {
    const text = draft.trim();
    if (text.length < 3 || adding) return;
    setAdding(true); setNotice('');
    try {
      const response = await fetch('/api/cowork/memories', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, scope: shareWithTeam ? 'organization' : 'personal' }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.memory) throw new Error(data.error || 'No pudimos guardar el recuerdo.');
      setMemories(current => [data.memory as Memory, ...(current || []).filter(item => item.id !== data.memory.id)]);
      setDraft('');
      setNotice(data.created === false ? 'Cowork ya recordaba eso.' : 'Listo, Cowork lo usará desde la próxima respuesta.');
    } catch (problem) {
      setNotice(problem instanceof Error ? problem.message : 'No pudimos guardar el recuerdo.');
    } finally {
      setAdding(false);
    }
  };

  const saveEdit = async () => {
    if (!editing || editing.text.trim().length < 3 || savingEdit) return;
    setSavingEdit(true); setNotice('');
    try {
      const response = await fetch(`/api/cowork/memories/${editing.id}`, { method: 'PATCH', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editing.text.trim() }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.memory) throw new Error(data.error || 'No pudimos corregir ese recuerdo.');
      setMemories(current => (current || []).map(item => item.id === data.memory.id ? data.memory as Memory : item));
      setEditing(null);
      setNotice('Listo, Cowork usará la versión corregida.');
    } catch (problem) {
      setNotice(problem instanceof Error ? problem.message : 'No pudimos corregir ese recuerdo.');
    } finally {
      setSavingEdit(false);
    }
  };

  const personal = (memories || []).filter(memory => memory.scope === 'personal');
  const shared = (memories || []).filter(memory => memory.scope === 'organization');

  const list = (title: string, items: Memory[], icon: 'personal' | 'organization') => items.length > 0 && <section>
    <h3 className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-cw-text">
      {icon === 'organization' ? <Users className="h-3.5 w-3.5 text-cw-muted" aria-hidden="true" /> : <Brain className="h-3.5 w-3.5 text-cw-muted" aria-hidden="true" />}
      {title}
    </h3>
    <ul className="divide-y divide-cw-border rounded-xl border border-cw-border bg-cw-elevated">
      {items.map(memory => editing?.id === memory.id ? <li key={memory.id} className="space-y-2 px-3.5 py-2.5">
        <label htmlFor={`${ids}-edit`} className="sr-only">Corregir: {memory.text}</label>
        <input id={`${ids}-edit`} className={cn(field, 'h-9')} value={editing.text} maxLength={240} autoFocus disabled={savingEdit}
          onChange={event => setEditing({ id: memory.id, text: event.target.value })}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void saveEdit(); } if (event.key === 'Escape') { event.stopPropagation(); setEditing(null); } }} />
        <div className="flex justify-end gap-1">
          <CwButton size="xs" variant="ghost" disabled={savingEdit} onClick={() => setEditing(null)}>Cancelar</CwButton>
          <CwButton size="xs" variant="primary" disabled={savingEdit || editing.text.trim().length < 3} onClick={() => void saveEdit()}>{savingEdit ? 'Guardando…' : 'Guardar'}</CwButton>
        </div>
      </li> : <li key={memory.id} className="flex items-center gap-3 px-3.5 py-2">
        <p className="min-w-0 flex-1 break-words text-[13.5px] leading-5 text-cw-text">{memory.text}</p>
        {memory.canEdit && confirming !== memory.id && <CwButton size="icon-sm" variant="ghost" className="h-7 w-7 shrink-0" aria-label={`Corregir: ${memory.text}`} title="Corregir"
          onClick={() => { setConfirming(null); setEditing({ id: memory.id, text: memory.text }); }}><Pencil aria-hidden="true" /></CwButton>}
        {memory.canForget && (confirming === memory.id
          ? <div className="flex shrink-0 items-center gap-1">
            <CwButton size="xs" variant="danger" disabled={forgetting === memory.id} onClick={() => void forget(memory)}>
              {forgetting === memory.id ? 'Olvidando…' : 'Sí, olvidar'}
            </CwButton>
            <CwButton size="xs" variant="ghost" disabled={forgetting === memory.id} onClick={() => setConfirming(null)}>No</CwButton>
          </div>
          : <CwButton size="icon-sm" variant="ghost" className="-mr-1.5 h-7 w-7 shrink-0" aria-label={`Olvidar: ${memory.text}`} title="Olvidar"
            onClick={() => setConfirming(memory.id)}><Trash2 aria-hidden="true" /></CwButton>)}
      </li>)}
    </ul>
    {icon === 'organization' && items.some(memory => !memory.canForget) && <p className="mt-1.5 text-[12px] text-cw-muted">Los recuerdos de tu equipo los olvida quien los guardó o un administrador.</p>}
  </section>;

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[85vh] max-w-lg gap-0 overflow-hidden border-cw-border bg-cw-bg p-0 text-cw-text sm:rounded-2xl">
      <div className="border-b border-cw-border px-5 pb-3.5 pt-5 pr-12">
        <DialogTitle className="text-[16px] font-semibold text-cw-text">Lo que Cowork recuerda</DialogTitle>
        <DialogDescription className="mt-1 text-[13px] leading-5 text-cw-muted">
          Cowork usa esto en cada conversación. Escribe aquí lo que debe recordar, o díselo en el chat: «recuerda que tuteo a todos».
        </DialogDescription>
      </div>
      <div className="cw-scroll max-h-[60vh] space-y-4 overflow-y-auto px-5 py-4">
        {memories === null && !error && <p role="status" className="flex items-center gap-2 text-[13px] text-cw-muted">
          <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />Cargando…
        </p>}
        {error && <div className="space-y-2">
          <p role="alert" className="text-[13px] text-cw-danger">{error}</p>
          <CwButton size="xs" variant="secondary" onClick={() => void load()}><RotateCcw aria-hidden="true" />Reintentar</CwButton>
        </div>}
        {memories && memories.length === 0 && <div className="rounded-xl border border-dashed border-cw-border px-4 py-5 text-center">
          <p className="text-[13.5px] font-medium text-cw-text">Todavía no recuerda nada</p>
          <p className="mt-1 text-[12.5px] leading-5 text-cw-muted">Cuando le digas cómo prefieres trabajar («firma solo con mi nombre», «no le escribas a Adecco»), te propondrá recordarlo.</p>
        </div>}
        {list('Sobre ti', personal, 'personal')}
        {list('De tu equipo', shared, 'organization')}
      </div>
      {/* Writing it here is the same as approving the card of the chat (COW-05). */}
      {memories !== null && <form className="space-y-2 border-t border-cw-border px-5 py-3.5" onSubmit={event => { event.preventDefault(); void add(); }}>
        <label htmlFor={`${ids}-new`} className="block text-[12.5px] font-medium text-cw-text">Que Cowork recuerde</label>
        <input id={`${ids}-new`} className={cn(field, 'h-9')} value={draft} maxLength={240} disabled={adding}
          placeholder="Firma solo con mi nombre" onChange={event => setDraft(event.target.value)} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-[12.5px] text-cw-muted">
            <input type="checkbox" className="h-3.5 w-3.5 accent-[color:var(--cw-accent)]" checked={shareWithTeam} disabled={adding} onChange={event => setShareWithTeam(event.target.checked)} />
            Para todo mi equipo
          </label>
          <CwButton type="submit" size="xs" variant="primary" disabled={adding || draft.trim().length < 3}>{adding ? 'Guardando…' : 'Recordar'}</CwButton>
        </div>
      </form>}
      <p role="status" className={cn('border-t border-cw-border px-5 py-2.5 text-[12.5px] text-cw-muted', !notice && 'sr-only')}>{notice}</p>
    </DialogContent>
  </Dialog>;
}
