'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { PageHeader } from '@/components/page-header';
import { ConversationWork } from './ConversationWork';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { activeTouch, conversationStatus, groupConversations, needsReply, type ConversationRow, type ConversationView, type PlannedTouch } from '@/lib/contacted-conversations';
import { openSentMessageFor } from '@/lib/open-sent-message';
import type { ContactedLead } from '@/lib/types';

type Message = { id: string; direction: string; from?: string; to?: string[]; receivedAt: string; subject?: string; text?: string; source: string };
type Detail = { work?: any; messages: Message[]; plans: { touches: PlannedTouch[]; complete: boolean }; providerComplete: boolean; providerError: string | null; trackingAvailable: boolean; trackingEvents: Array<{ id: string; event_type: string; event_at: string; meta?: Record<string, unknown> }>; canResolve: boolean };
const views: [ConversationView, string][] = [['reply', 'Por responder'], ['waiting', 'Esperando respuesta'], ['scheduled', 'Programados'], ['all', 'Todos']];
const recoveryKey = (row: ConversationRow) => `anton.reply:${row.organization_id}:${row.user_id}:${row.id}`;
function date(value?: string | null) { return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Fecha por definir'; }
const stepLabels: Record<string, string> = { not_due: 'Pendiente', ready_to_prepare: 'Por preparar', drafting: 'Preparando', review_required: 'Por revisar', approved: 'Aprobado', dispatch_pending: 'En cola', sending: 'Enviando', sent: 'Enviado', deferred: 'Pospuesto', failed: 'Fallido', unknown: 'Por confirmar', skipped: 'Omitido', blocked: 'Bloqueado', paused: 'Campaña pausada', pending_initial_send: 'Espera el primer envío' };
const crmStageLabels: Record<string, string> = { new: 'Nuevo', contacted: 'Contactado', engaged: 'Interesado', meeting: 'Solicitud de reunión', qualified: 'Calificado', opportunity: 'Oportunidad', customer: 'Cliente', lost: 'Cerrado sin avance' };

async function json(response: Response) { const data = await response.json(); if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Tu sesión o tus permisos cambiaron. Vuelve a ingresar.' : 'No pudimos completar la consulta. Intenta nuevamente.'); return data; }

export default function ConversationsWorkspace({ initialView = 'reply' }: { initialView?: ConversationView }) {
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [touches, setTouches] = useState<PlannedTouch[]>([]);
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [coverage, setCoverage] = useState(true);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [view, setView] = useState(initialView);
  const [query, setQuery] = useState('');
  const [mine, setMine] = useState(false);
  const [provider, setProvider] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [selected, setSelected] = useState<ConversationRow | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stopTarget, setStopTarget] = useState<PlannedTouch | null>(null);
  const [stopping, setStopping] = useState(false);
  const [draftingReply, setDraftingReply] = useState(false);
  const [replyEditorOpen, setReplyEditorOpen] = useState(false);
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [replyIdempotencyKey, setReplyIdempotencyKey] = useState('');
  const [replyStatus, setReplyStatus] = useState('');
  const [trackReplyActivity, setTrackReplyActivity] = useState(false);
  const observedAt = useRef('');
  const request = useRef(0);
  const opener = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async (offset = 0) => {
    setLoading(true); setError('');
    try {
      const data = await json(await fetch(`/api/contacted/conversations?offset=${offset}`, { cache: 'no-store' }));
      setRows(previous => offset ? [...previous, ...data.rows] : data.rows);
      setTouches(previous => [...new Map((offset ? [...previous, ...data.plans.touches] : data.plans.touches).map((t: PlannedTouch) => [t.id, t])).values()] as PlannedTouch[]);
      setCoverage(previous => offset ? previous && data.plans.complete && data.coverageComplete : data.plans.complete && data.coverageComplete);
      setNextOffset(data.nextOffset); setUserId(data.userId);
    } catch (e) { setError((e as Error).message); setRows([]); setTouches([]); setSelected(null); setDetail(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const sync = useCallback(async () => {
    setSyncing(true); setSyncStatus('Consultando tus cuentas de correo…');
    try {
      let cursor: string | null = null;
      let found = 0; let issues = 0;
      for (let page = 0; page < 20; page++) {
        const data = await json(await fetch('/api/replies/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 50, cursor }) }));
        found += data.synced; issues += data.skippedNoToken + data.errors.length; cursor = data.nextCursor;
        if (!cursor) break;
      }
      setSyncStatus(cursor ? 'Actualización parcial. Quedan contactos por consultar.' : issues ? `Actualización parcial: ${issues} consultas requieren revisar la conexión. ${found} respuestas nuevas.` : `Tus cuentas actualizadas a las ${new Date().toLocaleTimeString('es-CL')}. ${found} respuestas nuevas.`);
      await load();
    } catch (e) { setSyncStatus((e as Error).message); }
    finally { setSyncing(false); }
  }, [load]);

  const open = useCallback(async (row: ConversationRow) => {
    const version = ++request.current;
    setSelected(row); setDetail(null); setDetailError(''); setDetailLoading(true); observedAt.current = new Date().toISOString();
    setDraftingReply(false); setReplyEditorOpen(false); setReplyError(''); setReplyStatus(''); setReplySubject(''); setReplyBody(''); setReplyIdempotencyKey(''); setTrackReplyActivity(false);
    try {
      const data = await json(await fetch(`/api/contacted/${encodeURIComponent(row.id)}/conversation`, { cache: 'no-store' }));
      if (version === request.current) {
        setDetail(data);
        const durable = data.work?.replyDraft;
        const saved = durable?.pending ? JSON.stringify(durable) : sessionStorage.getItem(recoveryKey(row));
        if (saved) {
          const pending = JSON.parse(saved);
          setReplySubject(pending.subject); setReplyBody(pending.body); setReplyIdempotencyKey(pending.key);
          setTrackReplyActivity(pending.tracking === true); setReplyEditorOpen(true);
          setReplyStatus('Comprueba el envío anterior antes de preparar otra respuesta.');
        }
      }
    } catch (e) { if (version === request.current) setDetailError((e as Error).message); }
    finally { if (version === request.current) setDetailLoading(false); }
  }, []);

  const groups = useMemo(() => groupConversations(rows), [rows]);
  const plansFor = useCallback((row: ConversationRow) => touches.filter(t => t.email.toLowerCase() === row.email?.toLowerCase() && t.ownerId === row.user_id && activeTouch(t)), [touches]);
  const visible = groups.filter(({ row }) => {
    if (mine && row.user_id !== userId) return false;
    if (provider !== 'all' && row.provider !== provider) return false;
    if (query && ![row.name, row.email, row.company, row.subject].join(' ').toLowerCase().includes(query.toLowerCase())) return false;
    if (view === 'reply') return needsReply(row);
    if (view === 'waiting') return conversationStatus(row) === 'Esperando respuesta';
    if (view === 'scheduled') return plansFor(row).length > 0 || row.status === 'scheduled';
    return true;
  });

  async function resolve() {
    if (!selected) return;
    setSaving(true); setDetailError('');
    try {
      await json(await fetch(`/api/contacted/${encodeURIComponent(selected.id)}/conversation`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolved: !selected.conversation_resolved_at, observedAt: observedAt.current }) }));
      setSelected(null); setDetail(null); await load();
    } catch (e) { setDetailError((e as Error).message); }
    finally { setSaving(false); }
  }

  async function stopFollowups() {
    if (!stopTarget) return;
    setStopping(true);
    try {
      await json(await fetch(`/api/campaigns/v2/${encodeURIComponent(stopTarget.campaignId)}/enrollments/${encodeURIComponent(stopTarget.enrollmentId)}/stop`, { method: 'POST' }));
      setStopTarget(null);
      await load();
      if (selected) await open(selected);
    } catch (e) { setDetailError((e as Error).message); }
    finally { setStopping(false); }
  }

  async function prepareReply() {
    if (!selected || !detail) return;
    const version = request.current;
    if (sessionStorage.getItem(recoveryKey(selected))) { await open(selected); return; }
    setDraftingReply(true); setReplyError(''); setReplyStatus('');
    try {
      const inbound = detail.messages.filter(message => message.direction === 'inbound').at(-1);
      const response = await fetch('/api/antonia/replies/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactedId: selected.id, rawReply: inbound?.text || selected.last_reply_text, replySubject: inbound?.subject || selected.reply_subject }) });
      const data = await response.json();
      if (version !== request.current) return;
      if (!response.ok || !data.draft) throw new Error(data.message || 'No pudimos preparar una sugerencia. Puedes escribir la respuesta manualmente.');
      setReplySubject(`Re: ${(selected.subject || '').replace(/^(?:re:\s*)+/i, '')}`);
      setReplyBody(data.draft.bodyText || '');
      setReplyIdempotencyKey(crypto.randomUUID());
      setReplyEditorOpen(true);
    } catch (e) { if (version !== request.current) return; setReplyError((e as Error).message); setReplySubject(`Re: ${(selected.subject || '').replace(/^(?:re:\s*)+/i, '')}`); setReplyBody(''); setReplyIdempotencyKey(crypto.randomUUID()); setReplyEditorOpen(true); }
    finally { if (version === request.current) setDraftingReply(false); }
  }

  async function sendReply() {
    if (!selected || !replyBody.trim() || !replySubject.trim() || !detail?.canResolve) return;
    const key = replyIdempotencyKey || crypto.randomUUID();
    setReplyIdempotencyKey(key); setReplyBusy(true); setReplyError(''); setReplyStatus('Enviando respuesta en el hilo original…');
    try {
      sessionStorage.setItem(recoveryKey(selected), JSON.stringify({ key, subject: replySubject, body: replyBody, tracking: trackReplyActivity }));
      await json(await fetch(`/api/contacted/${encodeURIComponent(selected.id)}/work`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'replyDraft', key, subject: replySubject, body: replyBody, tracking: trackReplyActivity, pending: true }) }));
      const response = await fetch('/api/providers/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: selected.provider, organizationId: selected.organization_id, to: selected.email, subject: replySubject, htmlBody: replyBody, textBody: replyBody, idempotencyKey: key, contactedId: selected.id, deliveryMode: 'reply_contact', tracking: { open: trackReplyActivity, clicks: trackReplyActivity } }) });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.success && data?.status === 'sent') {
        await fetch(`/api/contacted/${encodeURIComponent(selected.id)}/work`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'replyDraft', key, subject: replySubject, body: replyBody, tracking: trackReplyActivity, pending: false }) });
        sessionStorage.removeItem(recoveryKey(selected));
        const updated = { ...selected, conversation_outbound_at: new Date().toISOString() };
        setReplyStatus('Respuesta enviada y registrada en esta conversación.'); setDraftingReply(false); setReplyEditorOpen(false);
        setSelected(updated); await load(); await open(updated);
        return;
      }
      if (['pending', 'sending', 'unknown'].includes(String(data?.status || ''))) {
        setReplyStatus('El envío aún no está confirmado. Comprueba de nuevo con el mismo identificador; no generaremos un segundo envío.');
        setReplyError('');
        return;
      }
      setReplyError(data?.message || data?.error || 'No se confirmó el envío. Revisa el estado antes de intentar otra vez.');
      if (data?.status === 'failed' || [400, 403, 409, 422].includes(response.status)) {
        await fetch(`/api/contacted/${encodeURIComponent(selected.id)}/work`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'replyDraft', key, subject: replySubject, body: replyBody, tracking: trackReplyActivity, pending: false }) });
        sessionStorage.removeItem(recoveryKey(selected)); setReplyIdempotencyKey(''); setReplyStatus('');
      } else setReplyStatus('Conservamos la clave del envío. Comprueba su estado antes de continuar.');
    } catch (e) { setReplyError((e as Error).message); setReplyStatus('No se pudo confirmar el envío. Conservamos su clave para comprobarlo.'); }
    finally { setReplyBusy(false); }
  }

  return <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
    <PageHeader title="Contactados" description="Cada conversación, su estado y el próximo paso." />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="Ver conversaciones" className="flex flex-wrap gap-1">{views.map(([key, label]) => <Button key={key} variant={view === key ? 'default' : 'ghost'} aria-pressed={view === key} onClick={() => setView(key)}>{label}</Button>)}</div>
      <Button variant="outline" disabled={syncing} onClick={() => void sync()}>{syncing ? 'Actualizando…' : 'Actualizar mis respuestas'}</Button>
    </div>
    <p role="status" className="text-sm text-muted-foreground">{syncStatus || 'La revisión automática continúa en segundo plano. La actualización manual consulta tus cuentas; el equipo depende de la conexión de cada titular.'}</p>
    <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
      <div><Label htmlFor="conversation-search">Buscar contacto o empresa</Label><Input id="conversation-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Nombre, correo, empresa o asunto" /></div>
      <div><Label htmlFor="conversation-provider">Canal</Label><select id="conversation-provider" value={provider} onChange={e => setProvider(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="all">Todos</option><option value="gmail">Gmail</option><option value="outlook">Outlook</option><option value="linkedin">LinkedIn</option><option value="phone">Teléfono</option></select></div>
      <label className="flex min-h-10 items-center gap-2 self-end text-sm"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} className="h-4 w-4 accent-primary" />Solo mis conversaciones</label>
    </div>
    {error && <div role="alert" className="rounded-xl border p-4">{error} <Button variant="outline" onClick={() => void load()}>Reintentar</Button></div>}
    {(!coverage || nextOffset !== null) && <p className="text-sm text-muted-foreground">Vista parcial: los filtros se aplican a los contactos cargados. {!coverage && 'No pudimos comprobar todos los seguimientos.'}</p>}
    <section aria-label="Conversaciones" aria-busy={loading} className="overflow-hidden rounded-2xl border bg-card">
      {loading && !rows.length ? <p role="status" className="p-8 text-muted-foreground">Cargando conversaciones…</p> : !visible.length ? <div className="space-y-3 p-8"><h2 className="font-semibold">{error ? 'Historial no disponible' : 'No hay conversaciones en esta vista'}</h2><p className="text-sm text-muted-foreground">{view === 'reply' ? 'Las nuevas respuestas que necesiten atención aparecerán aquí.' : 'Prueba otra vista o cambia los filtros.'}</p><Button variant="outline" onClick={() => { setView('all'); setQuery(''); setMine(false); setProvider('all'); }}>Ver todos</Button></div> : visible.map(({ row, history }) => {
        const next = plansFor(row).sort((a, b) => (Date.parse(a.dueAt || '') || Infinity) - (Date.parse(b.dueAt || '') || Infinity))[0];
        return <button key={row.id} onClick={e => { opener.current = e.currentTarget; void open(row); }} className="grid w-full gap-3 border-b p-4 text-left transition-colors last:border-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <span className="min-w-0"><span className="block truncate font-medium">{row.name || row.email}</span><span className="block truncate text-sm text-muted-foreground">{row.company || row.email}</span><span className="text-xs text-muted-foreground">{crmStageLabels[row.crm_stage || ''] || row.crm_stage || 'Sin fase comercial'} · {row.provider} · {row.user_id === userId ? 'Mi cuenta' : 'Cuenta del equipo'}</span></span>
          <span className="min-w-0"><span className="block text-sm font-medium">{conversationStatus(row)}</span><span className="block truncate text-sm text-muted-foreground">{row.reply_preview || row.subject || 'Contacto registrado'}</span><span className="text-xs text-muted-foreground">{next ? `Seguimiento ${next.index + 1} · ${date(next.dueAt)}` : row.status === 'scheduled' ? date(row.scheduled_at) : `${history.length} registro${history.length === 1 ? '' : 's'}`}</span></span>
          <span className="text-xs text-muted-foreground">{date(row.replied_at || row.sent_at)}</span>
        </button>;
      })}
    </section>
    {nextOffset !== null && <Button variant="outline" disabled={loading} onClick={() => void load(nextOffset)}>Cargar más conversaciones</Button>}
    <Sheet open={Boolean(selected)} onOpenChange={value => { if (!value && !replyBusy) { request.current++; setSelected(null); setDetail(null); } }}>
      <SheetContent onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus(); }} className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader><SheetTitle>{selected?.name || selected?.email}</SheetTitle><SheetDescription>{selected?.company} · {selected?.email}</SheetDescription></SheetHeader>
        {selected && <div className="mt-6 space-y-6">
          <div><p className="font-medium">{conversationStatus(selected)}</p><p className="mt-1 text-sm text-muted-foreground">Fase comercial: {crmStageLabels[selected.crm_stage || ''] || selected.crm_stage || 'Sin fase registrada'}</p><p className="mt-1 text-sm text-muted-foreground">{selected.reply_sync_error ? 'Actualización pendiente: revisa la conexión.' : selected.reply_sync_succeeded_at ? `Última revisión: ${date(selected.reply_sync_succeeded_at)}` : 'Sin revisión automática confirmada'}</p></div>
          <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void openSentMessageFor({ id: selected.id, provider: selected.provider, messageId: selected.message_id, threadId: selected.thread_id, conversationId: selected.conversation_id, internetMessageId: selected.internet_message_id, email: selected.email } as ContactedLead).catch(() => setDetailError('No pudimos abrir el correo original.'))}>Abrir en correo</Button>{detail?.canResolve && <Button disabled={saving} onClick={() => void resolve()}>{saving ? 'Guardando…' : selected.conversation_resolved_at ? 'Volver a pendiente' : 'Marcar resuelto'}</Button>}</div>
          <p className="text-xs text-muted-foreground">Resolver conserva el historial y no modifica los envíos programados.</p>
          {needsReply(selected) && detail?.canResolve && ['gmail', 'outlook'].includes(selected.provider) && <section className="space-y-3 rounded-2xl border bg-muted/20 p-4"><div><h2 className="font-semibold">Responder a {selected.name || selected.email}</h2><p className="text-sm text-muted-foreground">La respuesta se enviará en el hilo original. Revisa el texto antes de enviarlo.</p></div>{!replyEditorOpen && <Button variant="outline" disabled={draftingReply || detailLoading} onClick={() => void prepareReply()}>{draftingReply ? 'Preparando…' : 'Preparar sugerencia'}</Button>}{replyEditorOpen && <div className="space-y-3"><div><Label htmlFor="reply-subject">Asunto</Label><Input id="reply-subject" value={replySubject} onChange={event => { setReplySubject(event.target.value); if (!replyBusy) setReplyIdempotencyKey(crypto.randomUUID()); }} disabled={replyBusy || Boolean(replyStatus)} /></div><div><Label htmlFor="reply-body">Tu respuesta</Label><textarea id="reply-body" value={replyBody} onChange={event => { setReplyBody(event.target.value); if (!replyBusy) setReplyIdempotencyKey(crypto.randomUUID()); }} rows={7} maxLength={12000} disabled={replyBusy || Boolean(replyStatus)} className="flex w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60" /></div><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={trackReplyActivity} onChange={event => setTrackReplyActivity(event.target.checked)} disabled={replyBusy || Boolean(replyStatus)} /><span>Registrar señales de apertura y clic <span className="block text-xs text-muted-foreground">Opcional; una apertura no demuestra que la persona haya leído el correo.</span></span></label><p className="text-xs text-muted-foreground">El correo incluirá la opción de dejar de recibir mensajes comerciales.</p><div className="flex flex-wrap gap-2"><Button disabled={replyBusy || !replyBody.trim() || !replySubject.trim()} onClick={() => void sendReply()}>{replyBusy ? 'Enviando…' : replyStatus ? 'Comprobar estado' : 'Enviar respuesta'}</Button><Button variant="ghost" disabled={replyBusy} onClick={() => { setReplyEditorOpen(false); setReplyBody(''); setReplyStatus(''); setReplyIdempotencyKey(''); }}>Cancelar</Button></div></div>}{replyError && <p role="alert" className="text-sm text-destructive">{replyError}</p>}{replyStatus && <p role="status" className="text-sm text-muted-foreground">{replyStatus}</p>}</section>}
          {detailError && <div role="alert" className="space-y-2 rounded-xl border p-3"><p>{detailError}</p><Button variant="outline" onClick={() => void open(selected)}>Reintentar</Button></div>}
          {detailLoading && <p role="status">Consultando conversación y seguimientos…</p>}
          {detail && <>
            {detail.canResolve && <ConversationWork key={selected.id} contactedId={selected.id} initial={detail.work} plans={detail.plans.touches.filter(p => p.ownerId === userId)} onChange={() => void load()} />}
            <section className="space-y-3"><h2 className="font-semibold">Próximos pasos</h2>{detail.plans.touches.filter(t => t.ownerId === selected.user_id && activeTouch(t)).length ? detail.plans.touches.filter(t => t.ownerId === selected.user_id && activeTouch(t)).map(t => <details key={t.id} className="rounded-xl border p-3"><summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t.kind === 'bulk' ? `${t.campaignName || 'Campaña'} · correo ${t.index + 1}` : `Correo ${t.index + 1}`} · {date(t.dueAt)}<span className="block text-sm text-muted-foreground">{stepLabels[t.state] || t.state} · {t.kind === 'bulk' ? 'Campaña masiva' : t.autoSend ? 'Automático cuando esté aprobado' : 'Envío manual'}</span></summary><div className="mt-3 space-y-2"><p className="font-medium">{t.subject || 'Contenido por preparar'}</p><p className="whitespace-pre-wrap break-words text-sm">{t.text}</p>{t.error && <p className="text-sm">Este envío requiere revisión.</p>}{t.kind === 'first_contact' && t.draftId && t.ownerId === userId && <Button variant="outline" asChild><Link href={`/contact/compose?draftId=${encodeURIComponent(t.draftId)}`}>Revisar correo</Link></Button>}{t.kind === 'first_contact' && t.ownerId === userId && <Button variant="destructive" onClick={() => setStopTarget(t)}>Detener seguimientos</Button>}{t.kind === 'bulk' && t.ownerId === userId && <Button variant="outline" asChild><Link href="/campaigns">Ver campaña</Link></Button>}</div></details>) : <p className="text-sm text-muted-foreground">{detail.plans.complete ? 'No hay seguimientos activos en las secuencias o campañas consultadas.' : 'No pudimos comprobar todos los seguimientos.'}</p>}</section>
            <section className="space-y-4"><h2 className="font-semibold">Conversación</h2>{detail.providerError && <p className="text-sm text-muted-foreground">{detail.providerError}</p>}{!detail.providerComplete && <p className="text-xs text-muted-foreground">Historial parcial. La ausencia de un mensaje aquí no confirma que no exista.</p>}{detail.messages.map(m => <article key={m.id} className="rounded-xl border p-4"><div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{m.direction === 'outbound' ? 'Enviado' : 'Recibido'} · {date(m.receivedAt)}</span><span>{m.source === 'provider' ? 'Consultado en correo' : 'Registro guardado'}</span></div><p className="mt-2 break-all text-xs text-muted-foreground">De: {m.from || 'Remitente no disponible'}{m.to?.length ? ` · Para: ${m.to.join(', ')}` : ''}</p><h3 className="mt-2 font-medium">{m.subject}</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{m.text || 'El contenido enviado no está disponible en este registro. Puedes consultar el original en tu correo.'}</p></article>)}</section>
             <details className="border-t pt-4"><summary className="cursor-pointer text-sm">Actividad del correo</summary>{detail.trackingAvailable ? <><p className="mt-2 text-sm text-muted-foreground">{detail.trackingEvents.some(event => event.event_type === 'email_opened') ? `Apertura detectada ${date(detail.trackingEvents.find(event => event.event_type === 'email_opened')?.event_at)}. No confirma lectura humana.` : 'Sin señal de apertura. No significa que el correo no se haya leído.'}</p><p className="text-xs text-muted-foreground">Los filtros y proxies de correo pueden generar o bloquear estas señales.</p>{detail.trackingEvents.filter(event => event.event_type === 'email_clicked').map(event => <p key={event.id} className="text-sm text-muted-foreground">Clic detectado · {date(event.event_at)}</p>)}</> : <p className="mt-2 text-sm text-muted-foreground">Seguimiento de apertura no disponible para este envío.</p>}</details>
          </>}
        </div>}
      </SheetContent>
    </Sheet>
    <AlertDialog open={Boolean(stopTarget)} onOpenChange={open => { if (!open && !stopping) setStopTarget(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>¿Detener los correos pendientes?</AlertDialogTitle><AlertDialogDescription>Se cancelarán los próximos pasos de esta secuencia. Los mensajes ya enviados y el historial se conservarán.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={stopping}>Volver</AlertDialogCancel><AlertDialogAction disabled={stopping} onClick={event => { event.preventDefault(); void stopFollowups(); }}>{stopping ? 'Deteniendo…' : 'Detener seguimientos'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </div>;
}
