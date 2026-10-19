'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Linkedin, Loader2, Mic, Phone, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { InitialsAvatar } from '@/components/initials-avatar';
import { authenticatedApiFetch } from '@/lib/authenticated-api-fetch';
import { cn } from '@/lib/utils';
import {
  DEFAULT_TOUCH_CADENCE, LINKEDIN_DAILY_CAP, RECORDING_EXTENSIONS, TOUCH_DAY_CHOICES, TOUCH_OUTCOMES, humanDue,
  type CallScript, type CallSummary, type LinkedinScript, type TouchCadence, type TouchChannel,
} from '@/lib/touches';

type Touch = {
  id: string; channel: TouchChannel; dueAt: string; day: number | null; manual: boolean;
  contact: { contactedId: string; name: string; role: string | null; company: string | null; email: string | null; phone: string | null; tel: string | null; linkedin: { href: string; search: boolean } };
  firstEmail: { subject: string | null; sentAt: string | null };
  script: CallScript | LinkedinScript | null;
  callSummary: CallSummary | null;
};
type TouchesResponse = { available: boolean; cadence: TouchCadence | null; touches: Touch[]; waiting: number; doneToday: number; writesToPeople: boolean; bridge: boolean };

const SHOWN = 5;
const INTEREST: Record<string, string> = { alto: 'Interés alto', medio: 'Interés medio', bajo: 'Interés bajo' };

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" aria-label={label}
    onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => undefined); }}>
    {done ? <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}{done ? 'Copiado' : 'Copiar'}
  </Button>;
}

/** The script of a call or a LinkedIn touch, with what to copy. */
function Script({ touch }: { touch: Touch }) {
  if (!touch.script) return null;
  if (touch.channel === 'call') {
    const script = touch.script as CallScript;
    return <div className="space-y-3 text-sm leading-6">
      <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Al contestar</p><p>{script.opening}</p></div>
      <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Para entender si le sirve</p>
        <ul className="list-disc space-y-1 pl-5">{script.questions.map(question => <li key={question}>{question}</li>)}</ul></div>
      <div><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Si no contesta</p><CopyButton text={script.voicemail} label="Copiar el mensaje de voz" /></div><p>{script.voicemail}</p></div>
    </div>;
  }
  const script = touch.script as LinkedinScript;
  return <div className="space-y-3 text-sm leading-6">
    <div><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Nota de la invitación · {script.invitation.length}/300</p><CopyButton text={script.invitation} label="Copiar la nota de la invitación" /></div><p>{script.invitation}</p></div>
    <div><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cuando acepte</p><CopyButton text={script.message} label="Copiar el mensaje" /></div><p>{script.message}</p></div>
  </div>;
}

/**
 * «Llamadas y LinkedIn» in «Hoy» (propuestas 15 y 19): the calls and LinkedIn touches due today for the people who did
 * not answer the first email, with a script the AI prepares on demand, «Hecho» with what happened and, for a call, its
 * recording turned into a summary for the CRM. Without a cadence it only invites to turn it on, once there are people
 * written to; with nothing due it is not shown.
 */
export function TouchesCard() {
  const { organizationId } = useAuth();
  const [data, setData] = useState<TouchesResponse | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [outcome, setOutcome] = useState<Record<string, { value: string; note: string }>>({});
  const [summaries, setSummaries] = useState<Record<string, { summary: CallSummary; crm: boolean }>>({});
  const [settings, setSettings] = useState(false);
  const [draft, setDraft] = useState<{ call: { on: boolean; day: number }; linkedin: { on: boolean; day: number }; phone: string }>({ ...DEFAULT_TOUCH_CADENCE, phone: '' });
  const [saving, setSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const recordingFor = useRef<string | null>(null);

  const call = useCallback((url: string, init?: RequestInit) => authenticatedApiFetch(url, {
    cache: 'no-store', ...init,
    headers: { ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(organizationId ? { 'x-organization-id': organizationId } : {}), ...(init?.headers || {}) },
  }), [organizationId]);
  const load = useCallback(async () => {
    if (!organizationId) return;
    try { const response = await call('/api/touches'); if (response.ok) setData(await response.json()); }
    catch { /* «Hoy» works without this card */ }
  }, [call, organizationId]);
  useEffect(() => { void load(); }, [load]);

  const openSettings = () => {
    const cadence = data?.cadence;
    setDraft({ call: cadence?.call ?? DEFAULT_TOUCH_CADENCE.call, linkedin: cadence?.linkedin ?? DEFAULT_TOUCH_CADENCE.linkedin, phone: cadence?.phone ?? '' });
    setSettingsError(''); setSettings(true);
  };
  const saveSettings = async () => {
    setSaving(true); setSettingsError('');
    try {
      const response = await call('/api/touches', { method: 'POST', body: JSON.stringify({ action: 'cadence', call: draft.call, linkedin: draft.linkedin, ...(data?.bridge ? { phone: draft.phone.trim() || null } : {}) }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'No pudimos guardar la cadencia.');
      setSettings(false); await load();
    } catch (e) { setSettingsError(e instanceof Error ? e.message : 'No pudimos guardar la cadencia.'); }
    finally { setSaving(false); }
  };
  const act = async (touch: Touch, body: Record<string, unknown>) => {
    setBusy(touch.id); setError(null);
    try {
      const response = await call(`/api/touches/${touch.id}`, { method: 'POST', body: JSON.stringify(body) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'No pudimos completar la acción.');
      return result;
    } catch (e) { setError({ id: touch.id, text: e instanceof Error ? e.message : 'No pudimos completar la acción.' }); return null; }
    finally { setBusy(null); }
  };
  const prepare = async (touch: Touch, fresh = false) => {
    setOpen(touch.id);
    if (touch.script && !fresh) return;
    const result = await act(touch, { action: 'script', ...(fresh ? { fresh: true } : {}) });
    if (result?.script) setData(current => current && ({ ...current, touches: current.touches.map(item => item.id === touch.id ? { ...item, script: result.script } : item) }));
  };
  const finish = async (touch: Touch, body: Record<string, unknown>) => {
    const result = await act(touch, body);
    if (result) { setOpen(null); await load(); }
  };
  const upload = async (touchId: string, file: File) => {
    const touch = data?.touches.find(item => item.id === touchId);
    if (!touch) return;
    if (!RECORDING_EXTENSIONS.test(file.name) && !file.type.startsWith('audio/')) { setError({ id: touchId, text: 'Sube un audio: mp3, m4a, wav, webm u ogg.' }); return; }
    if (file.size > 25 * 1024 * 1024) { setError({ id: touchId, text: 'La grabación supera 25 MB. Grábala en calidad de nota de voz (m4a).' }); return; }
    setBusy(touchId); setError(null);
    try {
      // The length of the call, read in the browser: the transcription does not say it.
      const duration = await new Promise<number>(resolve => {
        const audio = document.createElement('audio'); const url = URL.createObjectURL(file);
        audio.preload = 'metadata'; audio.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Number.isFinite(audio.duration) ? audio.duration : 0); };
        audio.onerror = () => { URL.revokeObjectURL(url); resolve(0); }; audio.src = url;
      });
      const form = new FormData(); form.append('file', file); if (duration) form.append('duration', String(Math.round(duration)));
      const note = outcome[touchId]?.note?.trim(); if (note) form.append('note', note);
      const response = await call(`/api/touches/${touchId}/recording`, { method: 'POST', body: form });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'No pudimos resumir la llamada.');
      // The call is done with its summary: it leaves the list and its summary stays on top until the next visit.
      setSummaries(current => ({ ...current, [touchId]: { summary: result.summary, crm: Boolean(result.crm) } }));
      setOpen(null); await load();
    } catch (e) { setError({ id: touchId, text: e instanceof Error ? e.message : 'No pudimos resumir la llamada.' }); }
    finally { setBusy(null); }
  };

  if (!data?.available) return null;
  const invite = !data.cadence && data.writesToPeople;
  const done = Object.keys(summaries);
  if (!invite && !data.touches.length && !done.length) return renderSettings();
  const visible = expanded ? data.touches : data.touches.slice(0, SHOWN);

  function renderSettings() {
    return <Sheet open={settings} onOpenChange={value => { if (!saving) setSettings(value); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader><SheetTitle>Llamadas y LinkedIn</SheetTitle>
          <SheetDescription>Cuándo te recordamos llamar o conectar por LinkedIn con quien no respondió tu primer correo. Si responde, lo pendiente se cancela solo.</SheetDescription></SheetHeader>
        <div className="mt-6 space-y-6">
          {(['call', 'linkedin'] as const).map(channel => <div key={channel} className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor={`touch-${channel}`} className="text-sm font-medium">{channel === 'call' ? 'Llamar si no responde' : 'Conectar por LinkedIn'}</Label>
              <Switch id={`touch-${channel}`} checked={draft[channel].on} onCheckedChange={value => setDraft(current => ({ ...current, [channel]: { ...current[channel], on: value } }))} />
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <label htmlFor={`touch-${channel}-day`}>El día</label>
              <select id={`touch-${channel}-day`} value={draft[channel].day} disabled={!draft[channel].on}
                onChange={event => setDraft(current => ({ ...current, [channel]: { ...current[channel], day: Number(event.target.value) } }))}
                className="h-9 rounded-md border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                {TOUCH_DAY_CHOICES.map(day => <option key={day} value={day}>{day}</option>)}
              </select>
              <span>después del primer correo</span>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{channel === 'call' ? 'Solo a quienes tienen teléfono. Te preparamos qué decir y el mensaje si no contesta.' : `Hasta ${LINKEDIN_DAILY_CAP} al día, para cuidar tu cuenta. Te preparamos la nota de la invitación.`}</p>
          </div>)}
          {data?.bridge ? <div className="space-y-2">
            <Label htmlFor="touch-phone">Tu teléfono, para llamar con ANTON.IA</Label>
            <Input id="touch-phone" inputMode="tel" placeholder="+56 9 1234 5678" value={draft.phone} onChange={event => setDraft(current => ({ ...current, phone: event.target.value }))} />
            <p className="text-xs leading-5 text-muted-foreground">Te llamamos a ti primero y luego conectamos con tu contacto. La llamada se graba y se resume para el CRM.</p>
          </div> : null}
          <p className="rounded-xl bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">Se aplica a quienes escribas desde que lo actives. Cambiar los días no cambia a quiénes se aplica.</p>
          {settingsError ? <p role="alert" className="text-sm text-destructive">{settingsError}</p> : null}
        </div>
        <SheetFooter className="mt-6"><Button onClick={() => void saveSettings()} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}Guardar</Button></SheetFooter>
      </SheetContent>
    </Sheet>;
  }

  if (invite) {
    return <>
      <Card className="rounded-2xl">
        <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Phone className="h-4 w-4" aria-hidden="true" /></span>
            <div><p className="text-sm font-medium">Suma una llamada y LinkedIn a tus seguimientos</p>
              <p className="text-xs leading-5 text-muted-foreground">Quien no responde un correo a veces contesta el teléfono. Te recordamos el día y te preparamos qué decir.</p></div>
          </div>
          <Button variant="outline" size="sm" onClick={openSettings}>Activar</Button>
        </CardContent>
      </Card>
      {renderSettings()}
    </>;
  }

  return <>
    <Card className="rounded-2xl" aria-labelledby="touches-title">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="space-y-1">
          <CardTitle id="touches-title" className="text-base">Llamadas y LinkedIn</CardTitle>
          <CardDescription>{data.touches.length ? `${data.touches.length} para hoy de quienes no respondieron tu correo.` : 'Listo por hoy.'}{data.waiting ? ` ${data.waiting} de LinkedIn quedan para mañana, por el límite diario.` : ''}</CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={openSettings} aria-label="Ajustar llamadas y LinkedIn"><Settings2 className="mr-1.5 h-4 w-4" aria-hidden="true" />Ajustar</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        <input ref={fileInput} type="file" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg" className="sr-only" tabIndex={-1} aria-hidden="true"
          onChange={event => { const file = event.target.files?.[0]; const id = recordingFor.current; event.target.value = ''; if (file && id) void upload(id, file); }} />
        {done.filter(id => !data.touches.some(touch => touch.id === id)).map(id => {
          const { summary, crm } = summaries[id];
          const next = summary.nextSteps[0];
          return <div key={id} role="status" className="space-y-1 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
            <p className="font-medium">{crm ? 'Resumen de la llamada guardado en el CRM' : 'Resumen de la llamada guardado'} · {INTEREST[summary.interest]}</p>
            <p className="leading-6">{summary.summary}</p>
            {next ? <p className="text-xs text-muted-foreground">Próximo paso: {next.text.replace(/[\s.]+$/, '')}{next.due ? ` (${humanDue(next.due)})` : ''}</p> : null}
          </div>;
        })}
        <ul className="space-y-2">
          {visible.map(touch => {
            const isOpen = open === touch.id;
            const pending = busy === touch.id;
            const summary = summaries[touch.id]?.summary ?? touch.callSummary;
            const chosen = outcome[touch.id]?.value ?? '';
            return <li key={touch.id} className={cn('rounded-xl border border-border/60 p-3 transition-colors', isOpen && 'border-primary/40 bg-primary/[0.03]')}>
              {/* The actions go under the text, so the name, the role and the email it follows are read whole in the narrow column. */}
              <div className="flex items-start gap-3">
                <InitialsAvatar name={touch.contact.name} size="sm" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">{touch.contact.name}
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                        {touch.channel === 'call' ? <Phone className="h-3 w-3" aria-hidden="true" /> : <Linkedin className="h-3 w-3" aria-hidden="true" />}
                        {touch.channel === 'call' ? 'Llamar' : 'LinkedIn'}{touch.day ? ` · día ${touch.day}` : ''}</span></p>
                    <p className="break-words text-xs leading-5 text-muted-foreground">{[touch.contact.role, touch.contact.company].filter(Boolean).join(' · ') || touch.contact.email}</p>
                    {touch.firstEmail.subject ? <p className="truncate text-xs leading-5 text-muted-foreground" title={touch.firstEmail.subject}>Tu correo: «{touch.firstEmail.subject}»</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {touch.channel === 'call' && touch.contact.tel
                      ? <Button asChild size="sm"><a href={touch.contact.tel}><Phone className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{touch.contact.phone}</a></Button>
                      : touch.channel === 'linkedin'
                        ? <Button asChild size="sm" variant="outline"><a href={touch.contact.linkedin.href} target="_blank" rel="noopener noreferrer">{touch.contact.linkedin.search ? 'Buscar en LinkedIn' : 'Abrir perfil'}<ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">(abre LinkedIn)</span></a></Button>
                        : null}
                    <Button size="sm" variant="ghost" aria-expanded={isOpen} onClick={() => isOpen ? setOpen(null) : void prepare(touch)} disabled={pending && !isOpen}>
                      {pending && !touch.script ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}{isOpen ? 'Cerrar' : 'Guion y resultado'}
                    </Button>
                  </div>
                </div>
              </div>
              {error?.id === touch.id ? <p role="alert" className="mt-2 text-sm text-destructive">{error.text}</p> : null}
              {isOpen ? <div className="mt-3 space-y-4 border-t pt-3">
                {touch.script ? <Script touch={touch} /> : pending ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Preparando qué decir…</p> : null}
                {touch.script ? <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={pending} onClick={() => void prepare(touch, true)}><RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Otra versión</Button> : null}
                {summary ? <div className="space-y-1 rounded-xl bg-muted/50 p-3 text-sm"><p className="font-medium">Resumen de la llamada · {INTEREST[summary.interest]}</p><p className="leading-6">{summary.summary}</p>
                  {summary.nextSteps[0] ? <p className="text-xs text-muted-foreground">Próximo paso: {summary.nextSteps[0].text.replace(/[\s.]+$/, '')}{summary.nextSteps[0].due ? ` (${humanDue(summary.nextSteps[0].due)})` : ''}</p> : null}</div> : null}
                <fieldset className="space-y-2">
                  <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">¿Qué pasó?</legend>
                  <div className="flex flex-wrap gap-2">{TOUCH_OUTCOMES[touch.channel].map(([value, label]) =>
                    <button key={value} type="button" aria-pressed={chosen === value} onClick={() => setOutcome(current => ({ ...current, [touch.id]: { value, note: current[touch.id]?.note ?? '' } }))}
                      className={cn('rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', chosen === value ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>{label}</button>)}</div>
                  <Textarea aria-label="Nota" rows={2} maxLength={2000} placeholder="Nota opcional: qué dijo, cuándo volver a llamar…" value={outcome[touch.id]?.note ?? ''}
                    onChange={event => setOutcome(current => ({ ...current, [touch.id]: { value: current[touch.id]?.value ?? '', note: event.target.value } }))} />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" disabled={!chosen || pending} onClick={() => void finish(touch, { action: 'done', outcome: chosen, ...(outcome[touch.id]?.note?.trim() ? { note: outcome[touch.id].note.trim() } : {}) })}>Guardar</Button>
                    {touch.channel === 'call' && chosen === 'talked' && !summary ? <Button size="sm" variant="outline" disabled={pending}
                      onClick={() => { recordingFor.current = touch.id; fileInput.current?.click(); }}>{pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Mic className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}Subir grabación</Button> : null}
                    <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={pending} onClick={() => void finish(touch, { action: 'skip' })}>Saltar</Button>
                  </div>
                  {touch.channel === 'call' && chosen === 'talked' && !summary ? <p className="text-xs leading-5 text-muted-foreground">Con la grabación te dejamos el resumen, los acuerdos y el próximo paso en el CRM. Pide permiso para grabar al empezar la llamada; el audio no se guarda.</p> : null}
                </fieldset>
              </div> : null}
            </li>;
          })}
        </ul>
        {data.touches.length > SHOWN ? <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Ver menos' : `Ver ${data.touches.length - SHOWN} más`}</Button> : null}
      </CardContent>
    </Card>
    {renderSettings()}
  </>;
}
