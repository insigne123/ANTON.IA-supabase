'use client';

import { useState } from 'react';
import { Pencil, Sparkles, TriangleAlert } from 'lucide-react';
import { CoworkEmailFields, FIELD } from './CoworkBlocks';
import { CwButton } from './ui';
import { cn } from '@/lib/utils';

/** One recipient of a proposed campaign, as the preview route builds it (coworkCampaignPeople). */
export type CampaignPerson = {
  email: string; name: string; company: string; title: string;
  available: boolean; personal: boolean;
  first: { subject: string; body: string } | null;
  /** Its greeting names the person; null without an email (older servers do not send it). */
  greetsByName?: boolean | null;
  problem: string | null;
};

type Editing = { email: string; subject: string; body: string };

/**
 * The recipients of a proposed campaign, each with the first email they will receive (written for them, or the
 * template with their data). Open one to read it; edit it by hand or ask the AI for a change for that person only.
 * Saving replaces that person's first email and nothing else.
 */
export function CampaignPeople({ runId, people, objective, relationship, definitionHash, locked, onSaved, onEditingChange }: {
  runId: string; people: CampaignPerson[]; objective: string; relationship: 'never_contacted' | 'previously_contacted';
  definitionHash?: string;
  /** Another edit of the card is open: one at a time. */
  locked: boolean;
  onSaved: () => Promise<void>;
  onEditingChange: (editing: boolean) => void;
}) {
  const [editing, setEditingState] = useState<Editing | null>(null);
  const [instruction, setInstruction] = useState('');
  const [proposal, setProposal] = useState<{ subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState<'asking' | 'saving' | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const setEditing = (next: Editing | null) => {
    setEditingState(next); setInstruction(''); setProposal(null); setError('');
    onEditingChange(Boolean(next));
  };
  const own = people.filter(person => person.personal).length;
  const complete = !editing || Boolean(editing.subject.trim() && editing.body.trim());
  const nameOf = (email: string) => people.find(person => person.email === email)?.name || email;

  async function ask() {
    if (!editing || busy) return;
    setBusy('asking'); setError('');
    try {
      const person = people.find(item => item.email === editing.email);
      const response = await fetch('/api/campaigns/bulk/assist', {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'message', instruction: instruction.trim(), objective: objective.slice(0, 2000), relationship,
          current: { subject: editing.subject, body: editing.body, delayDays: 0 }, messageIndex: 0,
          audience: person ? [person.name, person.title, person.company].filter(Boolean).join(' · ').slice(0, 2000) || undefined : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.proposal) throw new Error(data.error || 'La IA no pudo proponer un cambio ahora. Inténtalo de nuevo.');
      setProposal({ subject: String(data.proposal.subject || ''), body: String(data.proposal.body || '') });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La IA no pudo proponer un cambio ahora. Inténtalo de nuevo.');
    } finally { setBusy(null); }
  }

  async function save() {
    if (!editing || busy || !complete) return;
    setBusy('saving'); setError(''); setSaved('');
    try {
      const response = await fetch(`/api/cowork/runs/${runId}/campaign-preview`, {
        method: 'PATCH', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedHash: definitionHash, person: { email: editing.email, subject: editing.subject.trim(), body: editing.body.trim() } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar el correo.');
      const name = nameOf(editing.email);
      await onSaved();
      setEditing(null);
      setSaved(`Guardaste el correo de ${name}: la campaña se crea con esta versión.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el correo.');
    } finally { setBusy(null); }
  }

  return <section aria-labelledby={`cw-people-${runId}`} className="space-y-2">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 id={`cw-people-${runId}`} className="text-[12.5px] font-medium text-cw-muted">Primer correo de cada persona</h3>
      <span className="text-[12px] text-cw-muted">{own === 0 ? 'La plantilla, con el nombre de cada una'
        : own === people.length ? 'Escrito para cada una' : `${own} de ${people.length} escritos para la persona`}</span>
    </div>
    <ul className="space-y-2">
      {people.map((person, index) => {
        const mine = editing?.email === person.email;
        return <li key={person.email}>
          <details className="group rounded-xl border border-cw-border bg-cw-panel" open={index === 0 || mine}>
            <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-3.5 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">{person.name || person.email}</span>
                <span className="block truncate text-[12px] text-cw-muted">{[person.title, person.company].filter(Boolean).join(' · ') || person.email}</span>
              </span>
              {person.problem
                ? <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-cw-warning"><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />Revisar</span>
                : person.greetsByName === false
                  ? <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-cw-warning"><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />Saludo sin su nombre</span>
                  : <span className="shrink-0 rounded-md border border-cw-border px-1.5 py-0.5 text-[11.5px] leading-5 text-cw-muted">{person.personal ? 'Escrito para esta persona' : 'Plantilla con su nombre'}</span>}
            </summary>
            <div className="space-y-3 border-t border-cw-border px-4 py-3">
              <p className="break-all text-[12px] text-cw-muted">Para {person.email}</p>
              {(person.problem || person.greetsByName === false) && <p role="note" className="flex items-start gap-2 rounded-lg bg-cw-warning-soft px-2.5 py-2 text-[12.5px] leading-5 text-cw-warning">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{person.problem || (person.personal
                  ? 'El saludo no lleva su nombre. Edita su correo para saludarla por su nombre de pila.'
                  : 'El saludo no lleva su nombre. Edita la secuencia y abre con «Hola {{nombre}},»: la campaña pone el nombre de cada persona.')}</span>
              </p>}
              {mine && editing ? <div className="space-y-3">
                <CoworkEmailFields step={editing} index={0} total={1} idPrefix={`cw-person-${runId}-${index}`}
                  onChange={next => { setEditingState({ ...editing, subject: next.subject, body: next.body }); setProposal(null); }} />
                <div>
                  <label htmlFor={`cw-person-${runId}-${index}-ask`} className="mb-1 block text-[12px] font-medium text-cw-muted">Pedir un cambio a la IA, solo para esta persona</label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input id={`cw-person-${runId}-${index}-ask`} value={instruction} maxLength={2000} disabled={busy !== null}
                      placeholder="Ej.: más corto y menciona su apertura en regiones"
                      onChange={event => setInstruction(event.target.value)}
                      onKeyDown={event => { if (event.key === 'Enter' && instruction.trim().length >= 5) { event.preventDefault(); void ask(); } }}
                      className={cn(FIELD, 'h-9 min-w-0 flex-1 text-[13.5px]')} />
                    <CwButton size="sm" variant="secondary" disabled={busy !== null || instruction.trim().length < 5} onClick={() => void ask()}>
                      <Sparkles aria-hidden="true" />{busy === 'asking' ? 'Pidiendo…' : 'Proponer cambio'}
                    </CwButton>
                  </div>
                </div>
                {proposal && <div aria-live="polite" className="space-y-2 rounded-lg border border-cw-border bg-cw-elevated p-3">
                  <p className="text-[12px] font-medium text-cw-muted">Propuesta de la IA</p>
                  <p className="text-[13.5px] font-medium">{proposal.subject}</p>
                  <p className="whitespace-pre-wrap break-words text-[14px] leading-6">{proposal.body}</p>
                  <div className="flex flex-wrap justify-end gap-2">
                    <CwButton size="xs" variant="ghost" onClick={() => setProposal(null)}>Descartar</CwButton>
                    <CwButton size="xs" variant="secondary" onClick={() => { setEditingState({ ...editing, ...proposal }); setProposal(null); }}>Usar la propuesta</CwButton>
                  </div>
                </div>}
                {error && <p role="alert" className="text-[12.5px] text-cw-danger">{error}</p>}
                {!complete && <p role="alert" className="text-[12.5px] text-cw-danger">El correo necesita asunto y cuerpo.</p>}
                <div className="flex flex-wrap justify-end gap-2">
                  <CwButton variant="ghost" size="sm" disabled={busy !== null} onClick={() => setEditing(null)}>Cancelar</CwButton>
                  <CwButton variant="primary" size="sm" disabled={busy !== null || !complete} onClick={() => void save()}>{busy === 'saving' ? 'Guardando…' : 'Guardar su correo'}</CwButton>
                </div>
              </div>
                : person.first ? <>
                  <div>
                    <p className="text-[13.5px] font-medium">{person.first.subject}</p>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-[14px] leading-6">{person.first.body}</p>
                  </div>
                  <div className="flex justify-end">
                    <CwButton size="xs" variant="secondary" disabled={locked || Boolean(editing) || busy !== null}
                      onClick={() => { setSaved(''); setEditing({ email: person.email, subject: person.first?.subject || '', body: person.first?.body || '' }); }}>
                      <Pencil aria-hidden="true" />Editar su correo
                    </CwButton>
                  </div>
                </> : null}
            </div>
          </details>
        </li>;
      })}
    </ul>
    {saved && <p role="status" className="text-[12.5px] text-cw-muted">{saved}</p>}
  </section>;
}
