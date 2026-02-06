
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
import { Loader2, Trash2, Phone } from 'lucide-react';
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

  const handleViewPhoneNotes = (item: ContactedLead) => {
    setViewSubject(item.subject || 'Llamada telefónica');

    // Extraer el resultado y las notas del subject
    const subjectParts = item.subject?.split(' - ') || [];
    const resultado = subjectParts[0] || item.subject;
    const notas = subjectParts.slice(1).join(' - ') || 'Sin notas adicionales';

    setViewBodyHtml(`
      <div style="padding: 0; font-family: system-ui, -apple-system, sans-serif;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 24px; border-radius: 12px 12px 0 0; color: white; margin: -20px -20px 20px -20px;">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
            </svg>
            <h2 style="margin: 0; font-size: 24px; font-weight: 600;">Detalles de la Llamada</h2>
          </div>
          <p style="margin: 0; opacity: 0.9; font-size: 14px;">${new Date(item.sentAt).toLocaleString('es-CL', { dateStyle: 'full', timeStyle: 'short' })}</p>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
          <div style="background: #f8fafc; padding: 16px; border-radius: 8px; border-left: 3px solid #3b82f6;">
            <div style="font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Lead</div>
            <div style="font-size: 16px; font-weight: 600; color: #1e293b; margin-bottom: 4px;">${item.name}</div>
            <div style="font-size: 14px; color: #64748b;">${item.email}</div>
          </div>
          
          <div style="background: #f8fafc; padding: 16px; border-radius: 8px; border-left: 3px solid #8b5cf6;">
            <div style="font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Empresa</div>
            <div style="font-size: 16px; font-weight: 600; color: #1e293b; margin-bottom: 4px;">${item.company || 'No especificada'}</div>
            <div style="font-size: 14px; color: #64748b;">${item.role || 'Cargo no especificado'}</div>
          </div>
        </div>
        
        <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 20px; border-radius: 12px; margin-bottom: 16px; box-shadow: 0 4px 6px rgba(16, 185, 129, 0.2);">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <div style="font-size: 14px; font-weight: 600; color: white; opacity: 0.9;">RESULTADO DE LA LLAMADA</div>
          </div>
          <div style="font-size: 18px; font-weight: 700; color: white; letter-spacing: 0.3px;">${resultado}</div>
        </div>
        
        <div style="background: white; border: 2px solid #e2e8f0; padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            <div style="font-size: 14px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Notas de la Llamada</div>
          </div>
          <div style="white-space: pre-wrap; line-height: 1.7; color: #1e293b; font-size: 15px; padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 4px solid #3b82f6;">${notas}</div>
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
        // Classify reply to decide campaign follow-up
        try {
          await fetch('/api/replies/classify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactedId: it.id, text: (best as any).snippet || (best as any).bodyPreview || '' }),
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
          try {
            await fetch('/api/replies/classify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contactedId: it.id, text: (best as any).snippet || (best as any).bodyPreview || '' }),
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
                        {it.provider === 'phone' ? (
                          <Badge className="bg-green-600 hover:bg-green-700">
                            <Phone className="h-3 w-3 mr-1" />
                            Llamada
                          </Badge>
                        ) : status === 'replied'
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
                        {it.provider === 'phone' ? (
                          <Button size="sm" variant="outline" onClick={() => handleViewPhoneNotes(it)}>
                            Ver notas
                          </Button>
                        ) : (
                          <>
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
                          </>
                        )}
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
