
'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { graphFindReadReceipts, graphFindReplies } from '@/lib/outlook-graph-client';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { deleteContactedCascade } from '@/lib/delete-contacted-cascade';
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  Inbox,
  Loader2,
  ListFilter,
  MailOpen,
  MessageSquareReply,
  MoreHorizontal,
  Phone,
  PhoneCall,
  ScanSearch,
  Search,
  SendHorizontal,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import type { ContactedLead } from '@/lib/types';
import Link from 'next/link';
import { openSentMessageFor } from '@/lib/open-sent-message';
import DailyQuotaProgress from '@/components/quota/daily-quota-progress';
import { gmailClient } from '@/lib/gmail-client';
import { resolveReplyContent } from '@/lib/reply-content-resolver';
import { countUniqueReplyContacts, hasReplySignal } from '@/lib/antonia-reply-metrics';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

type ContactedTimelineEvent = {
  id: string;
  event_type: string;
  event_source?: string | null;
  event_at: string;
  meta?: Record<string, any> | null;
};

type ContactedFilter = 'all' | 'email' | 'phone' | 'opened' | 'clicked' | 'failed';

export default function ContactedPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<ContactedLead[]>([]);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewSubject, setViewSubject] = useState('');
  const [viewBodyHtml, setViewBodyHtml] = useState('');
  const [viewWebLink, setViewWebLink] = useState<string | undefined>(undefined);
  const [viewTimeline, setViewTimeline] = useState<ContactedTimelineEvent[]>([]);
  const [toDelete, setToDelete] = useState<ContactedLead | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [suggestion, setSuggestion] = useState<string>('');
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<ContactedFilter>('all');

  const escapeHtml = (value: string) =>
    String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  const refresh = useCallback(async () => setItems(await contactedLeadsStorage.get()), []);
  useEffect(() => { refresh(); }, [refresh]);

  const rows = useMemo(() => {
    // Mostrar los NO respondidos; orden por lastUpdateAt desc (fallback sentAt)
    return items
      .filter(x => x.status !== 'replied' && !x.repliedAt)
      .sort((a, b) => {
        const da = new Date(a.lastUpdateAt || a.sentAt).getTime();
        const db = new Date(b.lastUpdateAt || b.sentAt).getTime();
        return db - da;
      });
  }, [items]);

  const replyStats = useMemo(() => {
    const replied = items.filter(x => hasReplySignal(x as any));
    const actionRequired = replied.filter(x => x.replyIntent === 'meeting_request' || x.replyIntent === 'positive').length;
    const stopped = replied.filter(x => x.replyIntent === 'negative' || x.replyIntent === 'unsubscribe' || x.replyIntent === 'delivery_failure').length;
    const autoReply = replied.filter(x => x.replyIntent === 'auto_reply').length;
    return {
      totalReplied: countUniqueReplyContacts(replied as any[]),
      actionRequired,
      stopped,
      autoReply,
    };
  }, [items]);

  const overviewStats = useMemo(() => {
    const opened = rows.filter((item) => Boolean(item.openedAt)).length;
    const clicked = rows.filter((item) => (item.clickCount ?? 0) > 0).length;
    const failed = rows.filter((item) => item.deliveryStatus === 'bounced' || item.deliveryStatus === 'soft_bounced').length;
    const phone = rows.filter((item) => item.provider === 'phone').length;

    return {
      pending: rows.length,
      opened,
      clicked,
      failed,
      phone,
    };
  }, [rows]);

  const filterOptions = useMemo(
    () => [
      { value: 'all' as const, label: 'Todos', count: rows.length },
      { value: 'email' as const, label: 'Email', count: rows.filter((item) => item.provider !== 'phone').length },
      { value: 'phone' as const, label: 'Llamadas', count: rows.filter((item) => item.provider === 'phone').length },
      { value: 'opened' as const, label: 'Abiertos', count: rows.filter((item) => Boolean(item.openedAt)).length },
      { value: 'clicked' as const, label: 'Con clic', count: rows.filter((item) => (item.clickCount ?? 0) > 0).length },
      {
        value: 'failed' as const,
        label: 'Fallidos',
        count: rows.filter((item) => item.deliveryStatus === 'bounced' || item.deliveryStatus === 'soft_bounced').length,
      },
    ],
    [rows],
  );

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return rows.filter((item) => {
      const matchesFilter = (() => {
        switch (activeFilter) {
          case 'email':
            return item.provider !== 'phone';
          case 'phone':
            return item.provider === 'phone';
          case 'opened':
            return Boolean(item.openedAt);
          case 'clicked':
            return (item.clickCount ?? 0) > 0;
          case 'failed':
            return item.deliveryStatus === 'bounced' || item.deliveryStatus === 'soft_bounced';
          default:
            return true;
        }
      })();

      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;

      const haystack = [item.name, item.email, item.company, item.role, item.subject]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [activeFilter, query, rows]);

  const activeFilterOption = useMemo(
    () => filterOptions.find((option) => option.value === activeFilter) ?? filterOptions[0],
    [activeFilter, filterOptions],
  );

  const formatDateTime = useCallback(
    (value?: string) =>
      value
        ? new Intl.DateTimeFormat('es-CL', {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(value))
        : 'Sin registro',
    [],
  );

  const getStatusMeta = useCallback((item: ContactedLead) => {
    if (item.provider === 'phone') {
      return {
        label: 'Llamada',
        hint: 'Registro manual de contacto telefónico.',
        className:
          'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300',
      };
    }

    if (item.status === 'replied') {
      return {
        label: 'Respondido',
        hint: item.repliedAt ? `Respuesta detectada el ${formatDateTime(item.repliedAt)}.` : 'El hilo ya tiene respuesta registrada.',
        className:
          'border-primary/20 bg-primary/10 text-primary hover:bg-primary/10 dark:border-primary/30 dark:bg-primary/15',
      };
    }

    if (item.deliveryStatus === 'bounced') {
      return {
        label: 'Bounce',
        hint: item.bounceReason || 'La entrega fue rechazada por el servidor receptor.',
        className:
          'border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/10 dark:border-destructive/30 dark:bg-destructive/15',
      };
    }

    if (item.deliveryStatus === 'soft_bounced') {
      return {
        label: 'Entrega fallida',
        hint: item.bounceReason || 'El envío falló temporalmente y requiere revisión.',
        className:
          'border-amber-500/20 bg-amber-500/10 text-amber-700 hover:bg-amber-500/10 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300',
      };
    }

    if ((item.clickCount ?? 0) > 0) {
      return {
        label: item.clickCount === 1 ? '1 clic' : `${item.clickCount} clics`,
        hint: item.clickedAt ? `Ultima interaccion el ${formatDateTime(item.clickedAt)}.` : 'El lead interactuo con un enlace del correo.',
        className:
          'border-sky-500/20 bg-sky-500/10 text-sky-700 hover:bg-sky-500/10 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-300',
      };
    }

    if (item.openedAt) {
      return {
        label: 'Abierto',
        hint: `Apertura confirmada el ${formatDateTime(item.openedAt)}.`,
        className:
          'border-indigo-500/20 bg-indigo-500/10 text-indigo-700 hover:bg-indigo-500/10 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-300',
      };
    }

    if (item.deliveredAt) {
      return {
        label: 'Entregado',
        hint: `Entregado el ${formatDateTime(item.deliveredAt)}.`,
        className:
          'border-border/80 bg-secondary/70 text-secondary-foreground hover:bg-secondary/70 dark:bg-secondary/60',
      };
    }

    return {
      label: 'Pendiente',
      hint: 'Aun no hay senal de apertura, clic o respuesta.',
      className: 'border-border/80 bg-muted/70 text-muted-foreground hover:bg-muted/70 dark:bg-muted/50',
    };
  }, [formatDateTime]);

  const buildSuggestion = useCallback(() => {
    setSuggestion(
      'Gracias por tu respuesta. Si te hace sentido, puedo proponerte una llamada breve esta semana para revisar contexto, prioridades y el siguiente paso mas conveniente.',
    );
  }, []);

  const getProviderLabel = useCallback((provider: ContactedLead['provider']) => {
    switch (provider) {
      case 'gmail':
        return 'Gmail';
      case 'outlook':
        return 'Outlook';
      case 'linkedin':
        return 'LinkedIn';
      case 'phone':
        return 'Telefono';
      default:
        return 'Canal';
    }
  }, []);

  const formatTimelineLabel = useCallback(
    (eventType: string) =>
      eventType
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (match) => match.toUpperCase()),
    [],
  );

  const handleViewEmail = async (item: ContactedLead) => {
    try {
      if (item.id) {
        fetch(`/api/contacted/${encodeURIComponent(item.id)}/timeline`)
          .then((res) => res.json())
          .then((payload) => setViewTimeline(payload.events || []))
          .catch(() => setViewTimeline([]));
      }
      await openSentMessageFor(item);
    } catch (e: any) {
      toast({
        variant: 'destructive',
        title: 'No se pudo abrir el email',
        description: e?.message || 'Asegúrate de que la sesión esté activa y los permisos sean correctos.',
      });
    }
  };

  const handleViewPhoneNotes = (item: ContactedLead) => {
    setViewTimeline([]);
    setSuggestion('');
    setViewSubject(item.subject || 'Llamada telefónica');

    // Extraer el resultado y las notas del subject
    const subjectParts = item.subject?.split(' - ') || [];
    const resultado = subjectParts[0] || item.subject;
    const notas = subjectParts.slice(1).join(' - ') || 'Sin notas adicionales';

    const safeName = escapeHtml(item.name || '');
    const safeEmail = escapeHtml(item.email || '');
    const safeCompany = escapeHtml(item.company || 'No especificada');
    const safeRole = escapeHtml(item.role || 'Cargo no especificado');
    const safeResult = escapeHtml(resultado || 'Sin resultado');
    const safeNotes = escapeHtml(notas || 'Sin notas adicionales');
    const safeDate = escapeHtml(new Date(item.sentAt).toLocaleString('es-CL', { dateStyle: 'full', timeStyle: 'short' }));

    setViewBodyHtml(`
      <div style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif;color:#0f172a;">
        <div style="display:grid;gap:18px;">
          <section style="padding:24px;border-radius:24px;border:1px solid #dbe4f0;background:linear-gradient(180deg,rgba(248,250,252,0.98) 0%,rgba(255,255,255,0.98) 100%);box-shadow:0 24px 60px -40px rgba(15,23,42,0.22);">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
              <div>
                <div style="font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#64748b;margin-bottom:10px;">Registro de llamada</div>
                <h2 style="margin:0;font-size:28px;line-height:1.1;font-weight:650;color:#0f172a;">${safeResult}</h2>
              </div>
              <div style="padding:10px 14px;border-radius:999px;background:#eef4ff;color:#1d4ed8;font-size:13px;font-weight:600;">${safeDate}</div>
            </div>
            <p style="margin:14px 0 0;color:#475569;font-size:14px;line-height:1.6;">Resumen visual del contacto telefonico, con contexto del lead y notas listas para seguimiento.</p>
          </section>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
            <section style="padding:18px;border-radius:20px;border:1px solid #dbe4f0;background:#ffffff;box-shadow:0 18px 45px -38px rgba(15,23,42,0.18);">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">Lead</div>
              <div style="font-size:17px;font-weight:650;color:#0f172a;margin-bottom:4px;">${safeName}</div>
              <div style="font-size:14px;color:#64748b;line-height:1.6;">${safeEmail}</div>
            </section>
            <section style="padding:18px;border-radius:20px;border:1px solid #dbe4f0;background:#ffffff;box-shadow:0 18px 45px -38px rgba(15,23,42,0.18);">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">Empresa</div>
              <div style="font-size:17px;font-weight:650;color:#0f172a;margin-bottom:4px;">${safeCompany}</div>
              <div style="font-size:14px;color:#64748b;line-height:1.6;">${safeRole}</div>
            </section>
          </div>

          <section style="padding:20px;border-radius:22px;border:1px solid rgba(14,165,233,0.18);background:linear-gradient(180deg,rgba(239,246,255,0.96) 0%,rgba(248,250,252,0.96) 100%);box-shadow:0 18px 45px -38px rgba(14,165,233,0.28);">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#0369a1;margin-bottom:10px;">Resultado principal</div>
            <div style="font-size:19px;line-height:1.45;font-weight:650;color:#0f172a;">${safeResult}</div>
          </section>

          <section style="padding:20px;border-radius:22px;border:1px solid #dbe4f0;background:#ffffff;box-shadow:0 18px 45px -38px rgba(15,23,42,0.18);">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#64748b;margin-bottom:12px;">Notas de seguimiento</div>
            <div style="white-space:pre-wrap;line-height:1.75;color:#1e293b;font-size:15px;padding:16px;border-radius:18px;background:#f8fafc;border:1px solid #e2e8f0;">${safeNotes}</div>
          </section>
        </div>
      </div>
    `);
    setViewWebLink(undefined);
    setViewOpen(true);
  };

  async function handleVerifyRead(it: ContactedLead) {
    if (!it.internetMessageId) {
      toast({ variant: 'destructive', title: 'No disponible', description: 'Este envío no tiene Internet-Message-Id.' });
      return;
    }
    try {
      const hits = await graphFindReadReceipts(it.internetMessageId);
      if (hits.length > 0) {
        const rr = hits[0];
        if (it.conversationId) {
          await contactedLeadsStorage.markReceiptsByConversationId(it.conversationId, {
            openedAt: rr.receivedDateTime,
            readReceiptMessageId: rr.id,
          });
        }
        toast({ title: 'Leído', description: 'Se recibió acuse de lectura y se registró la apertura.' });
        refresh();
      } else {
        toast({ title: 'No abierto', description: 'Aún no hay acuse de lectura.' });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e?.message || 'Fallo consultando recibos' });
    }
  }

  async function persistReplyDetected(it: ContactedLead, best: any, repliedAtIso: string) {
    const replyText = (best as any).snippet || (best as any).bodyPreview || '';
    const patch: Partial<ContactedLead> = {
      status: 'replied',
      replyPreview: replyText,
      lastReplyText: replyText,
      replyMessageId: (best as any).id,
      replySubject: (best as any).subject,
      replySnippet: replyText,
      repliedAt: repliedAtIso,
    };

    if (it.messageId) {
      await contactedLeadsStorage.upsertByMessageId(it.messageId, patch as any);
      return;
    }
    if (it.provider === 'gmail' && it.threadId) {
      await contactedLeadsStorage.upsertByThreadId(it.threadId, patch as any);
      return;
    }
    if (it.provider === 'outlook' && it.conversationId) {
      await contactedLeadsStorage.updateStatusByConversationId(it.conversationId, patch as any);
    }
  }

  async function handleVerifyReply(it: ContactedLead) {
    if (!it.conversationId && !it.threadId) {
      toast({ variant: 'destructive', title: 'No disponible', description: 'Este envío no tiene ID de conversación/hilo.' });
      return;
    }

    try {
      let hits;
      if (it.provider === 'gmail' && it.threadId) {
        // Gmail: buscar respuestas en el thread
        hits = await gmailClient.findRepliesByThread(it.threadId);
        } else if (it.provider === 'outlook' && it.conversationId) {
          // Outlook
          hits = await graphFindReplies({
            conversationId: it.conversationId,
            fromEmail: it.email,
            internetMessageId: it.internetMessageId,
            allowSystemSenders: true,
            top: 50,
          });
        }

      if (hits && hits.length > 0) {
        const best = hits[0];
        const repliedAtDate = (best as any).internalDate
          ? new Date(Number((best as any).internalDate))
          : (best as any).receivedDateTime
            ? new Date((best as any).receivedDateTime)
            : new Date();

        await persistReplyDetected(it, best, repliedAtDate.toISOString());
        // Classify reply to decide campaign follow-up
        try {
          await fetch('/api/replies/classify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contactedId: it.id,
              text: (best as any).snippet || (best as any).bodyPreview || '',
              subject: (best as any).subject || '',
              from: (best as any).from?.emailAddress?.address || (best as any).from || '',
            }),
          });
        } catch (e) {
          console.warn('[contacted] classify reply failed:', e);
        }
        toast({ title: 'Respondido', description: 'El contacto respondió este hilo.' });
        refresh();
      } else {
        toast({ title: 'Sin respuesta', description: 'No hay respuestas aún.' });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error verificando respuesta', description: e.message || 'Fallo' });
    }
  }

  async function handleViewReply(it: ContactedLead) {
    setViewLoading(true);
    setSuggestion('');
    try {
      if (it.id) {
        const timelineRes = await fetch(`/api/contacted/${encodeURIComponent(it.id)}/timeline`);
        const timelinePayload = await timelineRes.json().catch(() => ({}));
        setViewTimeline(timelinePayload.events || []);
      }
      const resolved = await resolveReplyContent(it);
      setViewSubject(resolved.subject || '(respuesta)');
      setViewBodyHtml(resolved.html || '<p>(Sin contenido)</p>');
      setViewWebLink(resolved.webLink);
      setViewOpen(true);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error abriendo respuesta', description: e?.message || 'No se pudo cargar la respuesta' });
    } finally {
      setViewLoading(false);
    }
  }

  function confirmDelete(it: ContactedLead) {
    setToDelete(it);
  }
  async function performDelete() {
    if (!toDelete) return;
    const res = await deleteContactedCascade({
      leadId: toDelete.leadId,
      email: toDelete.email,
      messageId: toDelete.messageId,
      conversationId: toDelete.conversationId,
    });
    toast({
      title: 'Lead eliminado',
      description: `Limpiezas → Contactados:${res.contacted} · Guardados:${res.saved} · Enriquecidos:${res.enriched} · Opps:${res.oppEnriched} · Reportes:${res.research}`,
    });
    setToDelete(null);
    refresh();
  }

  // ⬇️ Lote: verificar respuestas para todos los contactados (no 'replied')
  async function verifyAllReplies() {
    const all = await contactedLeadsStorage.get();
    const list = all.filter(x => x.status !== 'replied' && (x.conversationId || x.threadId));
    if (list.length === 0) {
      toast({ title: 'Nada que verificar', description: 'No hay hilos pendientes de respuesta.' });
      return;
    }
    setBulkRunning(true);
    setBulkProgress({ done: 0, total: list.length });

    let found = 0;
    for (const it of list) {
      try {
        let hits;
        if (it.provider === 'gmail' && it.threadId) {
          hits = await gmailClient.findRepliesByThread(it.threadId);
        } else if (it.provider === 'outlook' && it.conversationId) {
          hits = await graphFindReplies({
            conversationId: it.conversationId,
            fromEmail: it.email,
            internetMessageId: it.internetMessageId,
            allowSystemSenders: true,
            top: 50,
          });
        }

        if (hits && hits.length > 0) {
          const best = hits[0];
          const repliedAtDate = (best as any).internalDate
            ? new Date(Number((best as any).internalDate))
            : (best as any).receivedDateTime
              ? new Date((best as any).receivedDateTime)
              : new Date();

          await persistReplyDetected(it, best, repliedAtDate.toISOString());
          try {
            await fetch('/api/replies/classify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contactedId: it.id,
                text: (best as any).snippet || (best as any).bodyPreview || '',
                subject: (best as any).subject || '',
                from: (best as any).from?.emailAddress?.address || (best as any).from || '',
              }),
            });
          } catch (e) {
            console.warn('[contacted] classify reply failed:', e);
          }
          found++;
        }
      } catch (e: any) {
        // continúa; log en consola
        console.warn('verifyAllReplies error on', it.messageId, e?.message);
      }
      setBulkProgress(p => ({ ...p, done: p.done + 1 }));
    }

    setBulkRunning(false);
    refresh();
    toast({ title: 'Verificación completada', description: `Nuevas respuestas: ${found}` });
  }

  // Lote: verificar aperturas (no respondidos)
  async function verifyAllReads() {
    const all = await contactedLeadsStorage.get();
    const list = all.filter(x => x.status !== 'replied' && x.internetMessageId);
    if (list.length === 0) {
      toast({ title: 'Nada que verificar', description: 'No hay mensajes con Internet-Message-Id.' });
      return;
    }
    setBulkRunning(true);
    setBulkProgress({ done: 0, total: list.length });
    let found = 0;
    for (const it of list) {
      try {
        const hits = await graphFindReadReceipts(it.internetMessageId!);
        if (hits.length > 0 && it.conversationId) {
          const rr = hits[0];
          await contactedLeadsStorage.markReceiptsByConversationId(it.conversationId, {
            openedAt: rr.receivedDateTime,
            readReceiptMessageId: rr.id,
          });
          found++;
        }
      } catch (e: any) {
        console.warn('verifyAllReads error on', it.messageId, (e as any)?.message);
      }
      setBulkProgress(p => ({ ...p, done: p.done + 1 }));
    }
    setBulkRunning(false);
    refresh();
    toast({ title: 'Verificación de aperturas completada', description: `Nuevas aperturas: ${found}` });
  }

  return (
    <>
      <PageHeader
        title="Leads Contactados"
        description="Supervisa los hilos sin respuesta, detecta senales de interes y mantén la bandeja comercial ordenada."
      >
        <Button asChild variant="outline" className="rounded-full border-border/70 bg-background/85 backdrop-blur-sm">
          <Link href="/contacted/replied">
            Ver respondidos
            <ArrowUpRight data-icon="inline-end" />
          </Link>
        </Button>
        <Button asChild className="rounded-full shadow-[0_10px_30px_-18px_hsl(var(--primary)/0.65)]">
          <Link href="/contacted/analytics">
            Ver analitica
            <ArrowUpRight data-icon="inline-end" />
          </Link>
        </Button>
      </PageHeader>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.95fr)]">
        <Card className="min-w-0 overflow-hidden rounded-[32px] border-border/60 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.12),transparent_36%),linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--card)/0.94)_100%)] shadow-[0_22px_70px_-48px_rgba(15,23,42,0.32)] backdrop-blur-sm">
          <CardHeader className="gap-6 border-b border-border/60 bg-background/55">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground/80">Seguimiento vivo</div>
                <div className="space-y-2">
                  <CardTitle className="text-[2rem] leading-tight tracking-[-0.03em] sm:text-[2.4rem]">Bandeja de contactos en curso</CardTitle>
                  <CardDescription className="max-w-2xl text-[15px] leading-7 text-muted-foreground">
                    Esta vista prioriza los leads que aun necesitan revision. La idea es detectar senales, revisar el contexto y actuar antes de que el hilo se enfrie.
                  </CardDescription>
                </div>
              </div>
              <div className="rounded-[28px] border border-border/60 bg-background/80 px-5 py-4 shadow-[0_18px_45px_-34px_rgba(15,23,42,0.18)] backdrop-blur-xl">
                <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground/80">Pendientes sin respuesta</div>
                <div className="mt-2 text-4xl font-semibold tracking-[-0.05em] text-foreground">{overviewStats.pending}</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {filteredRows.length} visibles con los filtros actuales.
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[24px] border border-border/60 bg-background/80 p-4 shadow-[0_14px_36px_-30px_rgba(15,23,42,0.18)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Abiertos</div>
                    <div className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{overviewStats.opened}</div>
                  </div>
                  <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <MailOpen className="size-5" />
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">Mensajes con apertura confirmada y mejor contexto para un seguimiento oportuno.</p>
              </div>
              <div className="rounded-[24px] border border-border/60 bg-background/80 p-4 shadow-[0_14px_36px_-30px_rgba(15,23,42,0.18)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Con clic</div>
                    <div className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{overviewStats.clicked}</div>
                  </div>
                  <div className="flex size-11 items-center justify-center rounded-full bg-sky-500/10 text-sky-700 dark:text-sky-300">
                    <Zap className="size-5" />
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">Leads que interactuaron con enlaces y merecen una respuesta mas rapida.</p>
              </div>
              <div className="rounded-[24px] border border-border/60 bg-background/80 p-4 shadow-[0_14px_36px_-30px_rgba(15,23,42,0.18)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Accion requerida</div>
                    <div className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{replyStats.actionRequired}</div>
                  </div>
                  <div className="flex size-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="size-5" />
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">Respuestas positivas o con reunion potencial ya detectadas en la vista de respondidos.</p>
              </div>
              <div className="rounded-[24px] border border-border/60 bg-background/80 p-4 shadow-[0_14px_36px_-30px_rgba(15,23,42,0.18)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Detenidos</div>
                    <div className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{replyStats.stopped + overviewStats.failed}</div>
                  </div>
                  <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                    <CircleAlert className="size-5" />
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">Hilos con entrega fallida, rechazo o senales para frenar el seguimiento.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 rounded-[32px] border-border/60 bg-card/80 shadow-[0_22px_70px_-48px_rgba(15,23,42,0.24)] backdrop-blur-sm">
          <CardHeader className="gap-3 border-b border-border/60 bg-background/45">
            <CardTitle className="text-[1.35rem] tracking-[-0.03em]">Acciones rapidas</CardTitle>
            <CardDescription className="text-sm leading-6">Mantén el seguimiento al dia sin salir de esta vista.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <DailyQuotaProgress kinds={['contact']} compact />
            <Separator className="bg-border/70" />
            <div className="space-y-3">
              <Button variant="secondary" className="w-full justify-center rounded-full" onClick={verifyAllReplies} disabled={bulkRunning}>
                {bulkRunning ? (
                  <>
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                    Verificando {bulkProgress.done}/{bulkProgress.total}
                  </>
                ) : (
                  <>
                    <ScanSearch data-icon="inline-start" />
                    Verificar respuestas en lote
                  </>
                )}
              </Button>
              <Button variant="outline" className="w-full justify-center rounded-full" onClick={verifyAllReads} disabled={bulkRunning}>
                <MailOpen data-icon="inline-start" />
                Verificar aperturas
              </Button>
            </div>
            <div className="rounded-[22px] border border-border/60 bg-muted/25 p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Sparkles className="size-5" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium text-foreground">Ruta recomendada</div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Prioriza abiertos con clic, revisa fallidos y termina el bloque con respondidos para no perder oportunidades calientes.
                  </p>
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-[20px] border border-border/60 bg-background/70 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Respondidos</div>
                <div className="mt-2 text-xl font-semibold tracking-[-0.03em]">{replyStats.totalReplied}</div>
              </div>
              <div className="rounded-[20px] border border-border/60 bg-background/70 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Registros de llamada</div>
                <div className="mt-2 text-xl font-semibold tracking-[-0.03em]">{overviewStats.phone}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4 min-w-0 overflow-hidden rounded-[32px] border-border/60 bg-card/80 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.24)] backdrop-blur-sm">
        <CardHeader className="gap-5 border-b border-border/60 bg-background/45">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/80">Cola activa</div>
              <CardTitle className="text-[1.55rem] tracking-[-0.03em]">Leads en seguimiento</CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-6">
                Usa búsqueda y filtros para quedarte con los hilos que realmente merecen revisión inmediata.
              </CardDescription>
            </div>
            <div className="flex w-full flex-col gap-3 lg:max-w-[360px] lg:items-end">
              <div className="relative w-full">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar por lead, empresa, cargo o asunto"
                  aria-label="Buscar leads contactados"
                  className="h-11 rounded-full border-border/70 bg-background/85 pl-11 pr-4 shadow-none backdrop-blur-sm"
                />
              </div>
              <div className="flex w-full items-center justify-between gap-3 rounded-[20px] border border-border/60 bg-background/55 px-3.5 py-2.5 shadow-[0_12px_30px_-28px_rgba(15,23,42,0.18)] backdrop-blur-sm">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Vista actual</div>
                  <div className="mt-1 flex items-center gap-2 text-sm font-medium text-foreground">
                    <span>{activeFilterOption.label}</span>
                    <Badge variant="secondary" className="border-0 bg-muted/70 text-[11px] font-medium text-muted-foreground">
                      {activeFilterOption.count}
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="hidden text-right text-xs text-muted-foreground sm:block">
                    Mostrando {filteredRows.length} de {rows.length}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" className="rounded-full border-border/70 bg-background/80 px-3.5">
                        <ListFilter data-icon="inline-start" />
                        Filtrar
                        <ChevronDown data-icon="inline-end" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 rounded-2xl border-border/70 bg-background/95 p-1.5 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.28)] backdrop-blur-xl">
                      <DropdownMenuLabel>Mostrar en la tabla</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuRadioGroup value={activeFilter} onValueChange={(value) => setActiveFilter(value as ContactedFilter)}>
                        {filterOptions.map((option) => (
                          <DropdownMenuRadioItem key={option.value} value={option.value} className="pr-10">
                            <span className="flex w-full items-center justify-between gap-4">
                              <span>{option.label}</span>
                              <span className="text-xs text-muted-foreground">{option.count}</span>
                            </span>
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="min-w-0 pt-6">
          <div className="min-w-0 rounded-[28px] border border-border/60 bg-background/70 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.24)] backdrop-blur-sm">
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow className="border-border/60 bg-muted/20 hover:bg-muted/20">
                  <TableHead className="h-14 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Lead</TableHead>
                  <TableHead className="h-14 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Empresa</TableHead>
                  <TableHead className="h-14 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Asunto</TableHead>
                  <TableHead className="h-14 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Actividad</TableHead>
                  <TableHead className="h-14 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Estado</TableHead>
                  <TableHead className="h-14 text-right text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((it) => {
                  const name = it.name || '';
                  const email = it.email || '';
                  const company = it.company || '';
                  const sentAt = formatDateTime(it.sentAt);
                  const canVerifyRead = it.provider === 'outlook' && !!it.internetMessageId;
                  const canVerifyReply = (it.provider === 'outlook' && !!it.conversationId) || (it.provider === 'gmail' && !!it.threadId);
                  const hasReply = Boolean((it as any).replyMessageId);
                  const statusMeta = getStatusMeta(it);
                  const providerLabel = getProviderLabel(it.provider);
                  const leadLabel = name || email;
                  const monogram = (leadLabel || '?').trim().charAt(0).toUpperCase();

                  return (
                    <TableRow key={it.id} className="border-border/60 hover:bg-muted/20">
                      <TableCell>
                        <div className="flex items-start gap-3">
                          <div className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border/70 bg-[radial-gradient(circle_at_top,hsl(var(--background))_0%,hsl(var(--muted))_100%)] text-sm font-semibold text-foreground shadow-[0_10px_30px_-24px_rgba(15,23,42,0.25)]">
                            {it.provider === 'phone' ? <Phone className="size-4" /> : monogram}
                          </div>
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-foreground">{leadLabel}</span>
                              <Badge variant="outline" className="border-border/70 bg-background/80 text-[11px] font-medium text-muted-foreground">
                                {providerLabel}
                              </Badge>
                            </div>
                            <div className="truncate text-xs text-muted-foreground">{email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium text-foreground">{company || 'Sin empresa'}</div>
                          <div className="text-xs text-muted-foreground">{it.role || 'Cargo no especificado'}</div>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[360px]">
                        <div className="space-y-1">
                          <div className="truncate font-medium text-foreground">{it.subject || 'Sin asunto'}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {it.replySummary || statusMeta.hint}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium text-foreground">{sentAt}</div>
                          <div className="text-xs text-muted-foreground">
                            {it.lastUpdateAt ? `Ultima actualizacion ${formatDateTime(it.lastUpdateAt)}` : 'Sin actualizacion reciente'}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-2">
                          <Badge variant="outline" className={cn('gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium', statusMeta.className)}>
                            {it.provider === 'phone' ? <PhoneCall className="size-3.5" /> : <SendHorizontal className="size-3.5" />}
                            {statusMeta.label}
                          </Badge>
                          <div className="max-w-[260px] text-xs leading-5 text-muted-foreground">{statusMeta.hint}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          {it.provider === 'phone' ? (
                            <Button size="sm" variant="outline" className="rounded-full border-border/70 bg-background/85" onClick={() => handleViewPhoneNotes(it)}>
                              Ver notas
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" className="rounded-full border-border/70 bg-background/85" onClick={() => handleViewEmail(it)}>
                              Abrir email
                            </Button>
                          )}

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="rounded-full text-muted-foreground hover:text-foreground" aria-label={`Mas acciones para ${leadLabel}`}>
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-60 rounded-2xl border-border/70 bg-background/95 p-1.5 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.28)] backdrop-blur-xl">
                              <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuGroup>
                                {it.provider === 'phone' ? (
                                  <DropdownMenuItem onClick={() => handleViewPhoneNotes(it)}>
                                    <PhoneCall className="size-4" />
                                    Ver detalles de la llamada
                                  </DropdownMenuItem>
                                ) : (
                                  <>
                                    <DropdownMenuItem onClick={() => handleViewEmail(it)}>
                                      <MailOpen className="size-4" />
                                      Abrir email enviado
                                    </DropdownMenuItem>
                                    <DropdownMenuItem disabled={!canVerifyRead} onClick={() => handleVerifyRead(it)}>
                                      <ScanSearch className="size-4" />
                                      Verificar lectura
                                    </DropdownMenuItem>
                                    <DropdownMenuItem disabled={!canVerifyReply} onClick={() => handleVerifyReply(it)}>
                                      <MessageSquareReply className="size-4" />
                                      Verificar respuesta
                                    </DropdownMenuItem>
                                    <DropdownMenuItem disabled={!hasReply} onClick={() => handleViewReply(it)}>
                                      <Inbox className="size-4" />
                                      Ver respuesta detectada
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuGroup>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => confirmDelete(it)}>
                                <Trash2 className="size-4" />
                                Eliminar lead
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-14 text-center text-sm text-muted-foreground">
                      <div className="mx-auto flex max-w-md flex-col items-center gap-3">
                        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <Inbox className="size-5" />
                        </div>
                        <div className="space-y-1">
                          <div className="font-medium text-foreground">No hay leads que coincidan con la vista actual.</div>
                          <div>
                            Ajusta la búsqueda o revisa los{' '}
                            <Link className="underline underline-offset-4 text-primary" href="/contacted/replied">
                              respondidos
                            </Link>
                            .
                          </div>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="flex max-h-[88vh] max-w-4xl flex-col gap-0 overflow-hidden rounded-[32px] border-border/60 bg-background/95 p-0 shadow-[0_24px_80px_-46px_rgba(15,23,42,0.4)] backdrop-blur-xl">
          <DialogHeader className="gap-4 border-b border-border/60 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.12),transparent_34%),linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--card)/0.94)_100%)] px-6 py-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/80">Vista detallada</div>
                <DialogTitle className="max-w-3xl text-[1.6rem] leading-tight tracking-[-0.03em]">{viewSubject}</DialogTitle>
                <DialogDescription className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  Revisa el contenido del intercambio, consulta la cronología del hilo y prepara el siguiente paso con mejor contexto.
                </DialogDescription>
              </div>
              {viewWebLink && (
                <Button asChild variant="outline" className="rounded-full border-border/70 bg-background/85">
                  <a href={viewWebLink} target="_blank" rel="noopener noreferrer">
                    Abrir original
                    <ExternalLink data-icon="inline-end" />
                  </a>
                </Button>
              )}
            </div>
          </DialogHeader>
          {viewLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Cargando…</div>
          ) : (
            <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-h-0 overflow-y-auto px-6 py-5">
                <div className="rounded-[26px] border border-border/60 bg-background/85 p-5 shadow-[0_18px_55px_-42px_rgba(15,23,42,0.22)] backdrop-blur-sm">
                  <div className="prose prose-sm mb-0 max-w-none text-foreground dark:prose-invert" dangerouslySetInnerHTML={{ __html: viewBodyHtml }} />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button onClick={buildSuggestion} variant="secondary" className="rounded-full">
                    <Sparkles data-icon="inline-start" />
                    Sugerir respuesta
                  </Button>
                </div>

                {suggestion && (
                  <div className="mt-4 rounded-[24px] border border-border/60 bg-muted/25 p-4 shadow-[0_14px_40px_-34px_rgba(15,23,42,0.22)]">
                    <div className="flex items-start gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Sparkles className="size-4.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground">Borrador sugerido</div>
                        <p className="mt-2 text-sm italic leading-6 text-muted-foreground">{suggestion}</p>
                      </div>
                      <Button size="sm" variant="ghost" className="rounded-full" onClick={() => navigator.clipboard.writeText(suggestion)}>
                        Copiar
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <aside className="border-t border-border/60 bg-muted/10 px-6 py-5 xl:border-l xl:border-t-0">
                <div className="space-y-4">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/80">Timeline</div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Eventos registrados para entender que pasó en el hilo antes de decidir el siguiente movimiento.
                    </p>
                  </div>

                  {viewTimeline.length > 0 ? (
                    <div className="space-y-3">
                      {viewTimeline.map((event) => (
                        <div key={event.id} className="rounded-[22px] border border-border/60 bg-background/80 p-4 shadow-[0_12px_30px_-26px_rgba(15,23,42,0.2)]">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="text-sm font-medium text-foreground">{formatTimelineLabel(event.event_type)}</div>
                              <div className="text-xs text-muted-foreground">{event.event_source || 'system'}</div>
                            </div>
                            <div className="text-right text-xs leading-5 text-muted-foreground">{new Date(event.event_at).toLocaleString('es-CL')}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[22px] border border-dashed border-border/70 bg-background/65 p-5 text-sm leading-6 text-muted-foreground">
                      Todavia no hay eventos adicionales registrados para esta vista.
                    </div>
                  )}
                </div>
              </aside>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent className="rounded-[28px] border-border/60 bg-background/95 shadow-[0_24px_80px_-46px_rgba(15,23,42,0.36)] backdrop-blur-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar lead y todo su rastro</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete
                ? `Se eliminará el historial de ${toDelete.name || toDelete.email} en Contactados, Guardados, Enriquecidos y Reportes. Esta acción no se puede deshacer.`
                : 'Esta acción no se puede deshacer.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setToDelete(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={performDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
