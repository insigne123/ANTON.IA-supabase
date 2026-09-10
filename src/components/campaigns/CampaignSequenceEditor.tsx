'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CampaignMessageSchema, type CampaignInput, type CampaignMessage } from '@/lib/bulk-campaigns';
import { validateSequenceProposal } from '@/lib/bulk-campaign-assist';

type Props = {
  definition: CampaignInput;
  messageIndex: number;
  busy: boolean;
  reviseMode: boolean;
  isLocked: (index: number) => boolean;
  onSelect: (index: number) => void;
  onChange: (patch: Partial<CampaignInput>) => void;
  onBusyChange: (busy: boolean) => void;
  onAssist: (input: unknown) => Promise<any>;
  onBack: () => void;
  onSave: () => void;
};
const label = (index: number) => index === 0 ? 'Primer correo' : `Seguimiento ${index}`;

export function CampaignSequenceEditor({ definition, messageIndex, busy, reviseMode, isLocked, onSelect, onChange, onBusyChange, onAssist, onBack, onSave }: Props) {
  const [followUpCount, setFollowUpCount] = useState<number | null>(() =>
    reviseMode || definition.messages.length > 1 || definition.messages.some(value => value.subject.trim() || value.body.trim())
      ? definition.messages.length - 1 : null);
  const [instruction, setInstruction] = useState('');
  const [proposal, setProposal] = useState<CampaignMessage | null>(null);
  const [sequenceProposal, setSequenceProposal] = useState<CampaignMessage[] | null>(null);
  const [job, setJob] = useState<'sequence' | 'message' | null>(null);
  const [sequenceError, setSequenceError] = useState('');
  const [messageError, setMessageError] = useState('');
  const [sequenceFeedback, setSequenceFeedback] = useState('');
  const [messageFeedback, setMessageFeedback] = useState('');
  const sequenceResultRef = useRef<HTMLDivElement>(null);
  const messageResultRef = useRef<HTMLDivElement>(null);
  const message = definition.messages[messageIndex];
  const hasContent = definition.messages.some(value => value.subject.trim() || value.body.trim());
  const scheduleValid = definition.messages.slice(1).every(value => Number.isInteger(value.delayDays) && value.delayDays >= 1 && value.delayDays <= 90);
  const canSave = followUpCount !== null && scheduleValid && definition.messages.every(value => CampaignMessageSchema.safeParse(value).success);

  useEffect(() => { setInstruction(''); setProposal(null); setMessageError(''); setMessageFeedback(''); }, [messageIndex]);
  useEffect(() => { if (sequenceError || sequenceFeedback || sequenceProposal) sequenceResultRef.current?.focus(); }, [sequenceError, sequenceFeedback, sequenceProposal]);
  useEffect(() => { if (messageError || messageFeedback || proposal) messageResultRef.current?.focus(); }, [messageError, messageFeedback, proposal]);

  function invalidateSequence() { setSequenceProposal(null); setSequenceError(''); setSequenceFeedback(''); }
  function updateMessage(patch: Partial<CampaignMessage>) {
    onChange({ messages: definition.messages.map((value, index) => index === messageIndex ? { ...value, ...patch } : value) });
    setProposal(null); setMessageError(''); setMessageFeedback(''); invalidateSequence();
  }
  function chooseCount(count: number) {
    const removed = definition.messages.slice(count + 1);
    if (removed.some(value => value.subject.trim() || value.body.trim()) && !window.confirm('Al reducir los seguimientos se quitarán sus correos. ¿Quieres continuar?')) return;
    const messages = Array.from({ length: count + 1 }, (_, index) => definition.messages[index] || { subject: '', body: '', delayDays: 3 });
    setFollowUpCount(count); onChange({ messages });
    if (messageIndex >= messages.length) onSelect(0);
    setProposal(null); invalidateSequence();
  }
  async function generate(kind: 'sequence' | 'message') {
    if (busy || (kind === 'sequence' && (reviseMode || followUpCount === null || !scheduleValid)) || (kind === 'message' && isLocked(messageIndex))) return;
    setJob(kind); onBusyChange(true);
    if (kind === 'sequence') { invalidateSequence(); setProposal(null); }
    else { setMessageError(''); setMessageFeedback(''); setProposal(null); }
    try {
      if (kind === 'sequence') {
        const followUpDelays = definition.messages.slice(1).map(value => value.delayDays);
        const result = await onAssist({ mode: 'sequence', objective: definition.objective, audience: definition.description,
          relationship: definition.criteria.relationship, followUpDelays });
        const messages = validateSequenceProposal(result, followUpDelays);
        if (hasContent) setSequenceProposal(messages);
        else {
          onChange({ messages }); onSelect(0);
          setSequenceFeedback(`Secuencia generada: ${messages.length} ${messages.length === 1 ? 'correo' : 'correos'}. Revisa cada mensaje antes de continuar.`);
        }
      } else {
        const result = await onAssist({ mode: 'message', instruction, objective: definition.objective,
          audience: definition.description, current: message, relationship: definition.criteria.relationship,
          sequenceContext: definition.messages, messageIndex });
        const parsed = CampaignMessageSchema.safeParse(result.proposal);
        if (!parsed.success) throw new Error('La IA no devolvió un correo completo. Vuelve a intentarlo.');
        setProposal({ ...parsed.data, delayDays: message.delayDays });
      }
    } catch (caught) {
      const error = caught instanceof Error && ['TimeoutError', 'AbortError'].includes(caught.name)
        ? 'La IA tardó más de lo esperado. Tus correos se conservan; vuelve a intentarlo.'
        : caught instanceof Error ? caught.message : 'No se pudo completar la propuesta. Vuelve a intentarlo.';
      if (kind === 'sequence') setSequenceError(error); else setMessageError(error);
    } finally { setJob(null); onBusyChange(false); }
  }

  return <>
    <header className="space-y-2"><h2 className="text-xl font-semibold">{reviseMode ? 'Edita los mensajes pendientes' : 'Prepara tu secuencia de correos'}</h2>
      <p className="text-sm text-muted-foreground">{reviseMode ? 'Los mensajes enviados o en curso están bloqueados. Los cambios pendientes volverán a revisión.' : 'Elige los seguimientos, genera la secuencia y ajusta cada correo antes de aprobar.'}</p>
    </header>
    <div className="space-y-3">
      <Label htmlFor="objective">¿Qué quieres conseguir con la campaña?</Label>
      <Textarea id="objective" maxLength={2000} disabled={busy} value={definition.objective} onChange={event => { onChange({ objective: event.target.value }); invalidateSequence(); setProposal(null); }} placeholder="Describe tu servicio, qué ofreces y qué quieres que haga la persona al leer el correo." />
      {!reviseMode && <>
        <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-2"><Label htmlFor="follow-up-count">¿Cuántos seguimientos quieres?</Label>
            <select id="follow-up-count" className="min-h-11 w-full rounded-md border bg-background px-3 focus-visible:outline-ring" disabled={busy} value={followUpCount ?? ''} onChange={event => chooseCount(Number(event.target.value))} aria-describedby="sequence-help">
              <option value="" disabled>Elige antes de generar</option>
              {[0, 1, 2, 3, 4].map(count => <option key={count} value={count}>{count === 0 ? 'Solo el correo inicial' : `${count} ${count === 1 ? 'seguimiento' : 'seguimientos'} + correo inicial`}</option>)}
            </select>
          </div>
          <Button disabled={busy || followUpCount === null || definition.objective.trim().length < 5 || !scheduleValid} onClick={() => void generate('sequence')}>{job === 'sequence' ? 'Generando secuencia…' : hasContent ? 'Proponer nueva secuencia' : 'Generar secuencia con IA'}</Button>
        </div>
        <p id="sequence-help" className="text-sm text-muted-foreground">{followUpCount === null ? 'Tú eliges la cantidad. La IA redactará el inicial y todos los seguimientos seleccionados.' : `La secuencia tendrá ${followUpCount + 1} ${followUpCount === 0 ? 'correo' : 'correos'}. Puedes ajustar los días de espera al seleccionar cada seguimiento.`}</p>
        <div ref={sequenceResultRef} tabIndex={-1} className="space-y-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          {job === 'sequence' && <p role="status" className="text-sm text-muted-foreground">Preparando el correo inicial y los seguimientos de tu secuencia…</p>}
          {sequenceError && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">{sequenceError}</p>}
          {sequenceFeedback && <p role="status" className="text-sm text-muted-foreground">{sequenceFeedback}</p>}
          {sequenceProposal && <div className="space-y-3 rounded-xl border bg-muted/40 p-4"><h3 className="font-medium">Nueva secuencia propuesta</h3><p className="text-sm text-muted-foreground">Tus correos actuales se conservan hasta que apliques esta secuencia.</p>
            <div className="max-h-96 divide-y overflow-y-auto">{sequenceProposal.map((value, index) => <article key={index} className="space-y-2 py-3"><h4 className="text-sm font-medium">{label(index)}</h4><p className="break-words font-medium">{value.subject}</p><p className="whitespace-pre-wrap break-words text-sm">{value.body}</p></article>)}</div>
            <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => { onChange({ messages: sequenceProposal }); setSequenceProposal(null); onSelect(0); setSequenceFeedback('Secuencia aplicada. Revisa cada correo antes de continuar.'); }}>Aplicar secuencia</Button><Button variant="ghost" disabled={busy} onClick={() => setSequenceProposal(null)}>Descartar secuencia</Button></div>
          </div>}
        </div>
      </>}
    </div>

    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Correos de la secuencia">{definition.messages.map((_, index) => <Button key={index} disabled={busy} aria-pressed={messageIndex === index} variant={messageIndex === index ? 'secondary' : 'ghost'} onClick={() => onSelect(index)}>{label(index)}{isLocked(index) ? ' · Bloqueado' : ''}</Button>)}</div>
        <h3 className="text-lg font-medium">{label(messageIndex)}</h3>
        {messageIndex > 0 && <div className="space-y-2"><Label htmlFor="delay">Días después del envío anterior</Label><Input id="delay" className="max-w-32" type="number" min={1} max={90} disabled={busy || isLocked(messageIndex)} value={message.delayDays} onChange={event => updateMessage({ delayDays: Number(event.target.value) })} /><p className="text-sm text-muted-foreground">El plazo empieza cuando se confirma el envío anterior. Los seguimientos se detienen si la persona responde.</p></div>}
        <div className="space-y-2"><Label htmlFor="subject">Asunto</Label><Input id="subject" maxLength={300} disabled={busy || isLocked(messageIndex)} value={message.subject} onChange={event => updateMessage({ subject: event.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="body">Correo</Label><Textarea id="body" className="min-h-64" maxLength={12000} disabled={busy || isLocked(messageIndex)} value={message.body} onChange={event => updateMessage({ body: event.target.value })} /><p className="text-sm text-muted-foreground">Puedes usar {'{{nombre}}'}, {'{{empresa}}'} y {'{{cargo}}'}. Incluye tu firma en el mensaje.</p></div>
      </div>
      <aside aria-label="Asistente de IA" className="min-w-0 space-y-4 rounded-xl border bg-muted/30 p-4 lg:sticky lg:top-6">
        <header className="space-y-1"><h3 className="font-semibold">Editar con IA</h3><p className="text-sm text-muted-foreground">{label(messageIndex)} · {isLocked(messageIndex) ? 'Este correo está bloqueado.' : 'Los cambios se proponen solo para este correo.'}</p></header>
        <div className="space-y-2"><Label htmlFor="instruction">¿Qué quieres cambiar en este correo?</Label><Textarea id="instruction" className="min-h-28" maxLength={2000} disabled={busy || isLocked(messageIndex)} value={instruction} onChange={event => { setInstruction(event.target.value); setProposal(null); setMessageError(''); setMessageFeedback(''); }} placeholder="Haz este seguimiento más breve, retoma el beneficio principal y termina con una pregunta." /></div>
        <Button variant="outline" className="w-full" disabled={busy || isLocked(messageIndex) || instruction.trim().length < 5} onClick={() => void generate('message')}>{job === 'message' ? 'Preparando cambios…' : 'Proponer cambios con IA'}</Button>
        <div ref={messageResultRef} tabIndex={-1} className="space-y-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          {job === 'message' && <p role="status" className="text-sm text-muted-foreground">Revisando este correo en el contexto de la secuencia…</p>}
          {messageError && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">{messageError}</p>}
          {messageFeedback && <p role="status" className="text-sm text-muted-foreground">{messageFeedback}</p>}
          {proposal && <div className="space-y-3"><h4 className="font-medium">Propuesta de IA</h4><p className="break-words font-medium">{proposal.subject}</p><p className="whitespace-pre-wrap break-words text-sm">{proposal.body}</p><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => { updateMessage(proposal); setMessageFeedback(`Cambios aplicados a ${label(messageIndex).toLowerCase()}.`); }}>Aplicar propuesta</Button><Button variant="ghost" disabled={busy} onClick={() => setProposal(null)}>Descartar</Button></div></div>}
        </div>
      </aside>
    </div>
    {!reviseMode && <div className="space-y-2"><Label htmlFor="provider">Enviar desde</Label><select id="provider" disabled={busy} className="min-h-11 w-full rounded-md border bg-background px-3 focus-visible:outline-ring sm:max-w-sm" value={definition.provider} onChange={event => onChange({ provider: event.target.value as 'google' | 'outlook' })}><option value="google">Mi cuenta de Gmail conectada</option><option value="outlook">Mi cuenta de Outlook conectada</option></select></div>}
    {(definition.overrides || []).length > 0 && <p className="text-sm text-muted-foreground">Cambiar la plantilla reemplazará las ediciones individuales. Podrás ajustarlas nuevamente en la revisión.</p>}
    {!canSave && <p className="text-sm text-muted-foreground">Elige la cantidad de seguimientos y completa el asunto, el texto y los días de espera de cada correo para continuar.</p>}
    <div className="flex justify-between gap-3"><Button variant="ghost" disabled={busy} onClick={onBack}>{reviseMode ? 'Cancelar edición' : 'Atrás'}</Button><Button disabled={busy || !canSave} onClick={onSave}>{busy && !job ? 'Preparando…' : reviseMode ? 'Guardar pendientes y volver a revisión' : 'Guardar y revisar correos'}</Button></div>
  </>;
}
