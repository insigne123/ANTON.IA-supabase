
'use client';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { JobOpportunity, CompanyTarget, LeadFromApollo } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { savedOpportunitiesStorage } from '@/lib/services/opportunities-service';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import * as Quota from '@/lib/quota-client';
import { microsoftAuthService } from '@/lib/microsoft-auth-service';
import { parseJsonResponse } from '@/lib/http/safe-json';

import { enrichedLeadsStorage } from '@/lib/services/enriched-leads-service';
import { getClientId } from '@/lib/client-id';
import { getQuotaTicket, setQuotaTicket } from '@/lib/quota-ticket';

type SearchForm = {
  jobTitle: string;
  location: string;
  dateRange?: 'r86400' | 'r604800' | 'r2592000';
  rows?: number;
};

export default function OpportunitiesPage() {
  const { toast } = useToast();
  const [form, setForm] = useState<SearchForm>({ jobTitle: '', location: '' });
  const [loading, setLoading] = useState(false);
  const [opps, setOpps] = useState<JobOpportunity[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<Record<string, CompanyTarget>>({});
  const [openLeadModal, setOpenLeadModal] = useState(false);
  const [leadTitles, setLeadTitles] = useState('Head of Talent, HR Manager, Recruiting Lead');
  const [personLocations, setPersonLocations] = useState('');
  const [leads, setLeads] = useState<LeadFromApollo[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [selLeadIdx, setSelLeadIdx] = useState<Record<number, boolean>>({});
  const [enriching, setEnriching] = useState(false);

  const [selectedOppIds, setSelectedOppIds] = useState<Record<string, boolean>>({});
  const [contactedIds, setContactedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    contactedLeadsStorage.get().then(all => {
      const s = new Set<string>();
      all.forEach(c => {
        if (c.leadId) s.add(c.leadId);
        if (c.email) s.add(c.email);
      });
      setContactedIds(s);
    });
  }, []);
  const allSelected = useMemo(
    () => opps.length > 0 && opps.every(o => selectedOppIds[o.id]),
    [opps, selectedOppIds]
  );

  const toggleOpp = (id: string, checked: boolean) =>
    setSelectedOppIds(prev => ({ ...prev, [id]: checked }));

  const toggleSelectAll = (checked: boolean) => {
    if (!checked) return setSelectedOppIds({});
    const next: Record<string, boolean> = {};
    opps.forEach(o => (next[o.id] = true));
    setSelectedOppIds(next);
  };

  const saveSelected = async () => {
    const chosen = opps.filter(o => selectedOppIds[o.id]);
    if (chosen.length === 0) return;
    const { addedCount, duplicateCount } = await savedOpportunitiesStorage.addDedup(chosen);
    toast({ title: 'Vacantes guardadas', description: `Agregadas: ${addedCount} · Duplicados: ${duplicateCount}` });
  };

  const saveAll = async () => {
    if (opps.length === 0) return;
    const { addedCount, duplicateCount } = await savedOpportunitiesStorage.addDedup(opps);
    toast({ title: 'Vacantes guardadas', description: `Agregadas: ${addedCount} · Duplicados: ${duplicateCount}` });
  };

  const groupedCompanies = useMemo(() => {
    const map = new Map<string, CompanyTarget>();
    for (const j of opps) {
      const key = j.companyName.trim();
      const tgt = map.get(key) ?? {
        companyName: j.companyName,
        companyDomain: j.companyDomain,
        companyLinkedinUrl: j.companyLinkedinUrl,
        sourceJobIds: [],
      };
      tgt.sourceJobIds.push(j.id);
      map.set(key, tgt);
    }
    return Array.from(map.values()).sort((a, b) => b.sourceJobIds.length - a.sourceJobIds.length);
  }, [opps]);

  async function handleSearch() {
    setLoading(true);
    try {
      console.log('[UI] Iniciando búsqueda…');
      const res = await fetch('/api/opportunities/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobTitle: form.jobTitle?.trim() || undefined,
          location: form.location?.trim(),
          rows: form.rows ?? 100,
          dateRange: form.dateRange, // r86400 | r604800 | r2592000
        }),
      });
      const parsed = await parseJsonResponse(res);
      const data = parsed.data ?? {};
      if (!parsed.ok) {
        const t = data?.error?.type;
        if (t === 'missing-apify-token') {
          toast({ variant: 'destructive', title: 'Falta configuración', description: 'Configura APIFY_TOKEN en el servidor (.env) y vuelve a intentar.' });
        } else if (t === 'user-or-token-not-found') {
          toast({ variant: 'destructive', title: 'Token inválido de Apify', description: 'El token de Apify es inválido/expirado. Regenera el token y reinicia el servidor.' });
        } else {
          const snippet = data?.error?.message || data?.message || parsed.text || 'Revisa los logs del servidor.';
          toast({ variant: 'destructive', title: 'Error al buscar vacantes', description: String(snippet).slice(0, 200) });
        }
        return;
      }
      const runId: string | undefined = data?.runId;
      if (!runId) {
        toast({ variant: 'destructive', title: 'Error', description: 'No se obtuvo runId del servidor.' });
        return;
      }
      console.log('[UI] runId recibido:', runId);

      // --- Polling a /api/opportunities/status ---
      const started = Date.now();
      const MAX_MS = 90_000; // 90s en UI
      let delay = 1500;
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
      while (Date.now() - started < MAX_MS) {
        const st = await fetch(`/api/opportunities/status?runId=${encodeURIComponent(runId)}&limit=${form.rows ?? 100}`, {
          cache: 'no-store',
        });
        const stParsed = await parseJsonResponse(st);
        const sd = stParsed.data ?? {};
        console.log('[UI] status poll →', stParsed.status, sd?.status || sd?.error?.type);
        if (!stParsed.ok) {
          const snippet = sd?.error?.message || sd?.message || stParsed.text || 'Fallo de estado.';
          toast({ variant: 'destructive', title: 'Error consultando estado', description: String(snippet).slice(0, 200) });
          return;
        }
        if (sd.status === 'SUCCEEDED') {
          const items = Array.isArray(sd.items) ? sd.items : [];
          setOpps(items);
          if (items.length === 0) {
            toast({ title: 'Sin resultados', description: 'Prueba con otro título o ubicación.' });
          } else {
            toast({ title: 'Búsqueda lista', description: `Encontramos ${sd.total ?? items.length} vacantes.` });
          }
          return;
        }
        await sleep(delay);
        delay = Math.min(delay + 500, 3500);
      }
      toast({ variant: 'destructive', title: 'Demora inusual', description: 'El proceso sigue en Apify; intenta consultar de nuevo en unos segundos.' });
    } finally {
      setLoading(false);
    }
  }

  const toggleCompany = (c: CompanyTarget, checked: boolean) => {
    setSelectedCompanies(prev => {
      const next = { ...prev };
      if (checked) next[c.companyName] = c;
      else delete next[c.companyName];
      return next;
    });
  };

  const doSearchLeads = async () => {
    const canUseClientQuota =
      typeof (Quota as any).canUseClientQuota === 'function'
        ? (Quota as any).canUseClientQuota
        : (_k: any) => true;
    const incClientQuota =
      typeof (Quota as any).incClientQuota === 'function'
        ? (Quota as any).incClientQuota
        : (_k: any) => { };
    const getClientLimit =
      typeof (Quota as any).getClientLimit === 'function'
        ? (Quota as any).getClientLimit
        : (_k: any) => 50;
    if (!canUseClientQuota('leadSearch')) {
      toast({ variant: 'destructive', title: 'Límite diario alcanzado', description: `Has llegado a ${getClientLimit('leadSearch')} búsquedas hoy.` });
      return;
    }
    setLoadingLeads(true);
    setLeads([]);
    try {
      const companies = Object.values(selectedCompanies);
      const personTitles = leadTitles.split(',').map(s => s.trim()).filter(Boolean);
      const personLocs = personLocations
        ? personLocations.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;

      const ident = (microsoftAuthService as any)?.getUserIdentity?.();
      const userId = ident?.email || ident?.id || 'anonymous';
      const res = await fetch('/api/opportunities/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          companies: companies.map(c => ({ companyName: c.companyName, companyDomain: c.companyDomain })),
          personTitles,
          personLocations: personLocs,
          countPerCompany: 100,
        }),
      });
      const parsed = await parseJsonResponse(res);
      const data = parsed.data ?? {};
      if (parsed.status === 429) throw new Error('Has alcanzado tu límite diario de búsquedas.');
      if (!parsed.ok) {
        const snippet = data?.error || data?.message || parsed.text || 'Error buscando leads';
        throw new Error(String(snippet).slice(0, 200));
      }
      try { incClientQuota('leadSearch'); } catch { }
      setLeads(data.leads || []);
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Error al buscar leads",
        description: e.message || "Ocurrió un error inesperado",
      });
    } finally {
      setLoadingLeads(false);
    }
  };

  // --- Helpers locales ---
  const displayDomain = (url: string) => { try { const u = new URL(url.startsWith('http') ? url : `https://${url}`); return u.hostname.replace(/^www\./, ''); } catch { return (url || '').replace(/^https?:\/\//, '').replace(/^www\./, ''); } };

  async function enrichSelectedLeads() {
    const indices = Object.entries(selLeadIdx).filter(([, v]) => v).map(([k]) => Number(k));
    const chosen = indices.map(i => leads[i]).filter(Boolean);
    if (chosen.length === 0) {
      toast({ title: 'Nada seleccionado', description: 'Elige al menos un lead.' });
      return;
    }
    // cuota cliente (opcional)
    if (!Quota.canUseClientQuota?.('enrich', chosen.length)) {
      const used = (Quota.getClientQuota?.() as any)?.enrich ?? 0;
      const limit = Quota.getClientLimit?.('enrich') ?? 50;
      const remaining = Math.max(0, limit - used);
      toast({ variant: 'destructive', title: 'Cupo insuficiente', description: `Selecionaste ${chosen.length}, queda ${remaining}.` });
      return;
    }

    setEnriching(true);
    try {
      const clientId = getClientId?.() || (microsoftAuthService as any)?.getUserIdentity?.()?.email || 'anonymous';
      const payloadLeads = chosen.map((l, i) => ({
        fullName: l.fullName,
        linkedinUrl: l.linkedinUrl || undefined,
        companyName: l.companyName || undefined,
        companyDomain: l.companyDomain ? displayDomain(l.companyDomain) : undefined,
        title: l.title || undefined,
        sourceOpportunityId: (l as any).sourceJobId || undefined,
        clientRef: (l as any)?.id || `${l.fullName}-${i}`, // usa id si existe
      }));

      const res = await fetch('/api/opportunities/enrich-apollo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': clientId,
          'x-quota-ticket': getQuotaTicket() || '',
        },
        body: JSON.stringify({ leads: payloadLeads }),
      });
      const parsed = await parseJsonResponse(res);
      // Log diagnóstico (no rompe UI)
      if (!parsed.ok && parsed.text && process.env.NODE_ENV !== 'production') {
        console.warn('[opps.enrich] Respuesta no-JSON', parsed.status, parsed.text.slice(0, 200));
      }
      const j = parsed.data ?? {};
      if (!parsed.ok) {
        if (parsed.status === 401) throw new Error('No autenticado (x-user-id)');
        if (parsed.status === 429) throw new Error(j?.error || 'Límite diario superado');
        const snippet = j?.error || j?.message || parsed.text || 'Error interno';
        throw new Error(`HTTP ${parsed.status}: ${String(snippet).slice(0, 200)}`);
      }
      const ticket = j?.ticket || res.headers.get('x-quota-ticket');
      if (ticket) setQuotaTicket(ticket);

      const enriched = Array.isArray(j.enriched) ? j.enriched : [];
      // Guardar enriquecidos (dedupe) y quitar de leads locales los que ya tienen email
      const byRef = new Map(payloadLeads.map(pl => [pl.clientRef, pl]));
      const formatted = enriched.map((e: any) => ({
        id: e.id,
        fullName: e.fullName,
        title: e.title,
        email: e.email,
        emailStatus: e.emailStatus || 'unknown',
        linkedinUrl: e.linkedinUrl,
        companyName: e.companyName ?? byRef.get(e?.clientRef)?.companyName,
        companyDomain: e.companyDomain ?? byRef.get(e?.clientRef)?.companyDomain,
        createdAt: e.createdAt,
      }));
      const addRes = enrichedLeadsStorage.addDedup(formatted);

      // quitar de la lista temporal los que tengan email
      const enrichedRefs = new Set(formatted.filter((x: any) => !!x.email).map((_x: any, i: number) => enriched[i]?.clientRef).filter(Boolean));
      const remaining = leads.filter((l: any) => !enrichedRefs.has((l as any)?.id));
      setLeads(remaining);
      setSelLeadIdx({});

      // cuota cliente
      const consumed = Number(j?.usage?.consumed ?? 0) || formatted.length;
      if (consumed > 0) Quota.incClientQuota?.('enrich', consumed);

      toast({
        title: 'Enriquecimiento listo',
        description: `Añadidos a Enriquecidos: ${(addRes as any)?.addedCount ?? formatted.length}`,
      });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al enriquecer', description: e.message || 'Fallo inesperado' });
    } finally {
      setEnriching(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Oportunidades (LinkedIn → Apollo)" description="Encuentra empresas que están contratando y luego contacta a los decisores." />

      <Card>
        <CardHeader>
          <CardTitle>1. Buscar Vacantes en LinkedIn</CardTitle>
          <CardDescription>Encuentra qué empresas están buscando activamente el perfil que ofreces.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Input placeholder="Título (opcional, ej: Recruiter, HRBP)" value={form.jobTitle} onChange={e => setForm({ ...form, jobTitle: e.target.value })} />
          <Input placeholder="Ubicación (ej: Chile, Remote)" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
          <select className="h-10 border rounded-md px-3 py-2 text-sm bg-background" value={form.dateRange ?? ''} onChange={e => setForm({ ...form, dateRange: (e.target.value || undefined) as any })}>
            <option value="">Cualquier fecha</option>
            <option value="r86400">Últimas 24h</option>
            <option value="r604800">Últimos 7 días</option>
            <option value="r2592000">Últimos 30 días</option>
          </select>
          <Input type="number" placeholder="Máx resultados (ej 100)" value={form.rows ?? ''} onChange={e => setForm({ ...form, rows: e.target.value ? Number(e.target.value) : undefined })} />
          <div className="md:col-span-4">
            <Button onClick={handleSearch} disabled={loading || !form.location}>
              {loading ? 'Buscando…' : 'Buscar Vacantes'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {opps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Vacantes encontradas ({opps.length})</CardTitle>
            <CardDescription>Revisa y selecciona las que quieras guardar o usar como contexto.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="select-all-opps"
                  checked={allSelected}
                  onCheckedChange={(v) => toggleSelectAll(Boolean(v))}
                />
                <label htmlFor="select-all-opps" className="text-sm cursor-pointer">
                  Seleccionar todas
                </label>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={saveSelected} disabled={Object.values(selectedOppIds).every(v => !v)}>
                  Guardar seleccionadas
                </Button>
                <Button onClick={saveAll} variant="secondary">Guardar todas</Button>
              </div>
            </div>

            <div className="border rounded-lg overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Título</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Ubicación</TableHead>
                    <TableHead>Publicado</TableHead>
                    <TableHead>Company URL</TableHead>
                    <TableHead>Apply URL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {opps.map(o => (
                    <TableRow key={o.id} className="align-top">
                      <TableCell>
                        <Checkbox
                          checked={!!selectedOppIds[o.id]}
                          onCheckedChange={(v) => toggleOpp(o.id, Boolean(v))}
                        />
                      </TableCell>
                      <TableCell>
                        <a className="underline" href={o.jobUrl} target="_blank" rel="noopener noreferrer">
                          {o.title}
                        </a>
                      </TableCell>
                      <TableCell>{o.companyName}</TableCell>
                      <TableCell>{o.location ?? '-'}</TableCell>
                      <TableCell>{o.postedTime ?? o.publishedAt ?? '-'}</TableCell>
                      <TableCell>
                        {o.companyLinkedinUrl
                          ? <a className="underline" href={o.companyLinkedinUrl} target="_blank" rel="noopener noreferrer">LinkedIn</a>
                          : '-'}
                      </TableCell>
                      <TableCell>
                        {o.applyUrl
                          ? <a className="underline" href={o.applyUrl} target="_blank" rel="noopener noreferrer">Aplicar</a>
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {opps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>2. Seleccionar Empresas Objetivo</CardTitle>
            <CardDescription>Hemos encontrado {opps.length} vacantes y las hemos agrupado en {groupedCompanies.length} empresas. Marca las empresas para buscar contactos.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3">
              {groupedCompanies.map(c => {
                const checked = !!selectedCompanies[c.companyName];
                return (
                  <div key={c.companyName} className="flex items-center justify-between border rounded p-3 hover:bg-muted/50">
                    <div className="flex items-center gap-3">
                      <Checkbox id={`company-${c.companyName}`} checked={checked} onCheckedChange={(v) => toggleCompany(c, Boolean(v))} />
                      <label htmlFor={`company-${c.companyName}`} className="cursor-pointer">
                        <div className="font-medium">{c.companyName}</div>
                        <div className="text-xs text-muted-foreground">
                          Vacantes vinculadas: {c.sourceJobIds.length}
                          {c.companyDomain ? ` · ${c.companyDomain}` : ''}
                        </div>
                      </label>
                    </div>
                    {c.companyLinkedinUrl && <Button size="sm" variant="outline" asChild><a href={c.companyLinkedinUrl} target="_blank" rel="noopener noreferrer">LinkedIn</a></Button>}
                  </div>
                );
              })}
            </div>

            <Dialog open={openLeadModal} onOpenChange={setOpenLeadModal}>
              <DialogTrigger asChild>
                <Button disabled={Object.keys(selectedCompanies).length === 0} size="lg" className="w-full mt-4">
                  Buscar Contactos en {Object.keys(selectedCompanies).length} Empresa(s)
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl">
                <DialogHeader>
                  <CardTitle>3. Encontrar Personas de Contacto</CardTitle>
                  <CardDescription>Introduce los cargos de las personas que toman las decisiones de contratación y pulsa "Buscar Leads".</CardDescription>
                </DialogHeader>
                <div className="grid md:grid-cols-2 gap-4 my-4">
                  <Input value={leadTitles} onChange={e => setLeadTitles(e.target.value)} placeholder="Cargos (separados por coma)" />
                  <Input value={personLocations} onChange={e => setPersonLocations(e.target.value)} placeholder="Ubicación (opcional, ej: Chile)" />
                </div>
                <Button onClick={doSearchLeads} disabled={loadingLeads || !leadTitles.trim()} className="w-full">
                  {loadingLeads ? 'Buscando leads…' : 'Buscar Leads'}
                </Button>

                {leads.length > 0 && (
                  <div className="mt-4 max-h-[50vh] overflow-auto border rounded-lg">
                    <div className="p-3">
                      <Button className="w-full" disabled={enriching || Object.values(selLeadIdx).every(v => !v)} onClick={enrichSelectedLeads}>
                        {enriching ? 'Enriqueciendo…' : 'Enriquecer y Guardar Seleccionados'}
                      </Button>
                    </div>
                    <Table>
                      <TableHeader className="sticky top-0 bg-background">
                        <TableRow>
                          <TableHead className="w-10">Sel</TableHead>
                          <TableHead>Nombre</TableHead>
                          <TableHead>Título</TableHead>
                          <TableHead>Empresa</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>LinkedIn</TableHead>
                          <TableHead>Estado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {leads.map((l, i) => {
                          const contacted = (l as any).id && contactedIds.has((l as any).id) || (l.email && contactedIds.has(l.email));
                          return (
                            <TableRow key={i}>
                              <TableCell>
                                <Checkbox
                                  checked={!!selLeadIdx[i]}
                                  disabled={!!l.email}
                                  onCheckedChange={(v) => setSelLeadIdx(prev => ({ ...prev, [i]: Boolean(v) }))}
                                  title={l.email ? 'Este lead ya tiene email' : ''}
                                />
                              </TableCell>
                              <TableCell>{l.fullName}</TableCell>
                              <TableCell>{l.title}</TableCell>
                              <TableCell>{l.companyName}</TableCell>
                              <TableCell>{l.email || (l.guessedEmail ? '(guess)' : '-')}</TableCell>
                              <TableCell>{l.linkedinUrl ? <a className="underline" target="_blank" href={l.linkedinUrl}>Perfil</a> : '-'}</TableCell>
                              <TableCell>{contacted ? <span className="text-primary">Contactado</span> : <span className="text-muted-foreground">Nuevo</span>}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
