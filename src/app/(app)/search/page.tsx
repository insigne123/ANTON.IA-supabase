
"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import Image from 'next/image';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { companySizes } from '@/lib/data';
import type { Lead as UILaed } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Save, X, Frown, ChevronDown } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { supabaseService } from '@/lib/supabase-service';
import { addEnrichedLeads } from '@/lib/saved-enriched-leads-storage';
import { contactedLeadsStorage } from '@/lib/contacted-leads-storage';
import * as Quota from '@/lib/quota-client';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_OPTIONS } from '@/lib/search-config';
import { searchLeads, type LeadsSearchParams } from '@/lib/leads-client';
import type { Lead } from '@/lib/schemas/leads';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { APOLLO_SENIORITIES } from '@/lib/apollo-taxonomies';

function MultiCheckDropdown({
  label,
  options,
  value,
  onChange,
  placeholder = 'Seleccionar',
}: {
  label?: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const toggle = (val: string, checked: boolean) => {
    const set = new Set(value);
    if (checked) set.add(val); else set.delete(val);
    onChange(Array.from(set));
  };
  const selectedCount = value.length;
  const buttonText =
    selectedCount === 0 ? placeholder :
      selectedCount === 1 ? options.find(o => o.value === value[0])?.label ?? '1 seleccionado'
        : `${selectedCount} seleccionados`;

  return (
    <div className="grid gap-2">
      {label ? <Label>{label}</Label> : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" role="combobox" className="justify-between w-full">
            <span className="truncate">{buttonText}</span>
            <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] max-h-80 overflow-auto">
          {options.map(opt => (
            <DropdownMenuCheckboxItem
              key={opt.value}
              checked={value.includes(opt.value)}
              onCheckedChange={(c) => toggle(opt.value, Boolean(c))}
              className="capitalize"
            >
              {opt.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function normalizeLeadForUI(raw: Lead): UILaed {
  const name =
    `${raw.first_name || ''} ${raw.last_name || ''}`.trim() || '—';

  const company =
    raw.organization?.name?.trim() || '—';

  const title = raw.title?.trim() || '—';
  const industry = (raw.organization as any)?.industry?.trim() || '—';

  const location = '—'; // n8n response no lo trae, pero UI lo espera

  const avatar =
    raw.photo_url?.trim() ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&size=40`;

  const companyWebsite = raw.organization?.domain ? `https://${raw.organization.domain}` : null;
  const companyLinkedin = null;
  const linkedinUrl = raw.linkedin_url || null;

  return {
    id: raw.id,
    name,
    title,
    company,
    email: (raw.email && raw.email !== 'email_not_unlocked@domain.com') ? raw.email : null,
    avatar,
    location,
    industry,
    companyWebsite,
    companyLinkedin,
    linkedinUrl,
    country: null,
    city: null,
    status: 'saved',
    emailEnrichment: raw.email ? { enriched: true, source: 'n8n' } : undefined,
  };
}

const displayDomain = (url?: string) => {
  if (!url) return '';
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return String(url).replace(/^https?:\/\//, '').replace(/^www\./, '');
  }
};

function mapLeadToEnriched(l: UILaed) {
  return {
    id: l.id,
    sourceOpportunityId: undefined,
    fullName: l.name,
    title: l.title,
    email: l.email || undefined,
    emailStatus: 'unknown' as const,
    linkedinUrl: l.linkedinUrl || undefined,
    companyName: l.company || undefined,
    companyDomain: l.companyWebsite ? displayDomain(l.companyWebsite) : undefined,
    descriptionSnippet: undefined,
    createdAt: new Date().toISOString(),
    country: l.country || undefined,
    city: l.city || undefined,
    industry: l.industry || undefined,
  };
}


export default function SearchPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [leads, setLeads] = useState<UILaed[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const { toast } = useToast();
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_DEFAULT);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(leads.length / pageSize)), [leads.length, pageSize]);
  const pagedLeads = useMemo(() => leads.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize), [leads, pageIndex, pageSize]);
  const abortRef = useRef<AbortController | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => { setPageIndex(0); }, [leads]);

  // Cargar leads guardados para verificar estado
  useEffect(() => {
    supabaseService.getLeads().then(all => {
      setSavedIds(new Set(all.map(l => l.id)));
    });
  }, []);

  const [filters, setFilters] = useState({
    industry: '',
    location: '',
    title: '',
    sizeRange: '',
    seniorities: [] as string[],
  });

  const handleFilterChange = (field: keyof typeof filters, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveSelectedLeads = async () => {
    const selected = leads.filter(lead => selectedLeads.has(lead.id));
    const selectedNotContacted = selected.filter(l => !contactedLeadsStorage.isContacted(l.email || undefined, l.id));
    if (selectedNotContacted.length === 0) {
      toast({ title: 'Nada que guardar', description: 'Todos los seleccionados ya fueron contactados o no hay selección.' });
      return;
    }

    const withEmail = selectedNotContacted.filter(l => !!l.email);
    if (withEmail.length) {
      const enriched = withEmail.map(mapLeadToEnriched);
      addEnrichedLeads(enriched);
    }

    const withoutEmail = selectedNotContacted.filter(l => !l.email);
    const resSv = await supabaseService.addLeadsDedup(withoutEmail);

    // Actualizar estado local de guardados
    const all = await supabaseService.getLeads();
    setSavedIds(new Set(all.map(l => l.id)));

    toast({
      title: 'Guardado',
      description:
        `A Enriquecidos: ${withEmail.length} · ` +
        `A Guardados: ${resSv.addedCount} (dup: ${resSv.duplicateCount})`,
    });

    setSelectedLeads(new Set());
  };

  const handleSearch = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;

    const canUseClientQuota = typeof (Quota as any).canUseClientQuota === 'function' ? (Quota as any).canUseClientQuota : (_k: any) => true;
    const incClientQuota = typeof (Quota as any).incClientQuota === 'function' ? (Quota as any).incClientQuota : (_k: any) => { };
    const getClientLimit = typeof (Quota as any).getClientLimit === 'function' ? (Quota as any).getClientLimit : (_k: any) => 50;

    if (!canUseClientQuota('leadSearch')) {
      toast({ variant: 'destructive', title: 'Límite diario alcanzado', description: `Has llegado a ${getClientLimit('leadSearch')} búsquedas hoy.` });
      submittingRef.current = false;
      return;
    }

    setIsLoading(true);
    setSelectedLeads(new Set());
    setPageIndex(0);
    setError('');
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const industryKeywords = [filters.industry.trim()].filter(Boolean);
      const locations = filters.location.split(',').map(s => s.trim()).filter(Boolean);
      const sizeRanges = filters.sizeRange.split(',').map(s => s.trim()).filter(Boolean);

      if (!industryKeywords.length) {
        throw new Error('El campo "Industria" es obligatorio.');
      }
      if (!locations.length) {
        throw new Error('Debes indicar al menos un país/ubicación.');
      }
      if (!sizeRanges.length) {
        throw new Error('Debes seleccionar al menos un tamaño de empresa.');
      }
      incClientQuota('leadSearch');

      const payload: LeadsSearchParams = [{
        industry_keywords: industryKeywords,
        company_location: locations,
        employee_ranges: sizeRanges,
        titles: filters.title.trim(),
        seniorities: filters.seniorities,
        per_page_orgs: 100,
        per_page_people: 100,
        max_org_pages: 3,
        max_people_pages_per_chunk: 2,
        enrich: true,
        max_results: 500,
      }];
      const result = await searchLeads(payload, abortRef.current.signal);
      setLeads(result.leads.map(normalizeLeadForUI));
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        setError(error.message || 'Error desconocido');
        toast({ variant: "destructive", title: "Error en la Búsqueda", description: error.message || "No se pudieron obtener los leads." });
      }
      setLeads([]);
    } finally {
      setIsLoading(false);
      submittingRef.current = false;
    }
  };

  const handleAbort = () => {
    abortRef.current?.abort();
    setIsLoading(false);
    toast({ title: 'Búsqueda cancelada' });
  };

  const handleClear = () => {
    setFilters({ industry: '', location: '', title: '', sizeRange: '', seniorities: [] });
    setLeads([]);
    setSelectedLeads(new Set());
    setError('');
  };

  const isPageAllSelected = useMemo(() => {
    if (pagedLeads.length === 0) return false;
    const selectable = pagedLeads.filter(lead => !savedIds.has(lead.id) && !contactedLeadsStorage.isContacted(lead.email || undefined, lead.id));
    if (selectable.length === 0) return false;
    return selectable.every(lead => selectedLeads.has(lead.id));
  }, [pagedLeads, selectedLeads, savedIds]);

  const handleSelectAll = (checked: boolean) => {
    const newSelectedLeads = new Set(selectedLeads);
    pagedLeads.forEach(lead => {
      const already = savedIds.has(lead.id);
      const contacted = contactedLeadsStorage.isContacted(lead.email || undefined, lead.id);
      if (!already && !contacted) {
        if (checked) newSelectedLeads.add(lead.id);
        else newSelectedLeads.delete(lead.id);
      }
    });
    setSelectedLeads(newSelectedLeads);
  };

  const handleSelectLead = (leadId: string, checked: boolean) => {
    const newSelectedLeads = new Set(selectedLeads);
    if (checked) newSelectedLeads.add(leadId);
    else newSelectedLeads.delete(leadId);
    setSelectedLeads(newSelectedLeads);
  };

  return (
    <div className="container mx-auto py-2">
      <PageHeader
        title="Búsqueda de Leads"
        description="Encuentra nuevos prospectos utilizando filtros avanzados para refinar tu búsqueda."
      />
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Filtros de Búsqueda</CardTitle>
          <CardDescription>Define los parámetros para encontrar los leads que necesitas.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label htmlFor="industry">Industria (texto libre) *</Label>
              <Input id="industry" placeholder="Ej: Human Resources, Retail" value={filters.industry} onChange={(e) => handleFilterChange('industry', e.target.value)} required />
              <small className="text-muted-foreground">Obligatorio.</small>
            </div>
            <div>
              <Label htmlFor="location">Ubicación (País) *</Label>
              <Input id="location" placeholder="Ej: Chile, United States (separado por comas)" value={filters.location} onChange={(e) => handleFilterChange('location', e.target.value)} required />
              <small className="text-muted-foreground">Al menos uno. Puedes listar varios.</small>
            </div>
            <div>
              <Label htmlFor="sizeRange">Tamaño de empresa *</Label>
              <Select value={filters.sizeRange} onValueChange={(v) => handleFilterChange('sizeRange', v)}>
                <SelectTrigger id="sizeRange"><SelectValue placeholder="Seleccionar tamaño" /></SelectTrigger>
                <SelectContent>{companySizes.map(s => <SelectItem key={s} value={s}>{s.replace('+', ' o más')}</SelectItem>)}</SelectContent>
              </Select>
              <small className="text-muted-foreground">Al menos uno.</small>
            </div>
            <div>
              <Label htmlFor="title">Cargo/Posición</Label>
              <Input id="title" placeholder="Ej: Marketing Director" value={filters.title} onChange={(e) => handleFilterChange('title', e.target.value)} />
            </div>
            <div className="md:col-span-2 lg:col-span-4">
              <MultiCheckDropdown
                label="Management level"
                options={APOLLO_SENIORITIES}
                value={filters.seniorities}
                onChange={(next) => handleFilterChange('seniorities', next)}
                placeholder="Seleccionar niveles"
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={handleClear}><X className="mr-2" />Limpiar</Button>
            <Button onClick={handleSearch} disabled={isLoading}><Search className="mr-2" />{isLoading ? 'Buscando...' : 'Buscar Leads'}</Button>
            {isLoading && (
              <Button variant="outline" onClick={handleAbort}>Cancelar</Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Resultados de la Búsqueda</CardTitle>
            <CardDescription>
              {leads.length > 0 ? `Mostrando ${pagedLeads.length} de ${leads.length} leads.` : 'No se han encontrado leads.'}
            </CardDescription>
          </div>
          <Button
            disabled={selectedLeads.size === 0}
            onClick={handleSaveSelectedLeads}
          >
            <Save className="mr-2" />Guardar {selectedLeads.size > 0 ? `(${selectedLeads.size})` : ''}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">
                    <Checkbox onCheckedChange={(checked) => handleSelectAll(Boolean(checked))} checked={isPageAllSelected} />
                  </TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Industria</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                      <TableCell><div className="flex items-center gap-2"><Skeleton className="h-10 w-10 rounded-full" /><Skeleton className="h-4 w-24" /></div></TableCell>
                      <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    </TableRow>
                  ))
                ) : pagedLeads.length > 0 ? (
                  pagedLeads.map(lead => {
                    const already = savedIds.has(lead.id);
                    const contacted = contactedLeadsStorage.isContacted(lead.email || undefined, lead.id);
                    const disabled = already || contacted;
                    return (
                      <TableRow key={lead.id} data-state={selectedLeads.has(lead.id) ? "selected" : ""}>
                        <TableCell>
                          <Checkbox
                            disabled={disabled}
                            checked={selectedLeads.has(lead.id)}
                            onCheckedChange={(checked) => handleSelectLead(lead.id, Boolean(checked))}
                          />
                          {already && <span className="text-xs text-muted-foreground ml-2">Guardado</span>}
                          {contacted && <span className="text-xs text-primary ml-2">Contactado</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar>
                              <Image src={lead.avatar} width={40} height={40} className="rounded-full" alt={lead.name || ''} data-ai-hint="person face" unoptimized />
                              <AvatarFallback>{lead.name ? lead.name.charAt(0) : ''}</AvatarFallback>
                            </Avatar>
                            <span className="font-medium">{lead.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>{lead.title}</TableCell>
                        <TableCell>{lead.company}</TableCell>
                        <TableCell>{lead.industry}</TableCell>
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      {!isLoading && (
                        <div className="flex flex-col items-center gap-2">
                          <Frown className="h-8 w-8 text-muted-foreground" />
                          <p className="text-muted-foreground">Realiza una búsqueda para ver los resultados.</p>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between py-2">
              <div className="text-sm text-muted-foreground">
                Mostrando{' '}
                {leads.length === 0 ? '0' : `${pageIndex * pageSize + 1}–${Math.min(leads.length, (pageIndex + 1) * pageSize)}`} de {leads.length}
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => { const n = Number(v); if (!Number.isNaN(n)) { setPageSize(n); setPageIndex(0); } }}
                >
                  <SelectTrigger className="w-[150px]"><SelectValue placeholder="Tamaño de página" /></SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((opt) => (<SelectItem key={opt} value={String(opt)}>{opt} / página</SelectItem>))}
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={() => setPageIndex((p) => Math.max(0, p - 1))} disabled={pageIndex === 0}>Anterior</Button>
                <Button variant="outline" onClick={() => setPageIndex((p) => (p + 1 < totalPages ? p + 1 : p))} disabled={pageIndex + 1 >= totalPages}>Siguiente</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
