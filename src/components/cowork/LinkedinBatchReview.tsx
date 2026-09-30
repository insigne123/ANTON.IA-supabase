'use client';

import { useEffect, useState } from 'react';
import { Check, CircleSlash, Minus, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReviewActions, ReviewError, ReviewLoading, ReviewNote } from './ReviewParts';

type Item = { id: string; name: string | null; company: string | null; title: string | null; canonicalUrl: string; message?: string };
type Deferred = { id: string; name: string | null; company: string | null; reason: string };
type Result = { id: string; name: string | null; status: 'queued' | 'reused' | 'skipped' | 'removed'; reason?: string };
type Preview = {
  kind: 'invite' | 'message'; items: Item[]; deferred: Deferred[]; excluded: string[]; matches: boolean; open: boolean;
  quota: { used: number; limit: number } | null; results: Result[] | null;
};

const endpoint = (runId: string) => `/api/cowork/runs/${runId}/linkedinbatch`;
const who = (person: { name: string | null }) => person.name || 'Sin nombre';

async function loadPreview(runId: string): Promise<Preview> {
  const response = await fetch(endpoint(runId), { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
  return data;
}

/** A person of the batch: who, their company and, for a message, the exact text they get. «Incluir» takes them off the list. */
function PersonRow({ item, kind, included, disabled, onToggle }: { item: Item; kind: Preview['kind']; included: boolean; disabled: boolean; onToggle: () => void }) {
  return <li>
    <label className={cn('flex cursor-pointer items-start gap-3 px-3 py-2.5', disabled && 'cursor-default', !included && 'bg-cw-hover')}>
      <input type="checkbox" checked={included} disabled={disabled} onChange={onToggle}
        aria-label={`${included ? 'Quitar de la lista a' : 'Volver a incluir a'} ${who(item)}`}
        className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--cw-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]" />
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[13.5px] font-medium', !included && 'text-cw-muted line-through decoration-cw-faint')}>{who(item)}</span>
        <span className="block break-words text-[12.5px] text-cw-muted">{[item.title, item.company].filter(Boolean).join(' · ') || 'Sin cargo ni empresa'}</span>
        {kind === 'message' && item.message && <span className={cn('mt-1.5 block whitespace-pre-wrap break-words rounded-lg border border-cw-border bg-cw-elevated px-3 py-2 text-[13px] leading-5', !included && 'text-cw-muted')}>{item.message}</span>}
      </span>
      {!included && <span className="shrink-0 pt-0.5 text-[12px] font-medium text-cw-muted">Fuera</span>}
    </label>
  </li>;
}

/**
 * Review card of a batch of LinkedIn invitations or messages: everyone who would go (for messages, with the text each one gets),
 * who waits for another day and why, and a mark on each person to take them off before approving. The people taken off are saved
 * just before the approval; a staged list that no longer matches the proposal blocks it.
 */
export function LinkedinBatchReview({ runId, onApprove, onReject, resolving }: {
  runId: string; onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let disposed = false;
    setPreview(null);
    setError('');
    loadPreview(runId)
      .then(data => { if (!disposed) { setPreview(data); setRemoved(new Set(data.excluded)); } })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [runId]);
  if (error && !preview) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Cargando la lista de personas…" />;
  const noun = preview.kind === 'invite' ? 'invitaciones' : 'mensajes';
  const singular = preview.kind === 'invite' ? 'invitación' : 'mensaje';
  const kept = preview.items.filter(item => !removed.has(item.id));
  const locked = saving || resolving || !preview.open;
  const changed = removed.size !== preview.excluded.length || preview.excluded.some(id => !removed.has(id));
  const toggle = (id: string) => setRemoved(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  async function approve() {
    setError('');
    setSaving(true);
    try {
      if (changed) {
        const response = await fetch(endpoint(runId), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ excluded: [...removed] }) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'No se pudo guardar a quién quitaste.');
        setPreview(current => current && { ...current, excluded: [...removed] });
      }
      onApprove();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar a quién quitaste.');
    } finally {
      setSaving(false);
    }
  }
  return <div className="space-y-4">
    <div className="space-y-1">
      <p className="text-[14px]"><span className="font-semibold">{kept.length} de {preview.items.length} {noun}</span>
        <span className="text-cw-muted"> saldrían hoy, una persona por empresa.</span></p>
      {preview.quota && <p className="text-[12.5px] text-cw-muted">Cupo semanal de invitaciones: {preview.quota.used} de {preview.quota.limit} usadas entre pendientes y enviadas.</p>}
    </div>
    <ul aria-label={`Personas del lote de ${noun}`} className="cw-scroll max-h-96 divide-y divide-cw-border overflow-y-auto rounded-xl border border-cw-border bg-cw-panel">
      {preview.items.map(item => <PersonRow key={item.id} item={item} kind={preview.kind} included={!removed.has(item.id)} disabled={locked} onToggle={() => toggle(item.id)} />)}
    </ul>
    {!!preview.deferred.length && <details className="rounded-xl border border-cw-border bg-cw-panel px-3 py-2.5 text-[13px]">
      <summary className="cursor-pointer text-cw-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">
        {preview.deferred.length === 1 ? '1 persona no sale hoy' : `${preview.deferred.length} personas no salen hoy`}
      </summary>
      <ul className="mt-2 space-y-1.5">
        {preview.deferred.map(person => <li key={person.id}><span className="font-medium">{who(person)}</span>
          {person.company && <span className="text-cw-muted"> · {person.company}</span>}
          <span className="block text-[12.5px] text-cw-muted">{person.reason}</span></li>)}
      </ul>
    </details>}
    {error && <ReviewError message={error} />}
    <ReviewNote ok={preview.matches && preview.open}>{!preview.matches
      ? 'La lista cambió desde la propuesta. Descártala y pide una nueva.'
      : !preview.open ? 'Esta propuesta ya se decidió.'
        : `Coincide con la propuesta. Al aprobar se dejan en cola solo las personas marcadas; nada sale hasta que lo ejecutes desde tu extensión, y a quienes no salen hoy no se les toca.`}</ReviewNote>
    <ReviewActions onReject={onReject} onApprove={() => void approve()} approveLabel={kept.length ? `Aprobar ${kept.length} ${kept.length === 1 ? singular : noun}` : 'Aprobar'}
      disabled={!preview.matches || !preview.open || !kept.length || saving} resolving={resolving} />
  </div>;
}

/** What happened to each person once the batch ran: in the queue of the extension, left out and why, or taken off by you. */
export function LinkedinBatchResults({ runId }: { runId: string }) {
  const [results, setResults] = useState<Result[] | null>(null);
  useEffect(() => {
    let disposed = false;
    loadPreview(runId).then(data => { if (!disposed) setResults(data.results); }).catch(() => { if (!disposed) setResults(null); });
    return () => { disposed = true; };
  }, [runId]);
  if (!results?.length) return null;
  return <ul aria-label="Resultado por persona" className="divide-y divide-cw-border rounded-xl border border-cw-border bg-cw-panel text-[13px]">
    {results.map(result => <li key={result.id} className="flex items-start gap-2.5 px-3 py-2">
      {result.status === 'queued' || result.status === 'reused' ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-cw-success" aria-hidden="true" />
        : result.status === 'removed' ? <Minus className="mt-0.5 h-4 w-4 shrink-0 text-cw-muted" aria-hidden="true" />
          : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-cw-warning" aria-hidden="true" />}
      <span className="min-w-0 flex-1">
        <span className="font-medium">{who(result)}</span>
        <span className="block break-words text-[12.5px] text-cw-muted">
          {result.status === 'queued' ? 'En cola en tu extensión' : result.status === 'reused' ? 'Ya estaba en cola' : result.status === 'removed' ? 'La quitaste de la lista' : result.reason || 'No salió'}
        </span>
      </span>
      {result.status === 'skipped' && <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-cw-faint" aria-hidden="true" />}
    </li>)}
  </ul>;
}
