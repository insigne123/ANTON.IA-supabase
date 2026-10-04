'use client';

// «Campañas anteriores» (Plan 9, PR-17): a read-only archive of the sequences made with the earlier flow. Their automation
// only checks eligibility (process-campaigns always runs as a dry run) and never sends, so the old editor's «Activar»,
// «Enviar por Gmail/Outlook» and preview buttons did nothing. To write to a group now: «Campañas masivas» (/campaigns).
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Archive, Eye, Trash2 } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { useConfirm } from '@/components/confirm-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { campaignArchiveMetrics, campaignArchiveTypeLabel, campaignRunLabel, type CampaignArchiveMetrics } from '@/lib/campaign-archive';
import { formatDate, formatDateTime } from '@/lib/dates';
import { stripHtmlToText } from '@/lib/email-outbound';
import { campaignsStorage, type Campaign } from '@/lib/services/campaigns-service';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import type { CampaignType } from '@/lib/campaign-settings';
import type { ContactedLead } from '@/lib/types';

type TypeFilter = 'all' | CampaignType;
const FILTERS: Array<[TypeFilter, string]> = [['all', 'Todas'], ['reconnection', 'Reconexión'], ['follow_up', 'Seguimiento']];
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const EMPTY_METRICS: CampaignArchiveMetrics = { sent: 0, opened: 0, replied: 0, clicked: 0 };

function Results({ metrics }: { metrics: CampaignArchiveMetrics }) {
  const items: Array<[string, number]> = [['Enviados', metrics.sent], ['Aperturas', metrics.opened], ['Respuestas', metrics.replied], ['Clics', metrics.clicked]];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-xl border bg-muted/30 px-3 py-2">
          <dt className="text-xs text-foreground/70">{label}</dt>
          <dd className="text-lg font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function CampaignsArchivePage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { user, loading: authLoading } = useAuth();
  const [items, setItems] = useState<Campaign[]>([]);
  const [contacted, setContacted] = useState<ContactedLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TypeFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    try {
      const [campaigns, leads] = await Promise.all([campaignsStorage.get(), contactedLeadsStorage.get()]);
      setItems(campaigns);
      setContacted(leads);
    } catch (error) {
      setLoadError(error instanceof Error && error.message ? error.message : 'No se pudieron cargar las campañas.');
    } finally {
      setLoading(false);
    }
  }, [authLoading, user]);

  useEffect(() => { void load(); }, [load]);

  const metrics = useMemo(() => campaignArchiveMetrics(items, contacted), [contacted, items]);
  const counts = useMemo(() => ({
    all: items.length,
    reconnection: items.filter((campaign) => campaign.campaignType === 'reconnection').length,
    follow_up: items.filter((campaign) => campaign.campaignType === 'follow_up').length,
  }), [items]);
  const listed = useMemo(() => items.filter((campaign) => filter === 'all' || campaign.campaignType === filter), [filter, items]);
  const opened = items.find((campaign) => campaign.id === openId) || null;

  async function remove(campaign: Campaign) {
    const ok = await confirm({
      title: `¿Eliminar «${campaign.name}»?`,
      description: 'Se borra del archivo con sus pasos. Tus contactos y sus conversaciones no cambian.',
      confirmLabel: 'Eliminar',
      tone: 'danger',
    });
    if (!ok) return;
    setDeleting(campaign.id);
    try {
      const removed = await campaignsStorage.remove(campaign.id);
      if (removed <= 0) throw new Error('La campaña no se pudo eliminar.');
      setItems((current) => current.filter((item) => item.id !== campaign.id));
      setOpenId((current) => (current === campaign.id ? null : current));
      toast({ title: 'Campaña eliminada', description: `«${campaign.name}» ya no está en el archivo.` });
    } catch (error) {
      toast({ variant: 'destructive', title: 'No se pudo eliminar', description: error instanceof Error && error.message ? error.message : 'Inténtalo de nuevo.' });
    } finally {
      setDeleting(null);
    }
  }

  const summaryLine = (campaign: Campaign) => `${campaignArchiveTypeLabel(campaign.campaignType)} · ${plural(campaign.steps.length, 'paso', 'pasos')}`;
  const resultLine = (campaign: Campaign) => {
    const value = metrics[campaign.id] || EMPTY_METRICS;
    return value.sent ? `${plural(value.sent, 'enviado', 'enviados')} · ${plural(value.replied, 'respuesta', 'respuestas')}` : 'Sin envíos';
  };
  const actions = (campaign: Campaign) => (
    <div className="flex items-center justify-end gap-1.5">
      <Button size="sm" variant="outline" onClick={() => setOpenId(campaign.id)} aria-label={`Ver «${campaign.name}»`}>
        <Eye className="h-4 w-4" aria-hidden="true" /> Ver
      </Button>
      <Button size="icon" variant="ghost" disabled={deleting === campaign.id} onClick={() => void remove(campaign)} aria-label={`Eliminar «${campaign.name}»`}>
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader
        title="Campañas anteriores"
        count={loading ? null : items.length}
        back={{ href: '/campaigns', label: 'Campañas' }}
        description="Las secuencias que creaste con el flujo anterior, para consultarlas."
      />

      <Alert variant="info" role="status">
        <Archive className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>Archivo de solo lectura</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>Estas campañas ya no envían correos. Para escribir a un grupo, crea una campaña masiva: se aprueba una vez y cada seguimiento se detiene si la persona responde.</span>
          <Button asChild size="sm" variant="outline" className="shrink-0"><Link href="/campaigns">Ir a Campañas</Link></Button>
        </AlertDescription>
      </Alert>

      {loadError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>No pudimos cargar tus campañas</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>Reintentar</Button>
          </AlertDescription>
        </Alert>
      ) : loading ? (
        <p role="status" className="py-10 text-center text-sm text-foreground/70">Cargando campañas…</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="No tienes campañas anteriores"
          description="Las campañas nuevas se crean y se siguen en «Campañas»."
          action={<Button asChild><Link href="/campaigns">Ir a Campañas</Link></Button>}
        />
      ) : (
        <section aria-label="Campañas anteriores" className="space-y-3">
          <div role="group" aria-label="Filtrar por tipo" className="flex flex-wrap gap-1.5">
            {FILTERS.map(([value, label]) => (
              <Button key={value} size="sm" variant={filter === value ? 'secondary' : 'ghost'} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label} <span className="tabular-nums text-foreground/70">{counts[value]}</span>
              </Button>
            ))}
          </div>

          {listed.length === 0 ? (
            <EmptyState
              headingLevel="h3"
              icon={Archive}
              title="No hay campañas de este tipo"
              description="Cambia el filtro para ver las demás."
              action={<Button variant="outline" onClick={() => setFilter('all')}>Ver todas</Button>}
            />
          ) : (
            <>
              <ul className="space-y-2 lg:hidden" aria-label="Lista de campañas anteriores">
                {listed.map((campaign) => (
                  <li key={campaign.id} className="rounded-xl border bg-card p-4">
                    <p className="break-words font-medium">{campaign.name}</p>
                    <p className="mt-0.5 text-sm text-foreground/70">{summaryLine(campaign)}</p>
                    <p className="mt-2 text-sm">{resultLine(campaign)}</p>
                    <p className="text-xs text-foreground/70">{campaignRunLabel(campaign.lastRunStatus)} · {campaign.lastRunAt ? formatDateTime(campaign.lastRunAt) : 'nunca'}</p>
                    <div className="mt-3">{actions(campaign)}</div>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-hidden rounded-xl border lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-foreground/70">Campaña</TableHead>
                      <TableHead className="text-foreground/70">Resultado</TableHead>
                      <TableHead className="text-foreground/70">Última revisión</TableHead>
                      <TableHead className="text-right text-foreground/70">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listed.map((campaign) => (
                      <TableRow key={campaign.id}>
                        <TableCell>
                          <span className="block max-w-[420px] break-words font-medium">{campaign.name}</span>
                          <span className="text-xs text-foreground/70">{summaryLine(campaign)} · creada el {formatDate(campaign.createdAt, { year: true })}</span>
                        </TableCell>
                        <TableCell className="text-sm">{resultLine(campaign)}</TableCell>
                        <TableCell>
                          <span className="block text-sm">{campaignRunLabel(campaign.lastRunStatus)}</span>
                          <span className="text-xs text-foreground/70">{campaign.lastRunAt ? formatDateTime(campaign.lastRunAt) : 'Nunca'}</span>
                        </TableCell>
                        <TableCell>{actions(campaign)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </section>
      )}

      <Sheet open={Boolean(opened)} onOpenChange={(open) => { if (!open) setOpenId(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {opened ? (
            <>
              <SheetHeader>
                <SheetTitle className="break-words pr-6">{opened.name}</SheetTitle>
                <SheetDescription>{summaryLine(opened)} · creada el {formatDate(opened.createdAt, { year: true })}</SheetDescription>
              </SheetHeader>
              <div className="mt-5 space-y-5">
                <section aria-labelledby="archive-results" className="space-y-2">
                  <h3 id="archive-results" className="text-sm font-semibold">Resultados</h3>
                  <Results metrics={metrics[opened.id] || EMPTY_METRICS} />
                </section>
                <section aria-labelledby="archive-steps" className="space-y-2">
                  <h3 id="archive-steps" className="text-sm font-semibold">Pasos</h3>
                  <ol className="space-y-2">
                    {opened.steps.map((step, index) => (
                      <li key={step.id || index} className="space-y-1.5 rounded-xl border bg-background p-4">
                        <p className="flex flex-wrap items-center gap-2 text-xs text-foreground/70">
                          <Badge variant="neutral">Paso {index + 1}</Badge>
                          {index === 0 ? `Día ${step.offsetDays}` : `${plural(step.offsetDays, 'día', 'días')} después del anterior`}
                          {step.attachments?.length ? ` · ${plural(step.attachments.length, 'adjunto', 'adjuntos')}` : ''}
                        </p>
                        <p className="break-words font-medium">{step.subject || 'Sin asunto'}</p>
                        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground/80">{stripHtmlToText(step.bodyHtml) || 'Sin contenido'}</p>
                      </li>
                    ))}
                  </ol>
                </section>
                <div className="flex justify-end">
                  <Button variant="outline" className="text-destructive" disabled={deleting === opened.id} onClick={() => void remove(opened)}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> Eliminar del archivo
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
