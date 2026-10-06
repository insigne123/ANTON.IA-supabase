'use client';

import { useCallback, useEffect, useState } from 'react';
import { Brain, LoaderCircle, RotateCcw, Trash2, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { CwButton } from './ui';

type Memory = { id: string; text: string; scope: 'personal' | 'organization'; mine: boolean; canForget: boolean; updatedAt: string | null };

/**
 * «Lo que Cowork recuerda» (Plan 13): what its turns read about you and your organization, and «Olvidar» for each, as in Claude
 * or ChatGPT. Something new is remembered from the chat («recuerda que…»), with a card to approve.
 */
export function CoworkMemories({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

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

  const personal = (memories || []).filter(memory => memory.scope === 'personal');
  const shared = (memories || []).filter(memory => memory.scope === 'organization');

  const list = (title: string, items: Memory[], icon: 'personal' | 'organization') => items.length > 0 && <section>
    <h3 className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-cw-text">
      {icon === 'organization' ? <Users className="h-3.5 w-3.5 text-cw-muted" aria-hidden="true" /> : <Brain className="h-3.5 w-3.5 text-cw-muted" aria-hidden="true" />}
      {title}
    </h3>
    <ul className="divide-y divide-cw-border rounded-xl border border-cw-border bg-cw-elevated">
      {items.map(memory => <li key={memory.id} className="flex items-center gap-3 px-3.5 py-2">
        <p className="min-w-0 flex-1 break-words text-[13.5px] leading-5 text-cw-text">{memory.text}</p>
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
          Cowork usa esto en cada conversación. Para que recuerde algo nuevo, díselo en el chat: «recuerda que tuteo a todos».
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
      <p role="status" className={cn('border-t border-cw-border px-5 py-2.5 text-[12.5px] text-cw-muted', !notice && 'sr-only')}>{notice}</p>
    </DialogContent>
  </Dialog>;
}
