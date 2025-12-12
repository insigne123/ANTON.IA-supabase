
'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { graphFindReadReceipts, graphFindReplies, graphGetMessage } from '@/lib/outlook-graph-client';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { deleteContactedCascade } from '@/lib/delete-contacted-cascade';
import { Loader2, Trash2 } from 'lucide-react';
import type { ContactedLead } from '@/lib/types';
import Link from 'next/link';
import { openSentMessageFor } from '@/lib/open-sent-message';
import DailyQuotaProgress from '@/components/quota/daily-quota-progress';
import { gmailClient } from '@/lib/gmail-client';

export default function ContactedPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<ContactedLead[]>([]);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewSubject, setViewSubject] = useState('');
  const [viewBodyHtml, setViewBodyHtml] = useState('');
  const [viewWebLink, setViewWebLink] = useState<string | undefined>(undefined);
  const [toDelete, setToDelete] = useState<ContactedLead | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [suggestion, setSuggestion] = useState<string>('');

  const refresh = async () => setItems(await contactedLeadsStorage.get());
  useEffect(() => { refresh(); }, []);

  const rows = useMemo(() => {
    // Mostrar los NO respondidos; orden por lastUpdateAt desc (fallback sentAt)
    return items
      .filter(x => x.status !== 'replied')
      .sort((a, b) => {
        const da = new Date(a.lastUpdateAt || a.sentAt).getTime();
        const db = new Date(b.lastUpdateAt || b.sentAt).getTime();
        return db - da;
      });
  }, [items]);

  const handleViewEmail = async (item: ContactedLead) => {
    try {
      await openSentMessageFor(item);
    } catch (e: any) {
      toast({
        variant: 'destructive',
        title: 'No se pudo abrir el email',
        description: e?.message || 'Asegúrate de que la sesión esté activa y los permisos sean correctos.',
      });
    }
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

        await contactedLeadsStorage.upsertByMessageId(it.messageId!, {
          status: 'replied',
          replyMessageId: best.id,
          replySubject: best.subject,
          replyPreview: (best as any).snippet || (best as any).bodyPreview || '',
          repliedAt: repliedAtDate.toISOString(),
        });
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
    // 1. Check for LinkedIn Reply
    if (it.provider === 'linkedin' && it.status === 'replied') {
      const replyText = it.lastReplyText || it.replyPreview || '(Sin contenido de respuesta capturado)';
      setViewSubject('Respuesta de LinkedIn');
      setViewBodyHtml(`<p>${replyText}</p>`);
      setViewWebLink(it.linkedinThreadUrl || '#');
      setViewOpen(true);
      return;
    }

    // 2. Existing checks for Email
    const replyId = (it as any).replyMessageId as string | undefined;
    if (!replyId) {
      toast({ variant: 'destructive', title: 'Sin respuesta', description: 'Primero verifica si hay respuesta.' });
      return;
    }
    setViewLoading(true);
    try {
      // Aquí necesitaríamos una lógica similar a la de handleVerifyReply para saber si llamar a graph o a gmail
      // Por ahora, asumimos que si hay replyMessageId, es de Outlook.
      const data = await graphGetMessage(replyId);
      setViewSubject(data?.subject || '(respuesta)');
      setViewBodyHtml(data?.body?.content || '<p>(Sin contenido)</p>');
      setViewWebLink(data?.webLink);
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

          await contactedLeadsStorage.upsertByMessageId(it.messageId!, {
            status: 'replied',
            replyMessageId: best.id,
            replySubject: best.subject,
            replyPreview: (best as any).snippet || (best as any).bodyPreview || '',
            repliedAt: repliedAtDate.toISOString(),
          } as any);
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
        description="Historial de correos enviados, aperturas y respuestas."
      />
      <div className="mb-4">
        <DailyQuotaProgress kinds={['contact']} compact />
      </div>
      <div className="mb-3 flex items-center gap-2">
        <Button variant="secondary" onClick={verifyAllReplies} disabled={bulkRunning}>
          {bulkRunning ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verificando… {bulkProgress.done}/{bulkProgress.total}</> : 'Verificar respuestas (todos)'}
        </Button>
        <Button variant="outline" onClick={verifyAllReads} disabled={bulkRunning}>
          Verificar aperturas (todos)
        </Button>
        <Link href="/contacted/replied">
          <Button variant="outline">Ver respondidos</Button>
        </Link>
        <Link href="/contacted/analytics">
          <Button variant="default">Ver Analítica</Button>
        </Link>
      </div>

      <Card>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Asunto</TableHead>
                  <TableHead>Fecha envío</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((it) => {
                  const name = it.name || '';
                  const email = it.email || '';
                  const company = it.company || '';
                  const sentAt = it.sentAt ? new Date(it.sentAt).toLocaleString() : '';
                  const status = it.status || 'sent';
                  const canVerifyRead = it.provider === 'outlook' && !!it.internetMessageId;
                  const canVerifyReply = (it.provider === 'outlook' && !!it.conversationId) || (it.provider === 'gmail' && !!it.threadId);
                  const hasReply = Boolean((it as any).replyMessageId);

                  return (
                    <TableRow key={it.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{name || email}</span>
                          <span className="text-xs text-muted-foreground">{email}</span>
                        </div>
                      </TableCell>
                      <TableCell>{company}</TableCell>
                      <TableCell className="max-w-[420px] truncate">{it.subject}</TableCell>
                      <TableCell>{sentAt}</TableCell>
                      <TableCell>
                        {status === 'replied'
                          ? <Badge variant="default">Respondido</Badge>
                          : (it.clickCount && it.clickCount > 0)
                            ? <Badge className="bg-blue-600 hover:bg-blue-700">Clickeado ({it.clickCount})</Badge>
                            : it.openedAt
                              ? <Badge variant="default">Abierto</Badge>
                              : it.deliveredAt
                                ? <Badge variant="outline">Entregado</Badge>
                                : <Badge variant="secondary">No abierto</Badge>}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button size="sm" variant="outline" onClick={() => handleViewEmail(it)}>
                          Ver email
                        </Button>
                        <Button size="sm" variant="secondary" disabled={!canVerifyRead} onClick={() => handleVerifyRead(it)}>
                          Verificar lectura
                        </Button>
                        <Button size="sm" disabled={!canVerifyReply} onClick={() => handleVerifyReply(it)}>
                          Verificar respuesta
                        </Button>
                        <Button size="sm" variant="outline" disabled={!hasReply} onClick={() => handleViewReply(it)}>
                          Ver respuesta
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="destructive" onClick={() => confirmDelete(it)}>
                              <Trash2 className="h-4 w-4 mr-1" /> Eliminar
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Eliminar lead y todo su rastro</AlertDialogTitle>
                              <AlertDialogDescription>
                                Se eliminará de Contactados, Guardados, Enriquecidos y Reportes. Esta acción no se puede deshacer.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel onClick={() => setToDelete(null)}>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={performDelete}>Eliminar</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-10">
                      No hay enviados pendientes. Revisa los <Link className="underline" href="/contacted/replied">respondidos</Link>.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{viewSubject}</DialogTitle></DialogHeader>
          {viewLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Cargando…</div>
          ) : (
            <>
              <div className="prose prose-sm max-w-none mb-4" dangerouslySetInnerHTML={{ __html: viewBodyHtml }} />
              <div className="flex gap-2 mt-4">
                {viewWebLink && (
                  <a href={viewWebLink} target="_blank" rel="noopener noreferrer" className="underline text-sm btn btn-outline">
                    Abrir original
                  </a>
                )}
                <Button onClick={() => setSuggestion("¡Gracias por tu respuesta! Me gustaría agendar una llamada cortal...")} variant="secondary">
                  💡 Generar Respuesta con IA (Simulado)
                </Button>
              </div>
              {suggestion && (
                <div className="mt-4 p-4 bg-muted rounded-md relative">
                  <p className="text-sm italic">{suggestion}</p>
                  <Button size="sm" variant="ghost" className="absolute top-2 right-2" onClick={() => navigator.clipboard.writeText(suggestion)}>Copiar</Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
