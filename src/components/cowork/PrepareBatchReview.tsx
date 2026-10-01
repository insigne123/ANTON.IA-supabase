'use client';

import { useEffect, useState } from 'react';
import { Check, ExternalLink, Minus, TriangleAlert } from 'lucide-react';
import { displayLeadName } from '@/lib/lead-name';
import { cn } from '@/lib/utils';
import { ReviewActions, ReviewError, ReviewLoading, ReviewNote } from './ReviewParts';

type Step = 'save' | 'enrich' | 'research';
type Item = { id: string; providerId?: string; name: string | null; company: string | null; title: string | null; steps: Step[]; done: Step[] };
type Ready = { id: string; name: string | null; company: string | null; reason: string };
type StepResult = { step: Step; status: 'done' | 'reused' | 'failed' | 'skipped'; detail?: string };
type Result = {
  id: string; name: string | null; company: string | null; status: 'ready' | 'partial' | 'failed' | 'removed'; steps: StepResult[];
  email?: string | null; emailStatus?: string | null; linkedinUrl?: string | null; emailWarning?: string | null; research?: string | null;
};
type Preview = {
  items: Item[]; ready: Ready[]; excluded: string[]; matches: boolean; open: boolean;
  cost: { saves: number; lookups: number; research: number }; balance: { remaining: number; stale: boolean } | null; results: Result[] | null;
};

const endpoint = (runId: string) => `/api/cowork/runs/${runId}/preparebatch`;
const TODO: Record<Step, string> = { save: 'Guardar', enrich: 'Buscar correo', research: 'Investigar' };
const DONE: Record<Step, string> = { save: 'Ya guardado', enrich: 'Correo ya buscado', research: 'Ya investigado' };
const people = (count: number) => `${count} ${count === 1 ? 'persona' : 'personas'}`;

async function loadPreview(runId: string): Promise<Preview> {
  const response = await fetch(endpoint(runId), { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
  return data;
}

/** «Rafael D.» while the provider hides the surname, with why. */
function PersonName({ name, struck }: { name: string | null; struck?: boolean }) {
  const shown = displayLeadName(name);
  return <span className={cn('block text-[13.5px] font-medium', struck && 'text-cw-muted line-through decoration-cw-faint')}>
    <span title={shown.masked ? 'El proveedor oculta el apellido hasta que se busca el correo.' : undefined}>{shown.text || 'Sin nombre'}</span>
    {shown.masked && <span className="ml-1.5 text-[12px] font-normal text-cw-muted no-underline">apellido al buscar el correo</span>}
  </span>;
}

/** What will be done for a person (in order) and what was already done and is skipped. */
function StepChips({ item, included }: { item: Item; included: boolean }) {
  return <span className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Pasos">
    {(['save', 'enrich', 'research'] as Step[]).map(step => item.steps.includes(step)
      ? <span key={step} className={cn('rounded-md px-1.5 py-0.5 text-[11.5px] font-medium', included ? 'bg-cw-accent-soft text-cw-accent' : 'bg-cw-hover text-cw-muted')}>{TODO[step]}</span>
      : item.done.includes(step)
        ? <span key={step} className="inline-flex items-center gap-1 rounded-md bg-cw-hover px-1.5 py-0.5 text-[11.5px] text-cw-muted"><Check className="h-3 w-3" aria-hidden="true" />{DONE[step]}</span>
        : null)}
  </span>;
}

function PersonRow({ item, included, disabled, onToggle }: { item: Item; included: boolean; disabled: boolean; onToggle: () => void }) {
  const shown = displayLeadName(item.name).text || 'Sin nombre';
  return <li>
    <label className={cn('flex cursor-pointer items-start gap-3 px-3 py-2.5', disabled && 'cursor-default', !included && 'bg-cw-hover')}>
      <input type="checkbox" checked={included} disabled={disabled} onChange={onToggle}
        aria-label={`${included ? 'Quitar de la lista a' : 'Volver a incluir a'} ${shown}`}
        className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--cw-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]" />
      <span className="min-w-0 flex-1">
        <PersonName name={item.name} struck={!included} />
        <span className="block break-words text-[12.5px] text-cw-muted">{[item.title, item.company].filter(Boolean).join(' · ') || 'Sin cargo ni empresa'}</span>
        <StepChips item={item} included={included} />
      </span>
      {!included && <span className="shrink-0 pt-0.5 text-[12px] font-medium text-cw-muted">Fuera</span>}
    </label>
  </li>;
}

/** «Usa hasta 2 créditos para buscar correos y 2 investigaciones de tu cupo diario». Only what costs, counted over who stays. */
function costLine(kept: Item[]) {
  const lookups = kept.filter(item => item.steps.includes('enrich')).length;
  const research = kept.filter(item => item.steps.includes('research')).length;
  const parts = [lookups ? `hasta ${lookups} ${lookups === 1 ? 'crédito' : 'créditos'} para buscar correos (1 por persona)` : '',
    research ? `${research} ${research === 1 ? 'investigación' : 'investigaciones'} de tu cupo diario` : ''].filter(Boolean);
  return parts.length ? `Usa ${parts.join(' y ')}.` : 'Solo guarda contactos: no gasta créditos.';
}

/**
 * Review card of «preparar contactos»: everyone in the batch with only the steps they still need (what is done shows as done and is
 * not charged again), who was already ready, the cost of the people who stay, and a mark on each person to take them off before
 * approving. The people taken off are saved just before the approval; a staged list that no longer matches the proposal blocks it.
 */
export function PrepareBatchReview({ runId, onApprove, onReject, resolving }: {
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
  const kept = preview.items.filter(item => !removed.has(item.id));
  const locked = saving || resolving || !preview.open;
  const changed = removed.size !== preview.excluded.length || preview.excluded.some(id => !removed.has(id));
  const toggle = (id: string) => setRemoved(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const lookups = kept.filter(item => item.steps.includes('enrich')).length;
  const short = preview.balance && lookups > preview.balance.remaining;
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
      <p className="text-[14px]"><span className="font-semibold">{kept.length} de {people(preview.items.length)}</span>
        <span className="text-cw-muted"> quedan listas con esta aprobación, cada una solo con lo que le falta.</span></p>
      <p className="text-[12.5px] text-cw-muted">{costLine(kept)}{preview.balance
        ? ` Te quedan ${preview.balance.remaining} créditos${preview.balance.stale ? ' (dato de hace un rato)' : ''}.` : ''}</p>
    </div>
    <ul aria-label="Personas del lote" className="cw-scroll max-h-96 divide-y divide-cw-border overflow-y-auto rounded-xl border border-cw-border bg-cw-panel">
      {preview.items.map(item => <PersonRow key={item.id} item={item} included={!removed.has(item.id)} disabled={locked} onToggle={() => toggle(item.id)} />)}
    </ul>
    {!!preview.ready.length && <details className="rounded-xl border border-cw-border bg-cw-panel px-3 py-2.5 text-[13px]">
      <summary className="cursor-pointer text-cw-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">
        {preview.ready.length === 1 ? '1 persona ya estaba lista' : `${preview.ready.length} personas ya estaban listas`}
      </summary>
      <ul className="mt-2 space-y-1.5">
        {preview.ready.map(person => <li key={person.id}><span className="font-medium">{displayLeadName(person.name).text || 'Sin nombre'}</span>
          {person.company && <span className="text-cw-muted"> · {person.company}</span>}
          <span className="block text-[12.5px] text-cw-muted">{person.reason}</span></li>)}
      </ul>
    </details>}
    {short && <ReviewNote ok={false}>Los créditos que quedan no alcanzan para buscar todos los correos: los que no alcancen quedan sin buscar y se avisa en cada persona.</ReviewNote>}
    {error && <ReviewError message={error} />}
    <ReviewNote ok={preview.matches && preview.open}>{!preview.matches
      ? 'La lista cambió desde la propuesta. Descártala y pide una nueva.'
      : !preview.open ? 'Esta propuesta ya se decidió.'
        : 'Coincide con la propuesta. Al aprobar se hace, persona por persona, solo lo marcado; no se le escribe a nadie y a quien quites no se le toca.'}</ReviewNote>
    <ReviewActions onReject={onReject} onApprove={() => void approve()} approveLabel={kept.length ? `Preparar a ${people(kept.length)}` : 'Aprobar'}
      disabled={!preview.matches || !preview.open || !kept.length || saving} resolving={resolving} />
  </div>;
}

const STEP_PROBLEM = (result: Result) => result.steps.find(step => step.status === 'failed' || step.status === 'skipped') || result.steps.find(step => step.detail);

function emailLine(result: Result) {
  if (result.email) return `${result.email}${result.emailStatus ? ` · ${result.emailStatus === 'verified' ? 'verificado' : 'sin verificar'}` : ''}`;
  return result.steps.some(step => step.step === 'enrich') ? 'Sin correo' : null;
}

/** What happened to each person once the batch ran: real name, email with its status, LinkedIn and research, or what was missing and why. */
export function PrepareBatchResults({ runId }: { runId: string }) {
  const [results, setResults] = useState<Result[] | null>(null);
  useEffect(() => {
    let disposed = false;
    loadPreview(runId).then(data => { if (!disposed) setResults(data.results); }).catch(() => { if (!disposed) setResults(null); });
    return () => { disposed = true; };
  }, [runId]);
  if (!results?.length) return null;
  return <ul aria-label="Resultado por persona" className="divide-y divide-cw-border rounded-xl border border-cw-border bg-cw-panel text-[13px]">
    {results.map(result => {
      const problem = STEP_PROBLEM(result);
      const email = emailLine(result);
      return <li key={result.id} className="flex items-start gap-2.5 px-3 py-2.5">
        {result.status === 'ready' ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-cw-success" aria-hidden="true" />
          : result.status === 'removed' ? <Minus className="mt-0.5 h-4 w-4 shrink-0 text-cw-muted" aria-hidden="true" />
            : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-cw-warning" aria-hidden="true" />}
        <span className="min-w-0 flex-1 space-y-0.5">
          <PersonName name={result.name} />
          {result.company && <span className="block text-[12.5px] text-cw-muted">{result.company}</span>}
          {result.status === 'removed' ? <span className="block text-[12.5px] text-cw-muted">La quitaste de la lista</span> : <>
            {email && <span className="block break-words text-[12.5px]">{email}</span>}
            {result.emailWarning && <span className="block text-[12.5px] text-cw-warning">{result.emailWarning}</span>}
            {result.linkedinUrl && <a href={result.linkedinUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 rounded text-[12.5px] font-medium text-cw-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">
              Perfil de LinkedIn<ExternalLink className="h-3 w-3" aria-hidden="true" /></a>}
            {result.research && <span className="block text-[12.5px] text-cw-muted">{result.research === 'completed' ? 'Investigación lista' : 'Investigación en curso'}</span>}
            {problem?.detail && <span className="block text-[12.5px] text-cw-muted">{problem.detail}</span>}
          </>}
        </span>
      </li>;
    })}
  </ul>;
}
