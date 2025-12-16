'use client';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { supabaseService } from '@/lib/supabase-service';
import type { Lead, EnrichedLead } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Download, Trash2, MessageSquare } from 'lucide-react';
import { toCsv, downloadCsv } from '@/lib/csv';
import { enrichedLeadsStorage } from '@/lib/services/enriched-leads-service';
import DailyQuotaProgress from '@/components/quota/daily-quota-progress';
import * as Quota from '@/lib/quota-client';
import { getClientId } from '@/lib/client-id';
import { getQuotaTicket, setQuotaTicket } from '@/lib/quota-ticket';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { CommentsSection } from '@/components/comments-section';
import { EnrichmentOptionsDialog } from '@/components/enrichment/enrichment-options-dialog';

const displayDomain = (url: string) => { try { const u = new URL(url.startsWith('http') ? url : `https://${url}`); return u.hostname.replace(/^www\./, ''); } catch { return url.replace(/^https?:\/\//, '').replace(/^www\./, ''); } };
const asHttp = (url: string) => url.startsWith('http') ? url : `https://${url}`;

export default function SavedLeadsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { user } = useAuth();
  const [savedLeads, setSavedLeads] = useState<Lead[]>([]);
  const [selLead, setSelLead] = useState<Record<string, boolean>>({});
  const [enriching, setEnriching] = useState(false);
  const [showOnlyMyLeads, setShowOnlyMyLeads] = useState(false);
  const [selectedLeadForComments, setSelectedLeadForComments] = useState<Lead | null>(null);

  // Dialog state
  const [enrichOptionsOpen, setEnrichOptionsOpen] = useState(false);
  const [leadsToEnrich, setLeadsToEnrich] = useState<Lead[]>([]);

  useEffect(() => {
    // Carga inicial desde Supabase
    supabaseService.getLeads().then(setSavedLeads);
  }, []);

  // Efecto de migración: se ejecuta cuando savedLeads cambia
  useEffect(() => {
    const withEmail = savedLeads.filter(l => !!l.email);
    if (withEmail.length === 0) {
      return; // Nada que migrar
    }

    // 1) Mover a enriquecidos (dedupe)
    const moved: EnrichedLead[] = withEmail.map<EnrichedLead>(l => ({
      id: l.id,
      fullName: l.name,
      title: l.title,
      email: l.email ?? undefined,
      emailStatus: 'verified',
      linkedinUrl: l.linkedinUrl || undefined,
      companyName: l.company || undefined,
      companyDomain: l.companyWebsite ? displayDomain(l.companyWebsite) : undefined,
      country: l.country || undefined,
      city: l.city || undefined,
      industry: l.industry || undefined,
      createdAt: new Date().toISOString(),
    }));

    // Usamos una función asíncrona autoejecutable para poder usar await si fuera necesario,
    // aunque en useEffect no se recomienda await directo.
    // En este caso, enrichedLeadsStorage.addDedup es async.
    enrichedLeadsStorage.addDedup(moved).then((res) => {
      // 2) Dejar en guardados sólo los SIN email
      // En Supabase, eliminamos los que tienen email
      supabaseService.removeWhere(l => !!l.email).then(() => {
        const remaining = savedLeads.filter(l => !l.email);
        setSavedLeads(remaining);
      });

      const addedCount = (res as any)?.addedCount ?? 0;
      if (addedCount > 0) {
        toast({
          title: 'Leads movidos a Enriquecidos',
          description: `Se movieron ${addedCount} lead(s) con email a la sección Enriquecidos.`,
        });
      }
    });
  }, [savedLeads, toast]);

  async function handleDeleteLead(id: string) {
    const ok = confirm('¿Eliminar este lead de Guardados?');
    if (!ok) return;

    const deletedCount = await supabaseService.removeWhere((l: Lead) => l.id === id);

    if (deletedCount > 0) {
      setSavedLeads(prev => prev.filter(l => l.id !== id));
      toast({ title: 'Eliminado', description: 'Se quitó el lead de Guardados.' });
    } else {
      toast({ variant: 'destructive', title: 'No se pudo eliminar' });
    }
  }

  const handleExportCsv = async () => {
    // Usar estado local o volver a pedir
    const saved = savedLeads;

    // Encabezados como texto (no objetos)
    const headers: string[] = [
      'ID',
      'Nombre',
      'Cargo',
      'Empresa',
      'Email',
      'LinkedIn',
      'Web Empresa',
      'LinkedIn Empresa',
      'Ubicación',
      'Industria',
      'Estado',
    ];

    // Filas como (string | number)[] (no objetos)
    const rows: (string | number)[][] = saved.map((l) => ([
      l.id || '',
      l.name || '',
      l.title || '',
      l.company || '',
      l.email || '',
      (l as any).linkedinUrl || '',
      (l as any).companyWebsite || '',
      (l as any).companyLinkedin || '',
      l.location || '',
      l.industry || '',
      l.status || '',
    ]));

    const csv = toCsv(rows, headers);
    downloadCsv(`leads_${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  const filteredLeads = useMemo(() => {
    if (!showOnlyMyLeads || !user) return savedLeads;
    return savedLeads.filter(l => l.userId === user.id);
  }, [savedLeads, showOnlyMyLeads, user]);

  const pageLeads = filteredLeads;

  const allPageLeadsChecked = useMemo(
    () =>
      pageLeads.length > 0 &&
      pageLeads.filter(l => !l.email).every(l => selLead[l.id]),
    [pageLeads, selLead]
  );

  const toggleAllLeads = (checked: boolean) => {
    if (!checked) return setSelLead({});
    const next: Record<string, boolean> = {};
    pageLeads.filter(l => !l.email).forEach(l => (next[l.id] = true));
    setSelLead(next);
  };

  function initiateEnrichSelected() {
    const chosen = savedLeads.filter(l => selLead[l.id] && !l.email);
    if (chosen.length === 0) {
      toast({ title: 'Nada que enriquecer', description: 'Todos los seleccionados ya tienen email.' });
      return;
    }
    setLeadsToEnrich(chosen);
    setEnrichOptionsOpen(true);
  }

  async function handleConfirmEnrich(opts: { revealEmail: boolean; revealPhone: boolean }) {
    const { revealEmail, revealPhone } = opts;
    const chosen = leadsToEnrich;

    // Validación preventiva de cuota (approx)
    const costPerLead = (revealEmail ? 1 : 0) + (revealPhone ? 1 : 0);
    const totalCost = costPerLead * chosen.length;

    if (!Quota.canUseClientQuota('enrich', totalCost)) {
      const { enrich: used = 0 } = Quota.getClientQuota() as any;
      const limit = Quota.getClientLimit('enrich');
      const remaining = Math.max(0, limit - (used || 0));
      toast({
        variant: 'destructive',
        title: 'Cupo insuficiente',
        description: `Requieres ${totalCost} cupos pero solo quedan ${remaining}.`,
      });
      return;
    }

    setEnriching(true);
    try {
      const clientId = getClientId();
      const payloadLeads = chosen.map(l => ({
        fullName: l.name,
        linkedinUrl: l.linkedinUrl || undefined,
        companyName: l.company || undefined,
        companyDomain: l.companyWebsite ? displayDomain(l.companyWebsite) : undefined,
        clientRef: l.id,
      }));

      const r = await fetch('/api/opportunities/enrich-apollo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': clientId,
          'x-quota-ticket': getQuotaTicket() || '',
        },
        body: JSON.stringify({ leads: payloadLeads, revealEmail, revealPhone }),
      });
      const j = await r.clone().json().catch(async () => ({ nonJson: true, text: await r.text() }));
      console.log('[enrich] Response:', j);

      if (!r.ok) {
        const snippet = (j as any)?.error || (j as any)?.message || (j as any)?.text || 'Error interno';
        throw new Error(`HTTP ${r.status}: ${String(snippet).slice(0, 200)}`);
      }

      // Check for server-side quota limit note
      if (j.note && typeof j.note === 'string' && j.note.includes('Quota')) {
        toast({ variant: 'destructive', title: 'Límite diario alcanzado', description: j.note });
        // We can still process what resulted (if any), but warn the user.
      }

      // Actualiza quota-ticket si viene
      const ticket = (j as any)?.ticket || r.headers.get('x-quota-ticket');
      if (ticket) setQuotaTicket(ticket);

      // Actualizar Cuota
      const enrichedCountFromServer = Number(j?.usage?.consumed ?? 0);
      if (enrichedCountFromServer > 0) {
        Quota.incClientQuota('enrich', enrichedCountFromServer);
      }

      // Procesar respuesta
      const byRef = new Map(chosen.map(l => [l.id, l]));
      const enrichedNow: EnrichedLead[] = (j.enriched || []).map((e: any) => {
        const sourceLead = byRef.get(e?.clientRef);
        const domainFromEmail = sourceLead?.email?.includes('@')
          ? sourceLead.email!.split('@')[1].toLowerCase()
          : undefined;
        const domainFromWebsite = sourceLead?.companyWebsite
          ? (sourceLead.companyWebsite.startsWith('http')
            ? new URL(sourceLead.companyWebsite).hostname
            : sourceLead.companyWebsite)
            .replace(/^https?:\/\//, '').replace(/^www\./, '')
          : undefined;

        // Aseguramos que phoneNumbers y primaryPhone se pasen
        return {
          id: e.id,
          fullName: e.fullName,
          title: e.title,
          email: e.email,
          emailStatus: e.emailStatus || 'unknown',
          linkedinUrl: e.linkedinUrl,
          companyName: e.companyName ?? sourceLead?.company,
          companyDomain: e.companyDomain ?? domainFromWebsite ?? domainFromEmail,
          country: sourceLead?.country,
          city: sourceLead?.city,
          industry: sourceLead?.industry,
          phoneNumbers: e.phoneNumbers,
          primaryPhone: e.primaryPhone,
        };
      });

      console.log('[enrich] Enriched Now (raw):', enrichedNow);

      // 1) Filtrar y Añadir a Enriquecidos
      // Solo guardamos si encontramos ALGO (email o teléfono de cualquier tipo)
      const usefulEnriched = enrichedNow.filter(e =>
        e.email ||
        e.primaryPhone ||
        (e.phoneNumbers && Array.isArray(e.phoneNumbers) && e.phoneNumbers.length > 0)
      );

      let addRes: any = { addedCount: 0 };
      if (usefulEnriched.length > 0) {
        addRes = await enrichedLeadsStorage.addDedup(usefulEnriched);
      } else {
        // Feedback si no se encontró nada útil
        if (chosen.length === 1) {
          toast({ variant: 'default', title: 'Sin datos nuevos', description: 'Apollo no encontró email ni teléfono para este lead.' });
        }
      }

      // 2) Remover de Guardados si obtuvimos ID de contacto (email o telefono)
      const toRemoveIds = new Set<string>();
      for (let i = 0; i < enrichedNow.length; i++) {
        const enriched = enrichedNow[i];
        const src = chosen[i];
        if ((enriched?.email || enriched?.primaryPhone) && src?.id) {
          toRemoveIds.add(src.id);
        }
      }

      const removedCount = toRemoveIds.size > 0
        ? await supabaseService.removeWhere(l => toRemoveIds.has(l.id))
        : 0;

      // 3) Refrescar UI
      setSavedLeads(prev => prev.filter(l => !toRemoveIds.has(l.id)));
      setSelLead({});

      toast({
        title: 'Enriquecimiento listo',
        description: `Movidos: ${removedCount}. Cuota consumida: ${enrichedCountFromServer}`,
      });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message || 'Ocurrió un error' });
    } finally {
      setEnriching(false);
      setEnrichOptionsOpen(false);
      setLeadsToEnrich([]);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Guardados · Leads"
        description="Administra y enriquece tus leads guardados para prepararlos para la investigación y el contacto."
      />

      <div className="mb-4">
        <DailyQuotaProgress kinds={['enrich']} compact />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Leads guardados</CardTitle>
            <CardDescription>Selecciona los que no tienen email para enriquecerlos.</CardDescription>
          </div>
          <div className="flex gap-2 items-center">
            <div className="flex items-center space-x-2 mr-4">
              <Switch id="my-leads" checked={showOnlyMyLeads} onCheckedChange={setShowOnlyMyLeads} />
              <Label htmlFor="my-leads">Solo mis leads</Label>
            </div>
            <Button variant="outline" onClick={handleExportCsv}>
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push('/saved/leads/enriched')}
            >
              Ver enriquecidos
            </Button>

            <Button
              variant="secondary"
              disabled={enriching || Object.values(selLead).every(v => !v)}
              onClick={initiateEnrichSelected}
            >
              {enriching ? 'Enriqueciendo…' : 'Enriquecer seleccionados'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allPageLeadsChecked}
                      onCheckedChange={v => toggleAllLeads(Boolean(v))}
                    />
                  </TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead>LinkedIn</TableHead>
                  <TableHead>Industria</TableHead>
                  <TableHead>País</TableHead>
                  <TableHead>Ciudad</TableHead>
                  <TableHead className="w-20 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageLeads.map(l => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <Checkbox
                        disabled={!!l.email}
                        checked={!!selLead[l.id]}
                        onCheckedChange={v => setSelLead(prev => ({ ...prev, [l.id]: Boolean(v) }))}
                        title={l.email ? 'Este lead ya tiene email' : ''}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={l.avatar} alt={l.name || 'lead'} />
                          <AvatarFallback>{(l.name || 'L').charAt(0)}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{l.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>{l.title || '—'}</TableCell>
                    <TableCell>{l.company || '—'}</TableCell>
                    <TableCell>{l.email || '—'}</TableCell>
                    <TableCell>
                      {l.companyWebsite ? (
                        <a className="underline" href={asHttp(l.companyWebsite)} target="_blank" rel="noreferrer">
                          {displayDomain(l.companyWebsite)}
                        </a>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      {l.linkedinUrl ? (
                        <a className="underline" href={l.linkedinUrl} target="_blank" rel="noreferrer">Perfil</a>
                      ) : (l.companyLinkedin ? <a className="underline" href={l.companyLinkedin} target="_blank" rel="noreferrer">Empresa</a> : '—')}
                    </TableCell>
                    <TableCell>{l.industry || '—'}</TableCell>
                    <TableCell>{l.country || '—'}</TableCell>
                    <TableCell>{l.city || '—'}</TableCell>
                    <TableCell className="text-right flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setSelectedLeadForComments(l)} title="Comentarios">
                        <MessageSquare className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => handleDeleteLead(l.id)} title="Eliminar">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Sheet open={!!selectedLeadForComments} onOpenChange={(open) => !open && setSelectedLeadForComments(null)}>
        <SheetContent className="w-[400px] sm:w-[540px] flex flex-col">
          <SheetHeader>
            <SheetTitle>Comentarios: {selectedLeadForComments?.name}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 mt-4 overflow-hidden">
            {selectedLeadForComments && (
              <CommentsSection entityType="lead" entityId={selectedLeadForComments.id} />
            )}
          </div>
        </SheetContent>
      </Sheet>
      <EnrichmentOptionsDialog
        open={enrichOptionsOpen}
        onOpenChange={setEnrichOptionsOpen}
        onConfirm={handleConfirmEnrich}
        loading={enriching}
        leadCount={leadsToEnrich.length}
      />
    </div>
  );
}
