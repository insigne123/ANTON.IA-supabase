'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { InitialsAvatar } from '@/components/initials-avatar';
import { MessagesSquare, MessageSquareWarning, MousePointerClick, RefreshCw, Search } from 'lucide-react';
import { ConversationWork } from './ConversationWork';
import { CloseConversationDialog, conversationClosedNotice } from './CloseConversationDialog';
import type { ConversationTeamLock } from '@/lib/conversation-close';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import {
  CONVERSATION_VIEWS,
  CONVERSATION_VIEW_LABELS,
  activeTouch,
  conversationStatus,
  conversationTone,
  conversationUrl,
  groupConversations,
  matchesConversationView,
  needsReply,
  readConversationUrl,
  type ConversationRow,
  type ConversationView,
  type PlannedTouch,
} from '@/lib/contacted-conversations';
import { openSentMessageFor } from '@/lib/open-sent-message';
import { parseJsonResponse } from '@/lib/http/safe-json';
import { formatDateTime, formatRelative } from '@/lib/dates';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import type { ContactedLead } from '@/lib/types';

type Message = { id: string; direction: string; from?: string; to?: string[]; receivedAt: string; subject?: string; text?: string; source: string };
type Detail = { work?: any; messages: Message[]; plans: { touches: PlannedTouch[]; complete: boolean }; providerComplete: boolean; providerError: string | null; trackingAvailable: boolean; trackingEvents: Array<{ id: string; event_type: string; event_at: string; meta?: Record<string, unknown> }>; canResolve: boolean; team?: ConversationTeamLock | null };
const recoveryKey = (row: ConversationRow) => `anton.reply:${row.organization_id}:${row.user_id}:${row.id}`;
function date(value?: string | null) { return value && Number.isFinite(Date.parse(value)) ? formatDateTime(value) : 'Fecha por definir'; }
const stepLabels: Record<string, string> = { not_due: 'Pendiente', ready_to_prepare: 'Por preparar', drafting: 'Preparando', review_required: 'Por revisar', approved: 'Aprobado', dispatch_pending: 'En cola', sending: 'Enviando', sent: 'Enviado', deferred: 'Pospuesto', failed: 'Fallido', unknown: 'Por confirmar', skipped: 'Omitido', blocked: 'Bloqueado', paused: 'Campaña pausada', pending_initial_send: 'Espera el primer envío' };
const crmStageLabels: Record<string, string> = { inbox: 'Nuevo', negotiation: 'Negociación', closed_won: 'Ganado', closed_lost: 'Perdido', new: 'Nuevo', contacted: 'Contactado', engaged: 'Interesado', meeting: 'Solicitud de reunión', qualified: 'Calificado', opportunity: 'Oportunidad', customer: 'Cliente', lost: 'Cerrado sin avance' };
const providerLabels: Record<string, string> = { gmail: 'Gmail', outlook: 'Outlook', linkedin: 'LinkedIn', phone: 'Teléfono' };

/** A JSON answer, or a message in Spanish: a page that answers HTML (a 502, a login redirect) no longer shows «Unexpected token <». */
async function json(response: Response) {
  const parsed = await parseJsonResponse(response);
  if (!response.ok || parsed.data === undefined) throw new Error(response.status === 401 || response.status === 403 ? 'Tu sesión o tus permisos cambiaron. Vuelve a ingresar.' : 'No pudimos completar la consulta. Intenta nuevamente.');
  return parsed.data;
}

export default function ConversationsWorkspace() {
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [touches, setTouches] = useState<PlannedTouch[]>([]);
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [coverage, setCoverage] = useState(true);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [view, setView] = useState<ConversationView>('reply');
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
  const [closing, setClosing] = useState(false);
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
  // «Responder» or a suggestion opens the editor: it comes into view whole, «Enviar respuesta» included, with the cursor
  // in the reply. Only when the person asked for it, not when a pending draft is restored on load.
  const replyEditor = useRef<HTMLDivElement | null>(null);
  const [sentNotice, setSentNotice] = useState('');
  const revealReply = useRef(false);
  // Wide screens show the open conversation beside the list; narrower ones open it over the list.
  const wide = useMediaQuery('(min-width: 1024px)');

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
  // An address can open a view (?view=reply|waiting|scheduled|all): the old «Respondidos» and «Planificador» pages and the reply notices use it.
  useEffect(() => {
    const requested = readConversationUrl(window.location.search).view;
    if (requested) setView(requested);
  }, []);

  const chooseView = useCallback((next: ConversationView) => {
    setView(next);
    window.history.replaceState(null, '', conversationUrl(window.location.href, { view: next }));
  }, []);

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
      setSyncStatus(cursor ? 'Actualización parcial. Quedan contactos por consultar.' : issues ? `Actualización parcial: ${issues} consultas requieren revisar la conexión. ${found} respuestas nuevas.` : `Tus cuentas actualizadas a las ${new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })}. ${found} respuestas nuevas.`);
      await load();
    } catch (e) { setSyncStatus((e as Error).message); }
    finally { setSyncing(false); }
  }, [load]);

  const open = useCallback(async (row: ConversationRow, address: 'push' | 'replace' | 'none' = 'push') => {
    const version = ++request.current;
    if (address !== 'none') {
      const next = conversationUrl(window.location.href, { conversationId: row.id });
      if (address === 'push') window.history.pushState(null, '', next); else window.history.replaceState(null, '', next);
    }
    setSelected(row); setDetail(null); setDetailError(''); setDetailLoading(true); observedAt.current = new Date().toISOString();
    setDraftingReply(false); setReplyEditorOpen(false); setReplyError(''); setReplyStatus(''); setReplySubject(''); setReplyBody(''); setReplyIdempotencyKey(''); setTrackReplyActivity(false); setSentNotice('');
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

  /** Closes the open conversation and drops ?c= from the address (kept in history, so «atrás» works as expected). */
  const closeDetail = useCallback(() => {
    request.current++;
    setSelected(null); setDetail(null);
    if (readConversationUrl(window.location.search).conversationId) window.history.replaceState(null, '', conversationUrl(window.location.href, { conversationId: null }));
  }, []);

  const groups = useMemo(() => groupConversations(rows), [rows]);
  const plansFor = useCallback((row: ConversationRow) => touches.filter(t => t.email.toLowerCase() === row.email?.toLowerCase() && t.ownerId === row.user_id && activeTouch(t)), [touches]);

  // «Hoy» links to one conversation (?c=<id>): open it once, in the view that shows it.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || loading) return;
    const target = readConversationUrl(window.location.search).conversationId;
    if (!target) { deepLinked.current = true; return; }
    const row = rows.find(item => item.id === target);
    if (row) {
      deepLinked.current = true;
      // Keep the view the address asks for when it shows this conversation; otherwise the one that does.
      const requested = readConversationUrl(window.location.search).view;
      setView(requested && matchesConversationView(row, requested, plansFor(row).length > 0) ? requested : needsReply(row) ? 'reply' : 'all');
      void open(row, 'none');
    }
    else if (nextOffset === null) deepLinked.current = true;
  }, [rows, loading, nextOffset, open, plansFor]);

  // The back button closes the open conversation (or opens the one the address names).
  useEffect(() => {
    const onPop = () => {
      const target = readConversationUrl(window.location.search).conversationId;
      if (!target) { request.current++; setSelected(null); setDetail(null); return; }
      const row = rows.find(item => item.id === target);
      if (row && row.id !== selected?.id) void open(row, 'none');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [rows, selected?.id, open]);

  const filtered = groups.filter(({ row }) => {
    if (mine && row.user_id !== userId) return false;
    if (provider !== 'all' && row.provider !== provider) return false;
    if (query && ![row.name, row.email, row.company, row.subject].join(' ').toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  const viewCounts = Object.fromEntries(CONVERSATION_VIEWS.map((key) => [key, filtered.filter(({ row }) => matchesConversationView(row, key, plansFor(row).length > 0)).length])) as Record<ConversationView, number>;
  const visible = filtered.filter(({ row }) => matchesConversationView(row, view, plansFor(row).length > 0));
  const hasFilters = Boolean(query || mine || provider !== 'all');

  async function resolve() {
    if (!selected) return;
    setSaving(true); setDetailError('');
    try {
      await json(await fetch(`/api/contacted/${encodeURIComponent(selected.id)}/conversation`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolved: !selected.conversation_resolved_at, observedAt: observedAt.current }) }));
      closeDetail(); await load();
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
      const data = (await parseJsonResponse(response)).data || {};
      if (version !== request.current) return;
      if (!response.ok || !data.draft) throw new Error(data.message || 'No pudimos preparar una sugerencia. Puedes escribir la respuesta manualmente.');
      setReplySubject(`Re: ${(selected.subject || '').replace(/^(?:re:\s*)+/i, '')}`);
      setReplyBody(data.draft.bodyText || '');
      setReplyIdempotencyKey(crypto.randomUUID());
      revealReply.current = true;
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
        // Answered, the conversation hides its «Responder» block (and the status inside it): the confirmation goes outside.
        setSentNotice('Respuesta enviada en el hilo original y registrada en esta conversación.');
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


  /** «Responder»: an empty reply in the original thread, written by the person. */
  function startManualReply() {
    if (!selected) return;
    if (sessionStorage.getItem(recoveryKey(selected))) { void open(selected, 'none'); return; }
    setReplyError(''); setReplyStatus('');
    setReplySubject(`Re: ${(selected.subject || '').replace(/^(?:re:\s*)+/i, '')}`);
    setReplyBody('');
    setReplyIdempotencyKey(crypto.randomUUID());
    revealReply.current = true;
    setReplyEditorOpen(true);
  }

  useEffect(() => {
    if (!replyEditorOpen || !revealReply.current) return;
    revealReply.current = false;
    const frame = requestAnimationFrame(() => {
      replyEditor.current?.scrollIntoView({ block: 'nearest' });
      (document.getElementById('reply-body') as HTMLTextAreaElement | null)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [replyEditorOpen]);


  const renderDetail = (current: ConversationRow) => {
    const status = conversationStatus(current);
    const canReplyHere = needsReply(current) && detail?.canResolve && ['gmail', 'outlook'].includes(current.provider);
    return <div className="space-y-6">
      <div className="flex items-start gap-3">
        <InitialsAvatar name={current.name} email={current.email} size="lg" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={conversationTone(status)}>{status}</Badge>
            <span className="text-xs text-foreground/70">{crmStageLabels[current.crm_stage || ''] || current.crm_stage || 'Sin fase comercial'} · {providerLabels[current.provider] || current.provider}</span>
          </div>
          <p className="text-xs text-foreground/70">{current.reply_sync_error ? 'Actualización pendiente: revisa la conexión.' : current.reply_sync_succeeded_at ? `Última revisión: ${date(current.reply_sync_succeeded_at)}` : 'Sin revisión automática confirmada'}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void openSentMessageFor({ id: current.id, provider: current.provider, messageId: current.message_id, threadId: current.thread_id, conversationId: current.conversation_id, internetMessageId: current.internet_message_id, email: current.email } as ContactedLead).catch(() => setDetailError('No pudimos abrir el correo original.'))}>Abrir en correo</Button>
        {detail?.canResolve && (current.conversation_resolved_at
          ? <Button variant="outline" size="sm" disabled={saving} onClick={() => void resolve()}>{saving ? 'Guardando…' : 'Volver a pendiente'}</Button>
          : <Button variant="outline" size="sm" disabled={saving || detailLoading} onClick={() => setClosing(true)}>Cerrar conversación</Button>)}
      </div>
      <p className="text-xs text-foreground/70">Cerrar conserva el historial. Solo «No interesado» detiene sus seguimientos.</p>
      {canReplyHere && <section aria-label={`Responder a ${current.name || current.email}`} className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <div><h2 className="font-semibold">Responder a {current.name || current.email}</h2><p className="text-sm text-foreground/70">La respuesta sale en el hilo original. Revisa el texto antes de enviarlo.</p></div>
        {!replyEditorOpen && <div className="flex flex-wrap gap-2">
          <Button disabled={draftingReply || detailLoading} onClick={startManualReply}>Responder</Button>
          <Button variant="outline" disabled={draftingReply || detailLoading} onClick={() => void prepareReply()}>{draftingReply ? 'Preparando…' : 'Sugerir con IA'}</Button>
        </div>}
        {replyEditorOpen && <div ref={replyEditor} className="scroll-mb-4 space-y-3"><div><Label htmlFor="reply-subject">Asunto</Label><Input id="reply-subject" value={replySubject} onChange={event => { setReplySubject(event.target.value); if (!replyBusy) setReplyIdempotencyKey(crypto.randomUUID()); }} disabled={replyBusy || Boolean(replyStatus)} /></div><div><Label htmlFor="reply-body">Tu respuesta</Label><textarea id="reply-body" value={replyBody} onChange={event => { setReplyBody(event.target.value); if (!replyBusy) setReplyIdempotencyKey(crypto.randomUUID()); }} rows={7} maxLength={12000} disabled={replyBusy || Boolean(replyStatus)} className="flex w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60" /></div><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={trackReplyActivity} onChange={event => setTrackReplyActivity(event.target.checked)} disabled={replyBusy || Boolean(replyStatus)} /><span>Registrar señales de apertura y clic <span className="block text-xs text-foreground/70">Opcional; una apertura no demuestra que la persona haya leído el correo.</span></span></label><p className="text-xs text-foreground/70">El correo incluirá la opción de dejar de recibir mensajes comerciales.</p><div className="flex flex-wrap gap-2"><Button disabled={replyBusy || !replyBody.trim() || !replySubject.trim()} onClick={() => void sendReply()}>{replyBusy ? 'Enviando…' : replyStatus ? 'Comprobar estado' : 'Enviar respuesta'}</Button><Button variant="ghost" disabled={replyBusy} onClick={() => { setReplyEditorOpen(false); setReplyBody(''); setReplyStatus(''); setReplyIdempotencyKey(''); }}>Cancelar</Button></div></div>}
        {replyError && <p role="alert" className="text-sm text-destructive">{replyError}</p>}{replyStatus && <p role="status" className="text-sm text-foreground/70">{replyStatus}</p>}
      </section>}
      {sentNotice && <p role="status" className="rounded-xl bg-cw-success-soft px-3 py-2 text-sm text-foreground">{sentNotice}</p>}
      {detailError && <div role="alert" className="space-y-2 rounded-xl border p-3"><p>{detailError}</p><Button variant="outline" onClick={() => void open(current, 'none')}>Reintentar</Button></div>}
          {detailLoading && <p role="status">Consultando conversación y seguimientos…</p>}
          {detail && <>
            {detail.canResolve && <ConversationWork key={current.id} contactedId={current.id} initial={detail.work} plans={detail.plans.touches.filter(p => p.ownerId === userId)} onChange={() => void load()} />}
            <section className="space-y-3"><h2 className="font-semibold">Próximos pasos</h2>{detail.plans.touches.filter(t => t.ownerId === current.user_id && activeTouch(t)).length ? detail.plans.touches.filter(t => t.ownerId === current.user_id && activeTouch(t)).map(t => <details key={t.id} className="rounded-xl border p-3"><summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t.kind === 'bulk' ? `${t.campaignName || 'Campaña'} · correo ${t.index + 1}` : `Correo ${t.index + 1}`} · {date(t.dueAt)}<span className="block text-sm text-foreground/70">{stepLabels[t.state] || t.state} · {t.kind === 'bulk' ? 'Campaña masiva' : t.autoSend ? 'Automático cuando esté aprobado' : 'Envío manual'}</span></summary><div className="mt-3 space-y-2"><p className="font-medium">{t.subject || 'Contenido por preparar'}</p><p className="whitespace-pre-wrap break-words text-sm">{t.text}</p>{t.error && <p className="text-sm">Este envío requiere revisión.</p>}{t.kind === 'first_contact' && t.draftId && t.ownerId === userId && <Button variant="outline" asChild><Link href={`/contact/compose?draftId=${encodeURIComponent(t.draftId)}`}>Revisar correo</Link></Button>}{t.kind === 'first_contact' && t.ownerId === userId && <Button variant="destructive" onClick={() => setStopTarget(t)}>Detener seguimientos</Button>}{t.kind === 'bulk' && t.ownerId === userId && <Button variant="outline" asChild><Link href="/campaigns">Ver campaña</Link></Button>}</div></details>) : <p className="text-sm text-foreground/70">{detail.plans.complete ? 'No hay seguimientos activos en las secuencias o campañas consultadas.' : 'No pudimos comprobar todos los seguimientos.'}</p>}</section>
            <section className="space-y-4"><h2 className="font-semibold">Conversación</h2>{detail.providerError && <p className="text-sm text-foreground/70">{detail.providerError}</p>}{!detail.providerComplete && <p className="text-xs text-foreground/70">Historial parcial. La ausencia de un mensaje aquí no confirma que no exista.</p>}{detail.messages.map(m => <article key={m.id} className="rounded-xl border p-4"><div className="flex flex-wrap justify-between gap-2 text-xs text-foreground/70"><span>{m.direction === 'outbound' ? 'Enviado' : 'Recibido'} · {date(m.receivedAt)}</span><span>{m.source === 'provider' ? 'Consultado en correo' : 'Registro guardado'}</span></div><p className="mt-2 break-all text-xs text-foreground/70">De: {m.from || 'Remitente no disponible'}{m.to?.length ? ` · Para: ${m.to.join(', ')}` : ''}</p><h3 className="mt-2 font-medium">{m.subject}</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{m.text || 'El contenido enviado no está disponible en este registro. Puedes consultar el original en tu correo.'}</p></article>)}</section>
             <details className="border-t pt-4"><summary className="cursor-pointer text-sm">Actividad del correo</summary>{detail.trackingAvailable ? <><p className="mt-2 text-sm text-foreground/70">{detail.trackingEvents.some(event => event.event_type === 'email_opened') ? `Apertura detectada ${date(detail.trackingEvents.find(event => event.event_type === 'email_opened')?.event_at)}. No confirma lectura humana.` : 'Sin señal de apertura. No significa que el correo no se haya leído.'}</p><p className="text-xs text-foreground/70">Los filtros y proxies de correo pueden generar o bloquear estas señales.</p>{detail.trackingEvents.filter(event => event.event_type === 'email_clicked').map(event => <p key={event.id} className="text-sm text-foreground/70">Clic detectado · {date(event.event_at)}</p>)}</> : <p className="mt-2 text-sm text-foreground/70">Seguimiento de apertura no disponible para este envío.</p>}</details>
          </>}

    </div>;
  };


  const list = <section aria-label="Conversaciones" aria-busy={loading} className="min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-card">
    <div className="space-y-3 border-b border-border/60 p-3 sm:p-4">
      <div data-tour="conv-views" role="group" aria-label="Ver conversaciones" className="flex flex-wrap gap-1.5">
        {CONVERSATION_VIEWS.map((key) => {
          const active = view === key;
          return <button key={key} type="button" aria-pressed={active} onClick={() => chooseView(key)} className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', active ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border/70 bg-background text-foreground/70 hover:text-foreground')}>
            {CONVERSATION_VIEW_LABELS[key]}<span className="tabular-nums text-foreground/70">{viewCounts[key]}</span>
          </button>;
        })}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/70" aria-hidden="true" />
        <Input id="conversation-search" aria-label="Buscar contacto o empresa" value={query} onChange={e => setQuery(e.target.value)} placeholder="Nombre, correo, empresa o asunto" className="pl-9" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger aria-label="Canal" className="h-9 w-[176px]"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos los canales</SelectItem><SelectItem value="gmail">Gmail</SelectItem><SelectItem value="outlook">Outlook</SelectItem><SelectItem value="linkedin">LinkedIn</SelectItem><SelectItem value="phone">Teléfono</SelectItem></SelectContent>
        </Select>
        <Button type="button" size="sm" variant={mine ? 'secondary' : 'outline'} aria-pressed={mine} onClick={() => setMine(value => !value)}>Solo mías</Button>
        <Button data-tour="conv-sync" type="button" size="sm" variant="ghost" className="ml-auto" disabled={syncing} onClick={() => void sync()}>
          <RefreshCw className={cn('h-4 w-4', syncing && 'motion-safe:animate-spin')} aria-hidden="true" />{syncing ? 'Actualizando…' : 'Traer respuestas'}
        </Button>
      </div>
      <p role="status" className="text-xs text-foreground/70">{syncStatus || 'Las respuestas llegan solas cada cierto tiempo. «Traer respuestas» consulta tus cuentas ahora.'}</p>
      {(!coverage || nextOffset !== null) && <p className="text-xs text-foreground/70">Vista parcial: los filtros se aplican a las conversaciones cargadas. {!coverage && 'No pudimos comprobar todos los seguimientos.'}</p>}
    </div>
    {error && <Alert variant="destructive" className="m-3 w-auto"><MessageSquareWarning className="h-4 w-4" aria-hidden="true" /><AlertDescription className="flex flex-wrap items-center justify-between gap-2"><span>{error}</span><Button variant="outline" size="sm" onClick={() => void load()}>Reintentar</Button></AlertDescription></Alert>}
    <div className="lg:max-h-[calc(100vh-19rem)] lg:overflow-y-auto">
      {loading && !rows.length ? <p role="status" className="p-6 text-sm text-foreground/70">Cargando conversaciones…</p> : !visible.length ? <EmptyState icon={error ? MessageSquareWarning : MessagesSquare} headingLevel="p" title={error ? 'Historial no disponible' : view === 'reply' && !hasFilters ? 'Nadie espera tu respuesta' : 'No hay conversaciones en esta vista'} description={error ? 'No pudimos traer tus conversaciones. Prueba de nuevo en unos minutos.' : view === 'reply' && !hasFilters ? 'Las nuevas respuestas que necesiten atención aparecerán aquí.' : 'Prueba otra vista o cambia los filtros.'} action={view !== 'all' || hasFilters ? <Button variant="outline" size="sm" onClick={() => { chooseView('all'); setQuery(''); setMine(false); setProvider('all'); }}>Ver todas</Button> : undefined} /> : <ul className="divide-y divide-border/60">
        {visible.map(({ row, history }) => {
          const next = plansFor(row).sort((a, b) => (Date.parse(a.dueAt || '') || Infinity) - (Date.parse(b.dueAt || '') || Infinity))[0];
          const status = conversationStatus(row);
          const active = selected?.id === row.id;
          return <li key={row.id}><button type="button" aria-current={active ? 'true' : undefined} onClick={e => { opener.current = e.currentTarget; void open(row); }} className={cn('flex w-full gap-3 p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-4', active && 'bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]')}>
            <InitialsAvatar name={row.name} email={row.email} />
            <span className="min-w-0 flex-1 space-y-1">
              <span className="flex items-baseline justify-between gap-2"><span className="truncate font-medium">{row.name || row.email}</span><span className="shrink-0 text-xs text-foreground/70">{formatRelative(row.replied_at || row.sent_at)}</span></span>
              <span className="block truncate text-sm text-foreground/70">{row.company || row.email}</span>
              <span className="flex min-w-0 items-center gap-2"><Badge variant={conversationTone(status)} className="shrink-0">{status}</Badge><span className="truncate text-xs text-foreground/70">{row.reply_preview || row.subject || 'Contacto registrado'}</span></span>
              <span className="block text-xs text-foreground/70">{next ? `Seguimiento ${next.index + 1} · ${date(next.dueAt)}` : row.status === 'scheduled' ? `Programado · ${date(row.scheduled_at)}` : `${providerLabels[row.provider] || row.provider} · ${history.length} ${history.length === 1 ? 'registro' : 'registros'} · ${row.user_id === userId ? 'Mi cuenta' : 'Cuenta del equipo'}`}</span>
            </span>
          </button></li>;
        })}
      </ul>}
      {nextOffset !== null && <div className="border-t border-border/60 p-3"><Button variant="outline" size="sm" className="w-full" disabled={loading} onClick={() => void load(nextOffset)}>Cargar más conversaciones</Button></div>}
    </div>
  </section>;

  return <div className="space-y-4 pb-8">
    <PageHeader title="Conversaciones" description="Quién te respondió, a quién esperas y qué sigue con cada persona." />
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
      {list}
      {wide && <section aria-label="Conversación abierta" className="min-w-0 rounded-2xl border border-border/60 bg-card lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
        {selected ? <div className="p-5">
          <header className="mb-4 border-b border-border/60 pb-4"><h2 className="text-lg font-semibold">{selected.name || selected.email}</h2><p className="text-sm text-foreground/70">{[selected.company, selected.email].filter(Boolean).join(' · ')}</p></header>
          {renderDetail(selected)}
        </div> : <EmptyState icon={MousePointerClick} headingLevel="p" className="min-h-[50vh] max-w-none justify-center" title="Elige una conversación" description="Ábrela aquí para ver los mensajes, responder en el mismo hilo y revisar sus próximos pasos." />}
      </section>}
    </div>
    <Sheet open={!wide && Boolean(selected)} onOpenChange={value => { if (!value && !replyBusy) closeDetail(); }}>
      <SheetContent onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus(); }} className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader><SheetTitle>{selected?.name || selected?.email}</SheetTitle><SheetDescription>{[selected?.company, selected?.email].filter(Boolean).join(' · ')}</SheetDescription></SheetHeader>
        {selected && <div className="mt-6">{renderDetail(selected)}</div>}
      </SheetContent>
    </Sheet>
    {selected && <CloseConversationDialog open={closing} onOpenChange={setClosing} contactedId={selected.id} name={selected.name || selected.email || 'esta persona'}
      team={detail?.team ?? null} observedAt={observedAt.current}
      onClosed={result => { setClosing(false); setSyncStatus(conversationClosedNotice(selected.name || selected.email || 'esta persona', result)); closeDetail(); void load(); }} />}
    <AlertDialog open={Boolean(stopTarget)} onOpenChange={open => { if (!open && !stopping) setStopTarget(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>¿Detener los correos pendientes?</AlertDialogTitle><AlertDialogDescription>Se cancelarán los próximos pasos de esta secuencia. Los mensajes ya enviados y el historial se conservarán.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={stopping}>Volver</AlertDialogCancel><AlertDialogAction disabled={stopping} onClick={event => { event.preventDefault(); void stopFollowups(); }}>{stopping ? 'Deteniendo…' : 'Detener seguimientos'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </div>;
}
