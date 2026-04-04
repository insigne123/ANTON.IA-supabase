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
import { deleteContactedCascade } from '@/lib/delete-contacted-cascade';
import { Trash2 } from 'lucide-react';
import Link from 'next/link';
import type { ContactedLead } from '@/lib/types';
import { resolveReplyContent } from '@/lib/reply-content-resolver';
import { isHardNegativeReply } from '@/lib/reply-intent-rules';

export default function ContactedRepliedPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<ContactedLead[]>([]);
  const [open, setOpen] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [html, setHtml] = useState('');
  const [webLink, setWebLink] = useState<string | undefined>(undefined);
  const [suggestion, setSuggestion] = useState<string>('');

  const refresh = async () => setItems(await contactedLeadsStorage.get());
  useEffect(() => { refresh(); }, []);

  const rows = useMemo(() => {
    return items
      .filter(x => x.status === 'replied')
      .sort((a, b) => {
        const da = new Date(a.repliedAt || a.lastUpdateAt || a.sentAt).getTime();
        const db = new Date(b.repliedAt || b.lastUpdateAt || b.sentAt).getTime();
        return db - da; // más recientes primero
      });
  }, [items]);

  const intentLabel: Record<string, string> = {
    meeting_request: 'Reunion',
    positive: 'Positiva',
    negative: 'No interesado',
    unsubscribe: 'No contactar',
    auto_reply: 'Auto-reply',
    neutral: 'Neutral',
    unknown: 'Sin clasificar',
  };

  const getCampaignDecision = (it: ContactedLead) => {
    const replyText = [it.lastReplyText, it.replyPreview, it.replySummary].filter(Boolean).join(' ');
    const hardStop = isHardNegativeReply(replyText);
    if (it.campaignFollowupAllowed === false) return { label: 'No seguir', variant: 'destructive' as const };
    if (it.campaignFollowupAllowed === true) {
      return hardStop
        ? { label: 'No seguir', variant: 'destructive' as const }
        : { label: 'Continuar', variant: 'secondary' as const };
    }
    return hardStop
      ? { label: 'No seguir', variant: 'destructive' as const }
      : { label: 'Sin decision', variant: 'outline' as const };
  };

  async function viewReply(it: ContactedLead) {
    setViewLoading(true);
    try {
      const resolved = await resolveReplyContent(it);
      setTitle(resolved.subject || '(respuesta)');
      setHtml(resolved.html || '<p>(Sin contenido)</p>');
      setWebLink(resolved.webLink);
      setOpen(true);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e?.message || 'No se pudo cargar la respuesta' });
    } finally {
      setViewLoading(false);
    }
  }

  async function removeAll(it: ContactedLead) {
    const ok = confirm('Eliminar este hilo respondido y todo su rastro local?');
    if (!ok) return;
    const res = await deleteContactedCascade({
      leadId: it.leadId,
      email: it.email,
      messageId: it.messageId,
      conversationId: it.conversationId,
    });
    toast({ title: 'Eliminado', description: `Limpiezas → Contactados:${res.contacted} · Guardados:${res.saved} · Enriquecidos:${res.enriched} · Opps:${res.oppEnriched} · Reportes:${res.research}` });
    refresh();
  }

  return (
    <>
      <PageHeader
        title="Leads Respondidos"
        description="Hilos donde el contacto ya respondió. Ordenados por la respuesta más reciente."
      />
      <div className="mb-3"><Link href="/contacted"><Button variant="outline">← Volver a enviados</Button></Link></div>

      <Card>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Asunto</TableHead>
                  <TableHead>Respondido</TableHead>
                  <TableHead>Preview</TableHead>
                  <TableHead>Clasificacion</TableHead>
                  <TableHead>Intencion</TableHead>
                  <TableHead>Campana</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(it => (
                  <TableRow key={it.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{it.name || it.email}</span>
                        <span className="text-xs text-muted-foreground">{it.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>{it.company || '—'}</TableCell>
                    <TableCell className="max-w-[360px] truncate">{it.subject}</TableCell>
                    <TableCell>{it.repliedAt ? new Date(it.repliedAt).toLocaleString() : '—'}</TableCell>
                    <TableCell className="max-w-[420px] whitespace-normal break-words line-clamp-2">{(it as any).replyPreview || '—'}</TableCell>
                    <TableCell className="max-w-[260px] whitespace-normal break-words line-clamp-2">
                      {(it as any).replySummary || it.replyPreview || '—'}
                    </TableCell>
                    <TableCell>
                      {it.replyIntent ? (
                        <Badge variant={it.replyIntent === 'meeting_request' || it.replyIntent === 'positive' ? 'default' : it.replyIntent === 'negative' || it.replyIntent === 'unsubscribe' ? 'destructive' : 'secondary'}>
                          {intentLabel[it.replyIntent] || it.replyIntent}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">sin clasificar</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const decision = getCampaignDecision(it);
                        return <Badge variant={decision.variant}>{decision.label}</Badge>;
                      })()}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button size="sm" onClick={() => viewReply(it)}>Ver respuesta</Button>
                      <Button size="sm" variant="destructive" onClick={() => removeAll(it)}>
                        <Trash2 className="h-4 w-4 mr-1" /> Eliminar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-10">
                      Aún no hay respuestas. Vuelve a <Link className="underline" href="/contacted">Contactados</Link>.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-hidden flex flex-col">
          <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
          {viewLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Cargando…</div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="prose prose-sm max-w-none mb-4" dangerouslySetInnerHTML={{ __html: html }} />
              </div>
              <div className="flex gap-2 mt-4">
                {webLink && (
                  <a href={webLink} target="_blank" rel="noopener noreferrer" className="underline text-sm btn btn-outline">
                    Abrir original
                  </a>
                )}
                <Button onClick={() => setSuggestion("¡Hola! Gracias por tu interés. ¿Te parece si agendamos una llamada rápida el martes a las 10am?")} variant="secondary">
                  💡 Generar Respuesta con IA
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
