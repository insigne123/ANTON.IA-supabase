'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PlannedTouch } from '@/lib/contacted-conversations';
import type { ConversationAdvice } from '@/lib/conversation-advice';

export function ConversationWork({ contactedId, initial, plans, onChange }: { contactedId: string; initial: any; plans: PlannedTouch[]; onChange: () => void }) {
  const [work, setWork] = useState(initial || {});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('reminder');
  const [due, setDue] = useState('');
  const [planOverrides, setPlanOverrides] = useState<Record<string, boolean>>({});
  async function act(body: Record<string, unknown>) {
    setBusy(true); setFeedback('');
    try {
      const response = await fetch(`/api/contacted/${encodeURIComponent(contactedId)}/work`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo guardar.');
      if (body.action === 'analyze') setWork((w: any) => ({ ...w, advice: result.value }));
      if (body.action === 'commitment' || body.action === 'complete') setWork((w: any) => ({ ...w, commitment: result.value }));
      if (body.action === 'automation') setPlanOverrides(w => ({ ...w, [String(body.campaignId)]: body.enabled === true }));
      setFeedback('Guardado.'); onChange();
    } catch (error) { setFeedback((error as Error).message); }
    finally { setBusy(false); }
  }
  const advice = work.advice as ConversationAdvice | undefined;
  return <section className="space-y-4 border-t pt-4">
    <h2 className="font-semibold">Siguiente acción</h2>
    {advice && <div className="space-y-1"><h3 className="font-medium">{advice.title}</h3><p className="text-sm text-muted-foreground">{advice.reason}</p><p className="text-xs text-muted-foreground">Recomendación basada en la respuesta. No activa envíos ni confirma reuniones.</p></div>}
    <Button variant="outline" disabled={busy} onClick={() => void act({ action: 'analyze' })}>Analizar respuesta con IA</Button>
    {work.commitment && <div className="rounded-xl border p-3"><p className="font-medium">{work.commitment.title}</p><p className="text-sm text-muted-foreground">{new Date(work.commitment.dueAt).toLocaleString('es-CL')} · {work.commitment.completedAt ? 'Realizado' : 'Pendiente'}</p>{!work.commitment.completedAt && <Button variant="outline" disabled={busy} onClick={() => void act({ action: 'complete', id: work.commitment.id })}>Marcar realizado</Button>}</div>}
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (due) void act({ action: 'commitment', kind, title, dueAt: new Date(due).toISOString() }); }}>
      <div><Label htmlFor="commitment-kind">Próximo compromiso</Label><select id="commitment-kind" value={kind} onChange={e => setKind(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3"><option value="reminder">Recordatorio</option><option value="call">Llamada</option><option value="meeting">Reunión confirmada</option></select></div>
      <div><Label htmlFor="commitment-title">Qué harás</Label><Input id="commitment-title" required maxLength={300} value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div><Label htmlFor="commitment-date">Fecha y hora local</Label><Input id="commitment-date" type="datetime-local" required value={due} onChange={e => setDue(e.target.value)} /></div>
      <p className="text-xs text-muted-foreground">El responsable es el titular de esta conversación. Registrar una reunión no envía una invitación de calendario.</p>
      <Button type="submit" disabled={busy}>Guardar compromiso</Button>
    </form>
    {plans.filter(p => p.kind === 'first_contact' && p.enrollmentState === 'active').map((p, index, all) => <div key={p.id} className="space-y-2 border-t pt-3">
      <p className="text-sm font-medium">Seguimiento {p.index + 1}</p>
      {index === all.findIndex(other => other.campaignId === p.campaignId) && <Button variant="outline" disabled={busy} onClick={() => void act({ action: 'automation', campaignId: p.campaignId, enabled: !(planOverrides[p.campaignId] ?? p.autoSend) })}>{(planOverrides[p.campaignId] ?? p.autoSend) ? 'Pausar envío automático' : 'Activar envío automático'}</Button>}
      {!['sent','sending','unknown','dispatch_pending','blocked','skipped'].includes(p.state) && <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); const date = new FormData(e.currentTarget).get('date'); if (date) void act({ action: 'reschedule', stepId: p.id, dueAt: new Date(String(date)).toISOString() }); }}><Label htmlFor={`due-${p.id}`} className="w-full">Nueva fecha del seguimiento</Label><Input id={`due-${p.id}`} name="date" type="datetime-local" required /><Button variant="outline" disabled={busy}>Reprogramar</Button></form>}
    </div>)}
    <p role="status" className="text-sm text-muted-foreground">{busy ? 'Guardando…' : feedback}</p>
  </section>;
}
