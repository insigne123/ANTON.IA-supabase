
'use client';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import type { JobOpportunity, LeadFromApollo, EnrichedOppLead } from '@/lib/types';
import { savedOpportunitiesStorage } from '@/lib/services/opportunities-service';
import { enrichedLeadsStorage } from '@/lib/services/enriched-leads-service';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useRouter } from 'next/navigation';
import { toCsv, downloadCsv } from '@/lib/csv';
import { Download } from 'lucide-react';
import { getClientId } from '@/lib/client-id';
import DailyQuotaProgress from '@/components/quota/daily-quota-progress';

export default function SavedOpportunitiesPage() {
    const { toast } = useToast();
    const router = useRouter();
    const [opps, setOpps] = useState<JobOpportunity[]>([]);

    const [leadTitles, setLeadTitles] = useState('Head of Talent, HR Manager, Recruiting Lead');
    const [personLocations, setPersonLocations] = useState('');
    const [loadingLeads, setLoadingLeads] = useState(false);
    const [foundLeads, setFoundLeads] = useState<LeadFromApollo[]>([]);

    const [orgPickerOpen, setOrgPickerOpen] = useState(false);
    const [orgLoading, setOrgLoading] = useState(false);
    const [orgCandidates, setOrgCandidates] = useState<any[]>([]);
    const [orgSearchTerm, setOrgSearchTerm] = useState('');
    const [currentOpp, setCurrentOpp] = useState<JobOpportunity | null>(null);
    const [chosenOrg, setChosenOrg] = useState<any | null>(null);

    const [selectedLeadIds, setSelectedLeadIds] = useState<Record<string, boolean>>({});
    const allLeadsSelected = useMemo(
        () => foundLeads.length > 0 && foundLeads.every(l => selectedLeadIds[(l.id || l.linkedinUrl || l.fullName)]),
        [foundLeads, selectedLeadIds]
    );

    const toggleLead = (key: string, checked: boolean) =>
        setSelectedLeadIds(prev => ({ ...prev, [key]: checked }));

    const toggleSelectAllLeads = (checked: boolean) => {
        if (!checked) return setSelectedLeadIds({});
        const next: Record<string, boolean> = {};
        foundLeads.forEach(l => next[(l.id || l.linkedinUrl || l.fullName)] = true);
        setSelectedLeadIds(next);
    };

    useEffect(() => {
        savedOpportunitiesStorage.get().then(setOpps);
    }, []);

    const handleExportCsv = async () => {
        const opps = await savedOpportunitiesStorage.get();
        const headers = [
            { key: 'id', label: 'ID' },
            { key: 'title', label: 'Título' },
            { key: 'companyName', label: 'Empresa' },
            { key: 'location', label: 'Ubicación' },
            { key: 'publishedAt', label: 'Fecha Publicación' },
            { key: 'postedTime', label: 'Antigüedad' },
            { key: 'jobUrl', label: 'URL Vacante' },
            { key: 'applyUrl', label: 'URL Postulación' },
            { key: 'contractType', label: 'Contrato' },
            { key: 'experienceLevel', label: 'Experiencia' },
            { key: 'workType', label: 'Modalidad' },
        ] as const;

        const rows = opps.map(o => [
            o.id || '',
            o.title || '',
            o.companyName || '',
            o.location || '',
            (o as any).publishedAt || '',
            (o as any).postedTime || '',
            o.jobUrl || '',
            (o as any).companyUrl || o.companyLinkedinUrl || '',
            (o as any).applyUrl || '',
            o.contractType || '',
            o.experienceLevel || '',
            o.workType || '',
        ]);

        const csv = toCsv(rows, headers.map(h => h.label));
        downloadCsv(`oportunidades_${new Date().toISOString().slice(0, 10)}.csv`, csv);
    };

    const openOrgPicker = async (opp: JobOpportunity) => {
        setCurrentOpp(opp);
        setOrgSearchTerm(opp.companyName || '');
        setChosenOrg(null);
        setFoundLeads([]);
        setOrgCandidates([]);
        setOrgPickerOpen(true);
        await fetchOrgs(opp.companyName || '');
    };

    const fetchOrgs = async (name: string) => {
        if (!name.trim()) return;
        setOrgLoading(true);
        try {
            const r = await fetch('/api/opportunities/orgs-apollo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyName: name, perPage: 8 }),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j?.error || 'No se pudo buscar empresas');
            setOrgCandidates(j.candidates || []);
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error', description: e.message || 'Falló la búsqueda de empresas' });
        } finally {
            setOrgLoading(false);
        }
    };

    const findLeadsForChosen = async () => {
        if (!chosenOrg) return;
        setLoadingLeads(true);
        setFoundLeads([]);
        try {
            const titles = leadTitles.split(',').map(s => s.trim()).filter(Boolean);
            const personLocs = personLocations ? personLocations.split(',').map(s => s.trim()).filter(Boolean) : undefined;
            const domain = chosenOrg.primary_domain || (chosenOrg.website_url ? new URL(chosenOrg.website_url).hostname : undefined);

            const res = await fetch('/api/opportunities/leads-apollo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    personTitles: titles.length ? titles : undefined,
                    domains: domain ? [domain] : [],
                    companyNames: [],
                    personLocations: personLocs,
                    perPage: 100,
                    maxPages: 20,
                    onlyVerifiedEmails: true,
                    similarTitles: true,
                    dedupe: 'id',
                    includeLockedEmails: true,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Error buscando leads');
            setFoundLeads(data.leads || []);
            toast({ title: 'Búsqueda completada', description: `Encontrados ${data.leads?.length ?? 0} leads.` });
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error', description: e.message || 'Ocurrió un error' });
        } finally {
            setLoadingLeads(false);
        }
    };

    const enrichSelectedLeads = async () => {
        try {
            const chosen = foundLeads.filter(l => selectedLeadIds[(l.id || l.linkedinUrl || l.fullName)]);
            if (chosen.length === 0) return;

            const domain = chosenOrg?.primary_domain ||
                (chosenOrg?.website_url ? new URL(chosenOrg.website_url).hostname : undefined);

            // === Identidad de cliente/usuario (requerido por el backend/quota) ===
            const clientId = getClientId?.() ?? '';
            if (!clientId) {
                console.warn('[opps.enrich] Missing clientId');
                toast({
                    variant: 'destructive',
                    title: 'Falta ID de cliente',
                    description: 'No se pudo obtener tu identificador local. Refresca la página e inténtalo nuevamente.',
                });
                return;
            }

            const payload = {
                leads: chosen.map(l => ({
                    fullName: l.fullName,
                    title: l.title,
                    companyName: l.companyName || currentOpp?.companyName,
                    companyDomain: l.companyDomain || domain,
                    sourceOpportunityId: currentOpp?.id,
                    linkedinUrl: l.linkedinUrl,
                })),
            };

            const r = await fetch('/api/opportunities/enrich-apollo', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-id': clientId, // ← clave para evitar el 401
                },
                body: JSON.stringify(payload),
            });
            const j = await r.json();
            if (!r.ok) {
                // Mensajes más claros por tipo de error
                if (r.status === 401) {
                    throw new Error(j?.error || 'No autorizado: falta user id');
                }
                if (r.status === 429) {
                    throw new Error(j?.error || 'Límite diario de enriquecimiento alcanzado');
                }
                throw new Error(j?.error || `Falló el enriquecimiento (HTTP ${r.status})`);
            }

            const enrichedNow: EnrichedOppLead[] = (j.enriched || []).map((e: any) => ({
                ...e,
                descriptionSnippet: currentOpp?.descriptionSnippet,
            }));
            await enrichedLeadsStorage.addDedup(enrichedNow);

            toast({ title: 'Listo', description: `Enriquecidos ${enrichedNow.length} lead(s).` });
            setOrgPickerOpen(false);
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error', description: e.message || 'Ocurrió un error' });
            console.error('[opps.enrich] ERROR', e);
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader title="Guardados · Oportunidades" description="Empresas que están contratando. Busca contactos para cada una y enriquécelos." />

            <div className="mb-4">
                <DailyQuotaProgress kinds={['enrich']} compact />
            </div>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Oportunidades guardadas</CardTitle>
                        <CardDescription>Empresas detectadas desde LinkedIn. Busca contactos para cada una.</CardDescription>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={handleExportCsv}>
                            <Download className="mr-2 h-4 w-4" />
                            Exportar CSV
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => router.push('/saved/opportunities/enriched')}
                        >
                            Ver enriquecidos
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Título</TableHead>
                                    <TableHead>Empresa</TableHead>
                                    <TableHead>Ubicación</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {opps.map(o => (
                                    <TableRow key={o.id}>
                                        <TableCell>{o.title}</TableCell>
                                        <TableCell>{o.companyName}</TableCell>
                                        <TableCell>{o.location || '-'}</TableCell>
                                        <TableCell className="text-right">
                                            <Button size="sm" onClick={() => openOrgPicker(o)}>Buscar contactos</Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={orgPickerOpen} onOpenChange={setOrgPickerOpen}>
                <DialogContent className="max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>Buscar contactos en empresas seleccionadas</DialogTitle>
                        <CardDescription>
                            Oportunidad: <b>{currentOpp?.title}</b> — Empresa esperada: <b>{currentOpp?.companyName}</b>
                        </CardDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="flex gap-2">
                            <Input
                                value={orgSearchTerm}
                                onChange={(e) => setOrgSearchTerm(e.target.value)}
                                placeholder="Nombre de la empresa"
                            />
                            <Button onClick={() => fetchOrgs(orgSearchTerm)} disabled={orgLoading}>
                                {orgLoading ? 'Buscando…' : 'Actualizar'}
                            </Button>
                        </div>

                        <div className="grid gap-3 max-h-[40vh] overflow-auto">
                            {orgCandidates.map((c, i) => (
                                <div key={i} className={`flex items-center justify-between border rounded p-3 ${chosenOrg?.id === c.id ? 'bg-muted/50' : ''}`}>
                                    <div className="flex items-center gap-3">
                                        {c.logo ? <img src={c.logo} alt="" className="w-8 h-8 rounded" data-ai-hint="logo" /> : <div className="w-8 h-8 rounded bg-muted" />}
                                        <div>
                                            <div className="font-medium">{c.name}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {c.primary_domain ? c.primary_domain : (c.website_url || '-')}
                                                {c.linkedin_url ? <> · <a className="underline" href={c.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a></> : null}
                                            </div>
                                        </div>
                                    </div>
                                    <Button variant={chosenOrg?.id === c.id ? 'secondary' : 'outline'} onClick={() => setChosenOrg(c)}>
                                        {chosenOrg?.id === c.id ? 'Seleccionada' : 'Elegir'}
                                    </Button>
                                </div>
                            ))}
                            {(!orgLoading && orgCandidates.length === 0) && (
                                <div className="text-sm text-muted-foreground">Sin resultados. Ajusta el nombre y vuelve a intentar.</div>
                            )}
                        </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-3 mt-4">
                        <Input value={leadTitles} onChange={e => setLeadTitles(e.target.value)} placeholder="Cargos (coma separada, opcional)" />
                        <Input value={personLocations} onChange={e => setPersonLocations(e.target.value)} placeholder="Ubicación persona (opcional)" />
                    </div>

                    <DialogFooter className="mt-2 flex justify-between w-full">
                        <Button onClick={findLeadsForChosen} disabled={!chosenOrg || loadingLeads}>
                            {loadingLeads ? 'Buscando leads…' : (chosenOrg ? `Buscar leads en ${chosenOrg.primary_domain || chosenOrg.name}` : 'Elige una empresa')}
                        </Button>

                        <Button
                            variant="secondary"
                            disabled={Object.values(selectedLeadIds).every(v => !v) || !chosenOrg || loadingLeads}
                            onClick={enrichSelectedLeads}
                        >
                            Enriquecer y Guardar Seleccionados
                        </Button>
                    </DialogFooter>

                    {foundLeads.length > 0 && (
                        <div className="mt-4 max-h-[40vh] overflow-auto border rounded">
                            <Table>
                                <TableHeader className="sticky top-0 bg-background">
                                    <TableRow>
                                        <TableHead className="w-10">
                                            <Checkbox checked={allLeadsSelected} onCheckedChange={(v) => toggleSelectAllLeads(Boolean(v))} />
                                        </TableHead>
                                        <TableHead>Nombre</TableHead>
                                        <TableHead>Título</TableHead>
                                        <TableHead>Empresa</TableHead>
                                        <TableHead>Email</TableHead>
                                        <TableHead>LinkedIn</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {foundLeads.map((l, i) => (
                                        <TableRow key={i}>
                                            <TableCell>
                                                <Checkbox
                                                    checked={!!selectedLeadIds[(l.id || l.linkedinUrl || l.fullName)]}
                                                    onCheckedChange={(v) => toggleLead((l.id || l.linkedinUrl || l.fullName), Boolean(v))}
                                                />
                                            </TableCell>
                                            <TableCell>{l.fullName}</TableCell>
                                            <TableCell>{l.title}</TableCell>
                                            <TableCell>{l.companyName}</TableCell>
                                            <TableCell>
                                                {l.email
                                                    ? l.email
                                                    : (l.lockedEmail ? '(locked)' : (l.guessedEmail ? '(guess)' : '-'))}
                                            </TableCell>
                                            <TableCell>{l.linkedinUrl ? <a className="underline" href={l.linkedinUrl} target="_blank" rel="noreferrer">Perfil</a> : '-'}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
