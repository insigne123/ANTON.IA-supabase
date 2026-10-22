'use client';
import { useState } from 'react';
import { Flag, Loader2, MessageSquareText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DECISION_LABELS, memberSteps, type DecisionType, type OpenDecision, type WorkState } from '@/lib/commercial-opportunities/member-work';
import { assignmentWhen } from '@/lib/commercial-opportunities/assignment-email';

const STATE_WORDS: Record<WorkState, string> = { unassigned: 'Sin asignar', assigned: 'Asignada', working: 'En gestión', blocked: 'Bloqueada', submitted: 'Presentada', won: 'Ganada', lost: 'Perdida', archived: 'Archivada' };

type Facts = { state: WorkState | null; assignedBy: string | null; nextActionAt: string | null; openTasks: number };
type StripProps = Facts & {
  /** Whoever is not an administrator moves the work along; an administrator does it from the pipeline. */
  canStep: boolean; busy: boolean;
  onStep: (to: WorkState, note?: string) => Promise<boolean>;
  onDecision: (type: DecisionType, text: string, dueAt: string | null) => Promise<boolean>;
};

/**
 * «Tu avance»: where the opportunity is, what is expected next and who assigned it, with the one step forward in front and the exits
 * (a block, a decision for the administrators) behind it. One strip under the title; the page keeps its single main action above.
 */
export function MemberStrip({ state, assignedBy, nextActionAt, openTasks, canStep, busy, onStep, onDecision }: StripProps) {
  const [dialog, setDialog] = useState<'block' | 'decision' | null>(null);
  const [text, setText] = useState(''); const [type, setType] = useState<DecisionType>('ask'); const [day, setDay] = useState('');
  const steps = canStep ? memberSteps(state) : [];
  const close = () => { setDialog(null); setText(''); setDay(''); setType('ask'); };
  const facts = [
    nextActionAt ? `Próxima acción: ${assignmentWhen(nextActionAt) || 'sin fecha'}` : null,
    assignedBy ? `Asignó: ${assignedBy}` : null,
    openTasks ? `${openTasks} ${openTasks === 1 ? 'tarea tuya pendiente' : 'tareas tuyas pendientes'}` : null,
  ].filter(Boolean);
  const submitBlock = async () => { if (await onStep('blocked', text.trim())) close(); };
  const submitDecision = async () => {
    const dueAt = day ? new Date(`${day}T12:00:00`).toISOString() : null;
    if (await onDecision(type, text.trim(), dueAt)) close();
  };
  return <section aria-label="Tu avance" className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border bg-muted/20 px-4 py-3">
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">Estado</p>
      <p className="text-sm font-medium">{STATE_WORDS[state ?? 'assigned']}</p>
    </div>
    {facts.length > 0 && <ul className="min-w-0 flex-1 space-y-0.5 text-xs text-muted-foreground">{facts.map(fact => <li key={String(fact)}>{fact}</li>)}</ul>}
    {canStep && <div className="ml-auto flex flex-wrap items-center gap-2">
      {steps.map(step => step.needsNote
        ? <Button key={step.to} size="sm" variant="ghost" disabled={busy} onClick={() => setDialog('block')}><Flag className="mr-2 h-4 w-4" aria-hidden="true" />{step.label}</Button>
        : <Button key={step.to} size="sm" variant={step.primary ? 'default' : 'ghost'} disabled={busy} onClick={() => void onStep(step.to)}>{step.label}</Button>)}
      {!['won', 'lost', 'archived'].includes(state ?? 'assigned') && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDialog('decision')}><MessageSquareText className="mr-2 h-4 w-4" aria-hidden="true" />Plantear una decisión</Button>}
    </div>}
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open && !busy) close(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{dialog === 'block' ? 'Reportar un bloqueo' : 'Plantear una decisión'}</DialogTitle>
          <DialogDescription>{dialog === 'block' ? 'Cuenta qué te frena. Se lo avisamos a los administradores y a quien está a cargo.' : 'Los administradores y quien está a cargo reciben tu mensaje y te responden aquí mismo.'}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void (dialog === 'block' ? submitBlock() : submitDecision()); }}>
          {dialog === 'decision' && <div role="group" aria-label="Qué planteas" className="flex flex-wrap gap-2">
            {(['ask', 'no_go'] as const).map(value => <Button key={value} type="button" size="sm" variant={type === value ? 'secondary' : 'outline'} aria-pressed={type === value} onClick={() => setType(value)}>
              {value === 'ask' ? 'Necesito una decisión' : 'Propongo no postular'}</Button>)}
          </div>}
          <div className="space-y-2">
            <Label htmlFor="member-note">{dialog === 'block' ? 'Qué te bloquea' : type === 'no_go' ? 'Por qué no postular' : 'Qué hay que decidir'}</Label>
            <Textarea id="member-note" value={text} onChange={event => setText(event.target.value)} maxLength={dialog === 'block' ? 500 : 1000} rows={4} autoFocus
              placeholder={dialog === 'block' ? 'Ej.: falta la boleta de garantía y el banco responde el lunes.' : type === 'no_go' ? 'Ej.: pide 24 meses de experiencia y no la podemos acreditar.' : 'Ej.: ¿quién firma la declaración jurada?'} />
          </div>
          {dialog === 'decision' && <div className="space-y-2">
            <Label htmlFor="member-day">Para cuándo (opcional)</Label>
            <Input id="member-day" type="date" value={day} onChange={event => setDay(event.target.value)} className="w-48" />
          </div>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={close}>Cancelar</Button>
            <Button type="submit" disabled={busy || text.trim().length < 3}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}{dialog === 'block' ? 'Reportar el bloqueo' : 'Enviar'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}

type CalloutProps = { decision: OpenDecision; who: string; admin: boolean; busy: boolean; onReply: (text: string) => Promise<boolean> };
/**
 * The decision waiting for an answer, for the whole team: who put it and what, and for administrators the box to answer it.
 * It goes away when an administrator answers.
 */
export function DecisionCallout({ decision, who, admin, busy, onReply }: CalloutProps) {
  const [text, setText] = useState('');
  const when = decision.dueAt ? assignmentWhen(decision.dueAt).replace(/,\s*\d{2}:\d{2}$/, '') : '';
  return <section aria-label="Decisión pendiente" className="space-y-3 rounded-xl bg-cw-warning-soft px-4 py-3">
    <div>
      <p className="text-xs font-medium text-muted-foreground">{DECISION_LABELS[decision.type]} · {who}{when ? ` · para el ${when}` : ''}</p>
      <p className="mt-1 text-sm leading-6">{decision.body.replace(/^[^:]+:\s*/, '')}</p>
    </div>
    {admin ? <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void onReply(text.trim()).then(done => { if (done) setText(''); }); }}>
      <div className="min-w-[14rem] flex-1 space-y-1"><Label htmlFor="decision-reply" className="text-xs">Tu respuesta</Label>
        <Input id="decision-reply" value={text} onChange={event => setText(event.target.value)} maxLength={1000} placeholder={decision.type === 'no_go' ? 'Ej.: postulemos igual / de acuerdo, no postulamos' : 'Ej.: firma Nicolás'} /></div>
      <Button type="submit" size="sm" disabled={busy || text.trim().length < 2}>Responder</Button>
    </form> : <p className="text-xs text-muted-foreground">Un administrador te responderá aquí mismo.</p>}
  </section>;
}
