'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { contactedLeadsStorage } from '@/lib/contacted-leads-storage';
import { useToast } from '@/hooks/use-toast';
import { graphGetMessage } from '@/lib/outlook-graph-client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { deleteContactedCascade } from '@/lib/delete-contacted-cascade';
import { Trash2 } from 'lucide-react';
import Link from 'next/link';
import type { ContactedLead } from '@/lib/types';

export default function ContactedRepliedPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<ContactedLead[]>([]);
  const [open, setOpen] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [html, setHtml] = useState('');
  const [webLink, setWebLink] = useState<string | undefined>(undefined);

  const refresh = () => setItems(contactedLeadsStorage.get());
  useEffect(() => { refresh(); }, []);

  const rows = useMemo(() => {
    return contactedLeadsStorage.get()
      .filter(x => x.status === 'replied')
      .sort((a, b) => {
        const da = new Date(a.repliedAt || a.lastUpdateAt || a.sentAt).getTime();
        const db = new Date(b.repliedAt || b.lastUpdateAt || b.sentAt).getTime();
        return db - da; // más recientes primero
      });
  }, [items]);

  async function viewReply(it: ContactedLead) {
    const replyId = (it as any).replyMessageId as string | undefined;
    if (!replyId) {
      toast({ variant: 'destructive', title: 'Sin respuesta', description: 'No hay id de respuesta guardado.' });
      return;
    }
    setViewLoading(true);
    try {
      const data = await graphGetMessage(replyId);
      setTitle(data?.subject || '(respuesta)');
      setHtml(data?.body?.content || '<p>(Sin contenido)</p>');
      setWebLink(data?.webLink);
      setOpen(true);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e?.message || 'No se pudo cargar la respuesta' });
    } finally {
      setViewLoading(false);
    }
  }

  function removeAll(it: ContactedLead) {
    const ok = confirm('Eliminar este hilo respondido y todo su rastro local?');
    if (!ok) return;
    const res = deleteContactedCascade({
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
                    <TableCell className="max-w-[420px] truncate">{(it as any).replyPreview || '—'}</TableCell>
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
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-10">
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
        <DialogContent className="max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
          {viewLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Cargando…</div>
          ) : (
            <>
              <div className="prose prose-sm max-w-none mb-4" dangerouslySetInnerHTML={{ __html: html }} />
              {webLink && (
                <a href={webLink} target="_blank" rel="noopener noreferrer" className="underline text-sm">
                  Abrir en Outlook
                </a>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
