
'use client';
import { useEffect, useMemo, useState, useRef } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { localStorageService } from '@/lib/local-storage-service';
import type { Lead, EnrichedLead } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Download, Trash2 } from 'lucide-react';
import { toCsv, downloadCsv } from '@/lib/csv';
import { enrichedLeadsStorage } from '@/lib/enriched-leads-storage';
import DailyQuotaProgress from '@/components/quota/daily-quota-progress';
import * as Quota from '@/lib/quota-client';
import { getClientId } from '@/lib/client-id';
import { getQuotaTicket, setQuotaTicket } from '@/lib/quota-ticket';

const displayDomain = (url: string) => { try { const u = new URL(url.startsWith('http') ? url : `https://${url}`); return u.hostname.replace(/^www\./,''); } catch { return url.replace(/^https?:\/\//,'').replace(/^www\./,''); } };
const asHttp = (url: string) => url.startsWith('http') ? url : `https://${url}`;

export default function SavedLeadsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [savedLeads, setSavedLeads] = useState<Lead[]>([]);
  const [selLead, setSelLead] = useState<Record<string, boolean>>({});
  const [enriching, setEnriching] = useState(false);

  useEffect(() => {
    // Carga inicial desde localStorage
    setSavedLeads(localStorageService.getLeads());
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
    const res = enrichedLeadsStorage.addDedup(moved);

    // 2) Dejar en guardados sólo los SIN email
    const remaining = savedLeads.filter(l => !l.email);
    localStorageService.setLeads(remaining);
    setSavedLeads(remaining);

    const addedCount = (res as any)?.addedCount ?? 0;
    if (addedCount > 0) {
      toast({
        title: 'Leads movidos a Enriquecidos',
        description: `Se movieron ${addedCount} lead(s) con email a la sección Enriquecidos.`,
      });
    }
  }, [savedLeads, toast]);

  function handleDeleteLead(id: string) {
    const ok = confirm('¿Eliminar este lead de Guardados?');
    if (!ok) return;
    // En tu proyecto existe deleteLead; si no, usa removeWhere
    const deleted = (localStorageService as any).deleteLead
      ? (localStorageService as any).deleteLead(id)
      : localStorageService.removeWhere((l: Lead) => l.id === id) > 0;

    if (deleted) {
      setSavedLeads(prev => prev.filter(l => l.id !== id));
      toast({ title: 'Eliminado', description: 'Se quitó el lead de Guardados.' });
    } else {
      toast({ variant:'destructive', title:'No se pudo eliminar' });
    }
  }

  const handleExportCsv = () => {
    const saved = localStorageService.getLeads();
  
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
  

  const pageLeads = savedLeads;
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

  async function enrichSelected() {
    const chosen = savedLeads.filter(l => selLead[l.id] && !l.email);
    if (chosen.length === 0) {
      toast({ title: 'Nada que enriquecer', description: 'Todos los seleccionados ya tienen email.' });
      return;
    }
    // Validación preventiva: necesitamos cupos para TODOS los seleccionados
    if (!Quota.canUseClientQuota('enrich', chosen.length)) {
      const { enrich: used = 0 } = Quota.getClientQuota() as any;
      const limit = Quota.getClientLimit('enrich');
      const remaining = Math.max(0, limit - (used || 0));
      toast({
        variant: 'destructive',
        title: 'Cupo insuficiente',
        description: `Seleccionaste ${chosen.length} lead(s) pero solo quedan ${remaining} cupo(s) hoy.`,
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
          clientRef: l.id, // <— correlación estable
        }));

      const r = await fetch('/api/opportunities/enrich-apollo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Identidad ligera para control de cuota en el backend:
          'x-user-id': clientId,
          'x-quota-ticket': getQuotaTicket() || '',
        },
        body: JSON.stringify({ leads: payloadLeads }),
      });
      const j = await r.clone().json().catch(async () => ({ nonJson: true, text: await r.text() }));
      if (!r.ok) {
        const snippet = (j as any)?.error || (j as any)?.message || (j as any)?.text || 'Error interno';
        throw new Error(`HTTP ${r.status}: ${String(snippet).slice(0, 200)}`);
      }
      // Actualiza quota-ticket si viene
      const ticket = (j as any)?.ticket || r.headers.get('x-quota-ticket');
      if (ticket) setQuotaTicket(ticket);
      
      // === ACTUALIZAR CUOTA LOCAL EN PROPORCIÓN A LO REALMENTE ENRIQUECIDO ===
      // Preferimos un conteo explícito del backend si viene incluido.
      // Convención sugerida: j.usage.consumed (server-side). Fallback: j.enriched.length.
      const enrichedCountFromServer = Number(j?.usage?.consumed ?? 0);
      const enrichedCount =
        Number.isFinite(enrichedCountFromServer) && enrichedCountFromServer > 0
          ? enrichedCountFromServer
          : Array.isArray(j?.enriched)
            ? j.enriched.length
            : 0;
      if (enrichedCount > 0) {
        Quota.incClientQuota('enrich', enrichedCount);
      }

      // ← NO confiar en el orden: mapear por clientRef
      const byRef = new Map(payloadLeads.map(pl => [pl.clientRef, pl]));
      const enrichedNow: EnrichedLead[] = (j.enriched || []).map((e: any) => {
        const sourceLead = byRef.get(e?.clientRef);
        // dominio desde website o email si el actor no lo trae
        const domainFromEmail = sourceLead?.email?.includes('@')
          ? sourceLead.email!.split('@')[1].toLowerCase()
          : undefined;
        const domainFromWebsite = sourceLead?.companyWebsite
          ? (sourceLead.companyWebsite.startsWith('http')
              ? new URL(sourceLead.companyWebsite).hostname
              : sourceLead.companyWebsite)
              .replace(/^https?:\/\//,'').replace(/^www\./,'')
          : undefined;

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
          createdAt: e.createdAt,
        };
      });

      // 1) Añadir a Enriquecidos (dedupe)
      const addRes = enrichedLeadsStorage.addDedup(enrichedNow);

      // 2) Remover de Guardados los que se enriquecieron con email
      //    (usamos el mapping por índice chosen[i] -> enrichedNow[i])
      const toRemoveIds = new Set<string>();
      for (let i = 0; i < enrichedNow.length; i++) {
        const enriched = enrichedNow[i];
        const src = chosen[i];
        if (enriched?.email && src?.id) toRemoveIds.add(src.id);
      }

      const removedCount = toRemoveIds.size > 0
        ? localStorageService.removeWhere(l => toRemoveIds.has(l.id))
        : 0;

      // 3) Actualizar estado en memoria
      setSavedLeads(prev => prev.filter(l => !toRemoveIds.has(l.id)));
      setSelLead({});

      // 4) Feedback
      const movedCount =
        (addRes as any)?.addedCount ??
        enrichedNow.filter(x => !!x.email).length;

      toast({
        title: 'Enriquecimiento listo',
        description: `Movidos a Enriquecidos: ${movedCount} · Quitados de Guardados: ${removedCount} · Cuota +${enrichedCount}`,
      });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message || 'Ocurrió un error' });
    } finally {
      setEnriching(false);
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
          <div className="flex gap-2">
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
              onClick={enrichSelected}
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
                    <TableCell className="text-right">
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
    </div>
  );
}
