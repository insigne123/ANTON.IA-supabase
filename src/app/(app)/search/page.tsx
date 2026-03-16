"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import Image from 'next/image';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { companySizes } from '@/lib/data';
import type { Lead as UILaed, SavedSearch } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Save, X, Frown, ChevronDown, Loader2, Bookmark, BookmarkPlus, Trash2, Info, AlertCircle, Building2, CheckCircle2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { supabaseService } from '@/lib/supabase-service';
import { enrichedLeadsStorage } from '@/lib/services/enriched-leads-service';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import * as Quota from '@/lib/quota-client';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_OPTIONS } from '@/lib/search-config';
import {
  searchCompanyNameLeads,
  searchLeads,
  searchLinkedInProfileLead,
  type CompanySearchOrganization,
  type LeadsSearchParams,
} from '@/lib/leads-client';
import type { Lead, LeadSearchResponse } from '@/lib/schemas/leads';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { APOLLO_SENIORITIES } from '@/lib/apollo-taxonomies';
import { savedSearchesService } from '@/lib/services/saved-searches-service';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { splitDomainInput } from '@/lib/domain';
import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';

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

function normalizeLeadForUI(raw: Lead, options?: { phoneStatus?: 'not_requested' | 'queued' | 'skipped' | 'failed' | undefined }): UILaed {
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
  const phoneNumbers = Array.isArray(raw.phone_numbers) ? raw.phone_numbers : undefined;
  const fallbackPhone = phoneNumbers?.find((phone) => phone?.sanitized_number)?.sanitized_number || null;
  const primaryPhone = raw.primary_phone || fallbackPhone || null;
  const enrichmentStatus =
    raw.enrichment_status ||
    ((options?.phoneStatus === 'queued' && !primaryPhone) ? 'pending_phone' : undefined);

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
    apolloId: raw.apollo_id || undefined,
    phoneNumbers: phoneNumbers || null,
    primaryPhone,
    enrichmentStatus,
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

function normalizePhoneNumbersForEnriched(phoneNumbers?: UILaed['phoneNumbers']) {
  if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) return null;

  return phoneNumbers
    .map((phone) => ({
      raw_number: String(phone?.raw_number || phone?.sanitized_number || '').trim(),
      sanitized_number: String(phone?.sanitized_number || phone?.raw_number || '').trim(),
      type: String(phone?.type || '').trim(),
      position: String(phone?.position || '').trim(),
      status: String(phone?.status || '').trim(),
    }))
    .filter((phone) => phone.raw_number || phone.sanitized_number);
}

function mapLeadToEnriched(l: UILaed) {
  return {
    id: l.id,
    apolloId: l.apolloId,
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
    phoneNumbers: normalizePhoneNumbersForEnriched(l.phoneNumbers),
    primaryPhone: l.primaryPhone || null,
    enrichmentStatus: l.enrichmentStatus,
  };
}

function splitTitlesInput(value?: string) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const DEFAULT_FILTERS = {
  searchMode: 'filters' as 'filters' | 'linkedin_profile' | 'company_name',
  industry: '',
  location: '',
  title: '',
  sizeRange: '',
  seniorities: [] as string[],
  companyName: '',
  companyDomains: '',
  maxResults: 25,
  linkedinUrl: '',
  revealEmail: true,
  revealPhone: false,
};

type SearchMode = typeof DEFAULT_FILTERS.searchMode;


export default function SearchPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [leads, setLeads] = useState<UILaed[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [contactedIds, setContactedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const { toast } = useToast();
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_DEFAULT);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(leads.length / pageSize)), [leads.length, pageSize]);
  const pagedLeads = useMemo(() => leads.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize), [leads, pageIndex, pageSize]);
  const abortRef = useRef<AbortController | null>(null);
  const submittingRef = useRef(false);

  // Saved Searches State
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [saveSearchOpen, setSaveSearchOpen] = useState(false);
  const [newSearchName, setNewSearchName] = useState('');
  const [isShared, setIsShared] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);

  useEffect(() => { setPageIndex(0); }, [leads]);

  // Cargar leads guardados y contactados para verificar estado
  useEffect(() => {
    Promise.all([
      supabaseService.getLeads(),
      contactedLeadsStorage.get()
    ]).then(([saved, contacted]) => {
      setSavedIds(new Set(saved.map(l => l.id)));
      const cSet = new Set<string>();
      contacted.forEach(c => {
        if (c.leadId) cSet.add(c.leadId);
        if (c.email) cSet.add(c.email);
      });
      setContactedIds(cSet);
    });

    // Load saved searches
    loadSavedSearches();
  }, []);

  const loadSavedSearches = async () => {
    const data = await savedSearchesService.getSavedSearches();
    setSavedSearches(data);
  };

  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  const handleFilterChange = (field: keyof typeof filters, value: any) => {
    if (field === 'searchMode' || field === 'linkedinUrl' || field === 'revealEmail' || field === 'revealPhone') {
      setProfileSearchNotice(null);
      setLastProfilePhoneStatus(null);
    }
    if (field === 'searchMode' || field === 'companyName' || field === 'companyDomains' || field === 'title' || field === 'seniorities' || field === 'maxResults') {
      setCompanyCandidates([]);
      setSelectedOrganization(null);
      setCompanySelectionPending(false);
    }
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const [isSaving, setIsSaving] = useState(false);
  const [profileSearchNotice, setProfileSearchNotice] = useState<null | {
    tone: 'info' | 'warning';
    title: string;
    description: string;
  }>(null);
  const [lastProfilePhoneStatus, setLastProfilePhoneStatus] = useState<'not_requested' | 'queued' | 'skipped' | 'failed' | null>(null);
  const [companyCandidates, setCompanyCandidates] = useState<CompanySearchOrganization[]>([]);
  const [selectedOrganization, setSelectedOrganization] = useState<CompanySearchOrganization | null>(null);
  const [companySelectionPending, setCompanySelectionPending] = useState(false);

  const handleSaveSelectedLeads = async () => {
    const selected = leads.filter(lead => selectedLeads.has(lead.id));
    // Filter out already contacted
    const selectedNotContacted = selected.filter(l => {
      const isContacted = (l.id && contactedIds.has(l.id)) || (l.email && contactedIds.has(l.email));
      return !isContacted;
    });

    if (selectedNotContacted.length === 0) {
      toast({ title: 'Nada que guardar', description: 'Todos los seleccionados ya fueron contactados o no hay selección.' });
      return;
    }

    setIsSaving(true);
    try {
      const withEmail = selectedNotContacted.filter(l => !!l.email);
      let enrichedAdded = 0;
      if (withEmail.length) {
        const enriched = withEmail.map(mapLeadToEnriched);
        const res = await enrichedLeadsStorage.addDedup(enriched);
        enrichedAdded = res.addedCount;
      }

      const withoutEmail = selectedNotContacted.filter(l => !l.email);
      const resSv = await supabaseService.addLeadsDedup(withoutEmail);

      // Actualizar estado local de guardados
      const all = await supabaseService.getLeads();
      setSavedIds(new Set(all.map(l => l.id)));

      const savedToEnrichedOnly = enrichedAdded > 0 && resSv.addedCount === 0;
      const phonePendingNote =
        filters.searchMode === 'linkedin_profile' &&
        lastProfilePhoneStatus === 'queued' &&
        withEmail.length > 0
          ? ' El telefono aun esta en proceso y puede no reflejarse todavia en Leads Enriquecidos.'
          : '';

      toast({
        title: savedToEnrichedOnly ? 'Guardado en Leads Enriquecidos' : 'Guardado completado',
        description: savedToEnrichedOnly
          ? `Se guardo ${enrichedAdded} lead${enrichedAdded === 1 ? '' : 's'} en Leads Enriquecidos.${phonePendingNote}`
          : `En Leads Enriquecidos: ${enrichedAdded} · En Guardados: ${resSv.addedCount} · Duplicados: ${resSv.duplicateCount}.${phonePendingNote}`,
      });

      setSelectedLeads(new Set());
    } catch (error) {
      console.error('Error saving leads:', error);
      toast({ variant: "destructive", title: "Error", description: "No se pudieron guardar los leads." });
    } finally {
      setIsSaving(false);
    }
  };

  const applySearchResult = (result: LeadSearchResponse, mode: SearchMode) => {
    if (mode === 'company_name') {
      const candidates = Array.isArray(result.organization_candidates) ? result.organization_candidates : [];
      const requiresSelection = Boolean(result.requires_organization_selection && candidates.length > 0);

      if (requiresSelection) {
        setCompanyCandidates(candidates);
        setSelectedOrganization(null);
        setCompanySelectionPending(true);
        setLeads([]);
        toast({
          title: 'Selecciona la empresa correcta',
          description: 'Encontramos varias coincidencias. Elige la organización que quieres usar para continuar.',
        });
        return;
      }

      setCompanyCandidates([]);
      setCompanySelectionPending(false);
      setSelectedOrganization(result.selected_organization || (candidates.length === 1 ? candidates[0] : null));
      setProfileSearchNotice(null);
      setLastProfilePhoneStatus(null);
      setLeads(result.leads.map((raw) => normalizeLeadForUI(raw)));
      return;
    }

    setCompanyCandidates([]);
    setCompanySelectionPending(false);
    setSelectedOrganization(null);

    const phoneStatus = mode === 'linkedin_profile'
      ? (result.phone_enrichment?.status || null)
      : null;
    setLastProfilePhoneStatus(phoneStatus);
    setLeads(result.leads.map((raw) => normalizeLeadForUI(raw, { phoneStatus: phoneStatus || undefined })));

    if (mode === 'linkedin_profile') {
      const warnings = Array.isArray(result.provider_warnings) ? result.provider_warnings.filter(Boolean) : [];

      if (phoneStatus === 'queued') {
        setProfileSearchNotice({
          tone: 'info',
          title: 'Telefono en proceso',
          description: result.phone_enrichment?.message || 'El telefono se esta enriqueciendo y se actualizara en breve.',
        });
      } else if (phoneStatus === 'skipped' || phoneStatus === 'failed') {
        setProfileSearchNotice({
          tone: 'warning',
          title: 'Telefono no disponible por ahora',
          description: result.phone_enrichment?.message || warnings[0] || 'La busqueda encontro el perfil, pero el telefono no pudo enriquecerse en este momento.',
        });
      } else if (warnings.length > 0) {
        setProfileSearchNotice({
          tone: 'warning',
          title: 'Advertencia del proveedor',
          description: warnings[0],
        });
      }
    }
  };

  const executeSearch = async ({
    countQuota = true,
    selectedOrg = null,
  }: {
    countQuota?: boolean;
    selectedOrg?: CompanySearchOrganization | null;
  } = {}) => {
    if (submittingRef.current) return;
    submittingRef.current = true;

    const canUseClientQuota = typeof (Quota as any).canUseClientQuota === 'function' ? (Quota as any).canUseClientQuota : (_k: any) => true;
    const incClientQuota = typeof (Quota as any).incClientQuota === 'function' ? (Quota as any).incClientQuota : (_k: any) => { };
    const getClientLimit = typeof (Quota as any).getClientLimit === 'function' ? (Quota as any).getClientLimit : (_k: any) => 50;

    if (countQuota && !canUseClientQuota('leadSearch')) {
      toast({ variant: 'destructive', title: 'Límite diario alcanzado', description: `Has llegado a ${getClientLimit('leadSearch')} búsquedas hoy.` });
      submittingRef.current = false;
      return;
    }

    setIsLoading(true);
    setSelectedLeads(new Set());
    setPageIndex(0);
    setError('');
    setProfileSearchNotice(null);
    setLastProfilePhoneStatus(null);
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      let result: LeadSearchResponse;

      if (filters.searchMode === 'linkedin_profile') {
        const linkedinUrl = normalizeLinkedinProfileUrl(filters.linkedinUrl);
        if (!linkedinUrl) {
          throw new Error('La URL de LinkedIn no es valida.');
        }

        if (countQuota) incClientQuota('leadSearch');
        result = await searchLinkedInProfileLead({
          search_mode: 'linkedin_profile',
          linkedin_url: linkedinUrl,
          reveal_email: filters.revealEmail,
          reveal_phone: filters.revealPhone,
        }, abortRef.current.signal);
      } else if (filters.searchMode === 'company_name') {
        const companyName = filters.companyName.trim();
        const organization = selectedOrg || selectedOrganization;
        const organizationDomains = splitDomainInput(filters.companyDomains);

        if (!companyName && !organization) {
          throw new Error('Debes indicar un nombre de empresa.');
        }

        if (countQuota) incClientQuota('leadSearch');
        result = await searchCompanyNameLeads({
          search_mode: 'company_name',
          company_name: companyName || organization?.name,
          organization_domains: organizationDomains,
          seniorities: filters.seniorities,
          titles: splitTitlesInput(filters.title),
          max_results: Math.max(1, Number(filters.maxResults) || 25),
          selected_organization_id: organization?.id,
          selected_organization_name: organization?.name,
          selected_organization_domain: organization?.primary_domain || undefined,
        }, abortRef.current.signal);
      } else {
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

        if (countQuota) incClientQuota('leadSearch');
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
        result = await searchLeads(payload, abortRef.current.signal);
      }

      applySearchResult(result, filters.searchMode);
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        setError(error.message || 'Error desconocido');
        toast({ variant: 'destructive', title: 'Error en la Búsqueda', description: error.message || 'No se pudieron obtener los leads.' });
      }
      setLeads([]);
      setLastProfilePhoneStatus(null);
    } finally {
      setIsLoading(false);
      submittingRef.current = false;
    }
  };

  const handleSelectOrganization = async (organization: CompanySearchOrganization) => {
    setSelectedOrganization(organization);
    await executeSearch({ countQuota: false, selectedOrg: organization });
  };

  const handleSearch = async () => {
    await executeSearch();
  };

  const handleAbort = () => {
    abortRef.current?.abort();
    setIsLoading(false);
    toast({ title: 'Búsqueda cancelada' });
  };

  const handleClear = () => {
    setFilters(DEFAULT_FILTERS);
    setLeads([]);
    setSelectedLeads(new Set());
    setError('');
    setProfileSearchNotice(null);
    setLastProfilePhoneStatus(null);
    setCompanyCandidates([]);
    setSelectedOrganization(null);
    setCompanySelectionPending(false);
  };

  const isPageAllSelected = useMemo(() => {
    if (pagedLeads.length === 0) return false;
    const selectable = pagedLeads.filter(lead => {
      const isContacted = (lead.id && contactedIds.has(lead.id)) || (lead.email && contactedIds.has(lead.email));
      return !savedIds.has(lead.id) && !isContacted;
    });
    if (selectable.length === 0) return false;
    return selectable.every(lead => selectedLeads.has(lead.id));
  }, [pagedLeads, selectedLeads, savedIds, contactedIds]);

  const handleSelectAll = (checked: boolean) => {
    const newSelectedLeads = new Set(selectedLeads);
    pagedLeads.forEach(lead => {
      const already = savedIds.has(lead.id);
      const contacted = (lead.id && contactedIds.has(lead.id)) || (lead.email && contactedIds.has(lead.email));
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

  // Saved Searches Handlers
  const handleSaveSearch = async () => {
    if (!newSearchName.trim()) return;
    setSavingSearch(true);
    try {
      await savedSearchesService.saveSearch(newSearchName, filters, isShared);
      toast({ title: 'Búsqueda guardada', description: 'Los filtros se han guardado correctamente.' });
      setSaveSearchOpen(false);
      setNewSearchName('');
      setIsShared(false);
      loadSavedSearches();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo guardar la búsqueda.' });
    } finally {
      setSavingSearch(false);
    }
  };

  const handleLoadSearch = (search: SavedSearch) => {
    setFilters({ ...DEFAULT_FILTERS, ...(search.criteria || {}) });
    setProfileSearchNotice(null);
    setLastProfilePhoneStatus(null);
    setCompanyCandidates([]);
    setSelectedOrganization(null);
    setCompanySelectionPending(false);
    toast({ title: 'Filtros cargados', description: `Se han aplicado los filtros de "${search.name}".` });
  };

  const handleDeleteSearch = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('¿Eliminar esta búsqueda guardada?')) return;
    try {
      await savedSearchesService.deleteSearch(id);
      loadSavedSearches();
      toast({ title: 'Búsqueda eliminada' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo eliminar la búsqueda.' });
    }
  };

  return (
    <div className="container mx-auto py-2">
      <PageHeader
        title="Búsqueda de Leads"
        description="Encuentra nuevos prospectos utilizando filtros avanzados para refinar tu búsqueda."
      >
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Bookmark className="mr-2 h-4 w-4" />
                Cargar Búsqueda
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-auto">
              {savedSearches.length === 0 ? (
                <div className="p-2 text-sm text-muted-foreground text-center">No hay búsquedas guardadas.</div>
              ) : (
                savedSearches.map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-2 hover:bg-muted rounded-sm cursor-pointer group" onClick={() => handleLoadSearch(s)}>
                    <div className="flex flex-col overflow-hidden">
                      <span className="text-sm font-medium truncate">{s.name}</span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        {s.isShared ? 'Compartida' : 'Privada'} • {s.user?.fullName}
                      </span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={(e) => handleDeleteSearch(e, s.id)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="secondary" onClick={() => setSaveSearchOpen(true)}>
            <BookmarkPlus className="mr-2 h-4 w-4" />
            Guardar Filtros
          </Button>
        </div>
      </PageHeader>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Filtros de Búsqueda</CardTitle>
          <CardDescription>
            {filters.searchMode === 'linkedin_profile'
              ? 'Busca una persona puntual usando la URL de su perfil de LinkedIn.'
              : filters.searchMode === 'company_name'
                ? 'Busca contactos dentro de una empresa específica y, si hay ambigüedad, elige la organización correcta.'
                : 'Define los parámetros para encontrar los leads que necesitas.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-6">
            <div className="max-w-sm">
              <Label htmlFor="searchMode">Modo de búsqueda</Label>
              <Select value={filters.searchMode} onValueChange={(v: SearchMode) => handleFilterChange('searchMode', v)}>
                <SelectTrigger id="searchMode"><SelectValue placeholder="Seleccionar modo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="filters">Búsqueda por filtros</SelectItem>
                  <SelectItem value="linkedin_profile">Perfil de LinkedIn</SelectItem>
                  <SelectItem value="company_name">Empresa por nombre</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {filters.searchMode === 'linkedin_profile' ? (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Label htmlFor="linkedinUrl">URL del perfil de LinkedIn *</Label>
                  <Input
                    id="linkedinUrl"
                    placeholder="Ej: https://www.linkedin.com/in/usuario"
                    value={filters.linkedinUrl}
                    onChange={(e) => handleFilterChange('linkedinUrl', e.target.value)}
                  />
                  <small className="text-muted-foreground">Consulta una sola persona por URL usando el endpoint interno de perfil.</small>
                </div>
                <div className="flex items-center justify-between rounded-md border p-4">
                  <div>
                    <Label htmlFor="revealEmail">Revelar email</Label>
                    <p className="text-sm text-muted-foreground">Solicita email si el proveedor logra encontrarlo.</p>
                  </div>
                  <Switch id="revealEmail" checked={filters.revealEmail} onCheckedChange={(v) => handleFilterChange('revealEmail', v)} />
                </div>
                <div className="flex items-center justify-between rounded-md border p-4">
                  <div>
                    <Label htmlFor="revealPhone">Revelar teléfono</Label>
                    <p className="text-sm text-muted-foreground">Solicita teléfono si el proveedor logra encontrarlo.</p>
                  </div>
                  <Switch id="revealPhone" checked={filters.revealPhone} onCheckedChange={(v) => handleFilterChange('revealPhone', v)} />
                </div>
              </div>
            ) : filters.searchMode === 'company_name' ? (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Label htmlFor="companyName">Empresa *</Label>
                  <Input
                    id="companyName"
                    placeholder="Ej: Microsoft"
                    value={filters.companyName}
                    onChange={(e) => handleFilterChange('companyName', e.target.value)}
                  />
                  <small className="text-muted-foreground">El backend intentará encontrar la organización correcta por nombre.</small>
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="companyDomains">Dominio de la empresa</Label>
                  <Input
                    id="companyDomains"
                    placeholder="Ej: grupoexpro.com, grupoexpro.cl"
                    value={filters.companyDomains}
                    onChange={(e) => handleFilterChange('companyDomains', e.target.value)}
                  />
                  <small className="text-muted-foreground">Opcional. Ayuda a resolver empresas ambiguas con mucha más precisión.</small>
                </div>
                <div>
                  <Label htmlFor="companyTitles">Cargos</Label>
                  <Input
                    id="companyTitles"
                    placeholder="Ej: VP Marketing, Marketing Director"
                    value={filters.title}
                    onChange={(e) => handleFilterChange('title', e.target.value)}
                  />
                  <small className="text-muted-foreground">Puedes separar varios cargos por coma.</small>
                </div>
                <div>
                  <Label htmlFor="maxResults">Máximo de resultados</Label>
                  <Input
                    id="maxResults"
                    type="number"
                    min={1}
                    max={100}
                    value={String(filters.maxResults)}
                    onChange={(e) => handleFilterChange('maxResults', Math.max(1, Number(e.target.value) || 25))}
                  />
                </div>
                <div className="md:col-span-2">
                  <MultiCheckDropdown
                    label="Management level"
                    options={APOLLO_SENIORITIES}
                    value={filters.seniorities}
                    onChange={(next) => handleFilterChange('seniorities', next)}
                    placeholder="Seleccionar niveles"
                  />
                </div>

                {selectedOrganization ? (
                  <div className="md:col-span-2 rounded-md border border-emerald-200 bg-emerald-50/60 p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                      <div className="space-y-1 text-sm">
                        <div className="font-medium text-emerald-900">Empresa seleccionada</div>
                        <div className="text-emerald-800">
                          {selectedOrganization.name}
                          {selectedOrganization.primary_domain ? ` · ${selectedOrganization.primary_domain}` : ''}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
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
            )}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={handleClear}><X className="mr-2" />Limpiar</Button>
            <Button onClick={handleSearch} disabled={isLoading}><Search className="mr-2" />{isLoading ? 'Buscando...' : (filters.searchMode === 'linkedin_profile' ? 'Buscar Perfil' : filters.searchMode === 'company_name' ? 'Buscar Empresa' : 'Buscar Leads')}</Button>
            {isLoading && (
              <Button variant="outline" onClick={handleAbort}>Cancelar</Button>
            )}
          </div>

          {profileSearchNotice ? (
            <Alert className="mt-4" variant={profileSearchNotice.tone === 'warning' ? 'destructive' : 'default'}>
              {profileSearchNotice.tone === 'warning' ? <AlertCircle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
              <AlertTitle>{profileSearchNotice.title}</AlertTitle>
              <AlertDescription>{profileSearchNotice.description}</AlertDescription>
            </Alert>
          ) : null}

          {filters.searchMode === 'company_name' && companySelectionPending && companyCandidates.length > 0 ? (
            <div className="mt-4 rounded-md border p-4">
              <div className="mb-3 flex items-start gap-3">
                <Building2 className="mt-0.5 h-4 w-4 text-blue-600" />
                <div>
                  <div className="font-medium">Selecciona la empresa correcta</div>
                  <p className="text-sm text-muted-foreground">Encontramos varias coincidencias para "{filters.companyName}". Elige una para continuar la búsqueda sin volver a consumir cuota.</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {companyCandidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => handleSelectOrganization(candidate)}
                    className="rounded-md border bg-background p-4 text-left transition hover:border-blue-400 hover:bg-muted/40"
                  >
                    <div className="font-medium">{candidate.name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {candidate.primary_domain || candidate.website_url || 'Sin dominio visible'}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {[candidate.city, candidate.state, candidate.country].filter(Boolean).join(', ') || 'Ubicación no disponible'}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Resultados de la Búsqueda</CardTitle>
            <CardDescription>
              {leads.length > 0
                ? `Mostrando ${pagedLeads.length} de ${leads.length} leads.`
                : companySelectionPending
                  ? 'Selecciona una organización para continuar con la búsqueda.'
                  : 'No se han encontrado leads.'}
            </CardDescription>
          </div>
          <Button
            disabled={selectedLeads.size === 0 || isSaving}
            onClick={handleSaveSelectedLeads}
          >
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2" />}
            {isSaving ? 'Guardando...' : `Guardar ${selectedLeads.size > 0 ? `(${selectedLeads.size})` : ''}`}
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
                    const contacted = !!((lead.id && contactedIds.has(lead.id)) || (lead.email && contactedIds.has(lead.email)));
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
                          <p className="text-muted-foreground">
                            {companySelectionPending
                              ? 'Selecciona una organización sugerida para ver los resultados.'
                              : 'Realiza una búsqueda para ver los resultados.'}
                          </p>
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

      <Dialog open={saveSearchOpen} onOpenChange={setSaveSearchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Guardar Búsqueda</DialogTitle>
            <DialogDescription>Guarda los filtros actuales para usarlos después o compartirlos con tu equipo.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="search-name">Nombre de la búsqueda</Label>
              <Input id="search-name" value={newSearchName} onChange={(e) => setNewSearchName(e.target.value)} placeholder="Ej: Gerentes de Marketing en Chile" />
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="shared" checked={isShared} onCheckedChange={setIsShared} />
              <Label htmlFor="shared">Compartir con mi organización</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveSearchOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveSearch} disabled={savingSearch || !newSearchName.trim()}>
              {savingSearch ? 'Guardando...' : 'Guardar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
