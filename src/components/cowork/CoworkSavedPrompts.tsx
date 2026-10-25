'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Bookmark, Trash2, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { COWORK_PROMPTS_PER_PERSON, coworkPromptTitle, type CoworkSavedPrompt } from '@/lib/cowork/saved-prompts';
import { cn } from '@/lib/utils';
import { CwButton } from './ui';

const field = 'w-full rounded-lg border border-cw-border-strong bg-cw-elevated px-2.5 text-[13.5px] text-cw-text placeholder:text-cw-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] disabled:opacity-60';

/** The saved requests, read once and again after a change; empty and unavailable until the table exists. */
export function useCoworkSavedPrompts(enabled: boolean) {
  const [state, setState] = useState<{ available: boolean; prompts: CoworkSavedPrompt[] }>({ available: false, prompts: [] });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    fetch('/api/cowork/prompts', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (!disposed && data) setState({ available: data.available === true, prompts: Array.isArray(data.prompts) ? data.prompts : [] }); })
      .catch(() => undefined);
    return () => { disposed = true; };
  }, [enabled, version]);
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  return { ...state, refresh };
}

/**
 * «Pedidos guardados» (COW-06): keeps the request in the box to use it again with «/», for oneself or the team, and lists the
 * saved ones to delete them. One primary action: «Guardar pedido» when there is a request; otherwise only the list.
 */
export function CoworkSavedPrompts({ open, onOpenChange, draft, prompts, onChanged }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  /** The request in the box when the dialog opened; empty to only manage the list. */
  draft: string;
  prompts: CoworkSavedPrompt[];
  onChanged: () => void;
}) {
  const ids = useId();
  const request = draft.trim();
  // Once saved, the form gives way to the list with the new one in it.
  const [saved, setSaved] = useState(false);
  const canSave = request.length >= 10 && !saved;
  const [title, setTitle] = useState('');
  const [shared, setShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (open) { setSaved(false); setTitle(''); setShared(false); setNotice(''); setFailed(false); setConfirming(null); } }, [open]);

  const save = async () => {
    setSaving(true); setNotice(''); setFailed(false);
    try {
      const response = await fetch('/api/cowork/prompts', {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: request, title: title.trim() || undefined, shared }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No pudimos guardar el pedido.');
      onChanged();
      setSaved(true);
      setNotice(`Guardaste «${data.prompt?.title || coworkPromptTitle(request, title)}». Escribe «/» para usarlo.`);
    } catch (problem) {
      setFailed(true);
      setNotice(problem instanceof Error ? problem.message : 'No pudimos guardar el pedido.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry: CoworkSavedPrompt) => {
    setDeleting(entry.id); setNotice(''); setFailed(false);
    try {
      const response = await fetch(`/api/cowork/prompts/${entry.id}`, { method: 'DELETE', cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No pudimos borrar el pedido.');
      onChanged();
      setNotice(`Borraste «${entry.title}».`);
    } catch (problem) {
      setFailed(true);
      setNotice(problem instanceof Error ? problem.message : 'No pudimos borrar el pedido.');
    } finally {
      setDeleting(null); setConfirming(null);
    }
  };

  const own = prompts.filter(entry => entry.mine);
  const team = prompts.filter(entry => !entry.mine);
  const list = (heading: string, items: CoworkSavedPrompt[], icon: 'own' | 'team') => items.length > 0 && <section>
    <h3 className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-cw-text">
      {icon === 'team' ? <Users className="h-3.5 w-3.5 text-cw-muted" aria-hidden="true" /> : <Bookmark className="h-3.5 w-3.5 text-cw-muted" aria-hidden="true" />}
      {heading}
    </h3>
    <ul className="divide-y divide-cw-border rounded-xl border border-cw-border bg-cw-elevated">
      {items.map(entry => <li key={entry.id} className="flex items-center gap-3 px-3.5 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-cw-text">{entry.title}</p>
          <p className="line-clamp-2 break-words text-[12.5px] leading-5 text-cw-muted">{entry.prompt}</p>
          {entry.mine && entry.shared && <p className="text-[12px] text-cw-muted">Compartido con tu equipo</p>}
        </div>
        {entry.canDelete && (confirming === entry.id
          ? <div className="flex shrink-0 items-center gap-1">
            <CwButton size="xs" variant="danger" disabled={deleting === entry.id} onClick={() => void remove(entry)}>
              {deleting === entry.id ? 'Borrando…' : 'Sí, borrar'}
            </CwButton>
            <CwButton size="xs" variant="ghost" disabled={deleting === entry.id} onClick={() => setConfirming(null)}>No</CwButton>
          </div>
          : <CwButton size="icon-sm" variant="ghost" className="-mr-1.5 h-7 w-7 shrink-0" aria-label={`Borrar «${entry.title}»`} title="Borrar"
            onClick={() => setConfirming(entry.id)}><Trash2 aria-hidden="true" /></CwButton>)}
      </li>)}
    </ul>
    {icon === 'team' && items.some(entry => !entry.canDelete) && <p className="mt-1.5 text-[12px] text-cw-muted">Los pedidos de tu equipo los borra quien los guardó o un administrador.</p>}
  </section>;

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[85vh] max-w-lg gap-0 overflow-hidden border-cw-border bg-cw-bg p-0 text-cw-text sm:rounded-2xl">
      <div className="border-b border-cw-border px-5 pb-3.5 pt-5 pr-12">
        <DialogTitle className="text-[16px] font-semibold text-cw-text">{canSave ? 'Guardar este pedido' : 'Pedidos guardados'}</DialogTitle>
        <DialogDescription className="mt-1 text-[13px] leading-5 text-cw-muted">
          Para usar uno, escribe «/» al comienzo de la caja de mensajes y elígelo.
        </DialogDescription>
      </div>
      {canSave && <form className="space-y-3 border-b border-cw-border px-5 py-4" onSubmit={event => { event.preventDefault(); void save(); }}>
        <p className="line-clamp-3 rounded-lg bg-cw-panel px-3 py-2 text-[13px] leading-5 text-cw-text">{request}</p>
        <div>
          <label htmlFor={`${ids}-title`} className="mb-1 block text-[12.5px] font-medium text-cw-text">Nombre</label>
          <input id={`${ids}-title`} className={cn(field, 'h-9')} value={title} maxLength={80} disabled={saving} autoFocus
            placeholder={coworkPromptTitle(request)} onChange={event => setTitle(event.target.value)} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-[12.5px] text-cw-muted">
            <input type="checkbox" className="h-3.5 w-3.5 accent-[color:var(--cw-accent)]" checked={shared} disabled={saving} onChange={event => setShared(event.target.checked)} />
            Compartir con mi equipo
          </label>
          <CwButton type="submit" size="sm" variant="primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar pedido'}</CwButton>
        </div>
      </form>}
      <div className="cw-scroll max-h-[50vh] space-y-4 overflow-y-auto px-5 py-4">
        {prompts.length === 0 && <div className="rounded-xl border border-dashed border-cw-border px-4 py-5 text-center">
          <p className="text-[13.5px] font-medium text-cw-text">Todavía no hay pedidos guardados</p>
          <p className="mt-1 text-[12.5px] leading-5 text-cw-muted">Cuando un pedido te sirva, guárdalo para repetirlo sin escribirlo de nuevo. Puedes tener hasta {COWORK_PROMPTS_PER_PERSON}.</p>
        </div>}
        {list('Tuyos', own, 'own')}
        {list('De tu equipo', team, 'team')}
      </div>
      <p role={failed ? 'alert' : 'status'} className={cn('border-t border-cw-border px-5 py-2.5 text-[12.5px]', failed ? 'text-cw-danger' : 'text-cw-muted', !notice && 'sr-only')}>{notice}</p>
    </DialogContent>
  </Dialog>;
}
