"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import Image from 'next/image';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { companySizes, industries } from '@/lib/data';
import type { Lead as UILaed, SavedSearch } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Save, X, ChevronDown, Loader2, Bookmark, BookmarkPlus, Trash2, Info, AlertCircle, Building2, CheckCircle2, Mail, Phone, SlidersHorizontal } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { supabaseService } from '@/lib/supabase-service';
import { enrichedLeadsStorage } from '@/lib/services/enriched-leads-service';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import * as Quota from '@/lib/quota-client';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_OPTIONS } from '@/lib/search-config';
import {
  enrichLinkedInProfileLead,
  getLinkedInProfileStatuses,
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
import { DuplicateSavedSearchNameError, savedSearchesService } from '@/lib/services/saved-searches-service';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { splitDomainInput } from '@/lib/domain';
import { getLinkedinProfileDisplayName, normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  DEFAULT_LEAD_SEARCH_FILTERS,
  normalizeSavedSearchCriteria,
  savedSearchNamesMatch,
  type LeadSearchMode,
  type LeadSearchFilters,
} from '@/lib/search/saved-search-criteria';

function MultiCheckDropdown({
  label,
  options,
  value,
  onChange,
  placeholder = 'Seleccionar',
  disabled = false,
}: {
  label?: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const triggerId = React.useId();
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
      {label ? <Label htmlFor={triggerId}>{label}</Label> : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button id={triggerId} variant="outline" role="combobox" className="justify-between w-full" disabled={disabled}>
            <span className="truncate">{buttonText}</span>
            <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] max-h-80 overflow-auto">
          {options.map(opt => (
            <DropdownMenuCheckboxItem
              key={opt.value}
              checked={value.includes(opt.value)}
              disabled={disabled}
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

function getFriendlySearchErrorMessage(message?: string) {
  const raw = String(message || '').trim();
  const lower = raw.toLowerCase();

  if (!raw) {
    return 'No pudimos completar la busqueda. Revisa los filtros y vuelve a intentarlo.';
  }

  if (lower.includes('linkedin') || lower.includes('url')) {
    return 'Revisa la URL de LinkedIn e intenta nuevamente.';
  }

  if (lower.includes('industria') || lower.includes('ubicacion') || lower.includes('ubicación') || lower.includes('tamano') || lower.includes('tamaño') || lower.includes('obligatorio') || lower.includes('al menos un filtro') || lower.startsWith('debes')) {
    return raw;
  }

  if (lower.includes('quota') || lower.includes('limite') || lower.includes('límite') || lower.includes('429')) {
    if (lower.includes('alcanzaste el límite diario') || lower.includes('alcanzaste el limite diario')) return raw;
    return 'Llegaste al limite disponible por hoy. Puedes volver a intentarlo mas tarde o ajustar el volumen de la busqueda.';
  }

  if (lower.includes('unauthorized') || lower.includes('401') || lower.includes('sesion') || lower.includes('sesión')) {
    return 'Tu sesion necesita renovarse. Vuelve a iniciar sesion y repite la busqueda.';
  }

  return 'No pudimos completar la busqueda. Revisa los filtros y vuelve a intentarlo.';
}

function normalizeLeadForUI(raw: Lead, options?: {
  phoneStatus?: 'not_requested' | 'queued' | 'skipped' | 'failed' | undefined;
  revealEmail?: boolean;
  revealPhone?: boolean;
}): UILaed {
  const name =
    raw.name?.trim() || `${raw.first_name || ''} ${raw.last_name || ''}`.trim() || '—';

  const company =
    raw.organization_name?.trim() || raw.org_name?.trim() || raw.organization?.name?.trim() || '—';

  const title = raw.title?.trim() || '—';
  const industry = raw.organization_industry?.trim() || raw.industry?.trim() || raw.organization?.industry?.trim() || '—';

  const location = [raw.city, raw.state, raw.country].filter(Boolean).join(', ') || '—';

  const avatar =
    raw.photo_url?.trim() ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&size=40`;

  const companyWebsite =
    raw.organization_website?.trim() ||
    raw.organization?.website_url?.trim() ||
    raw.organization_domain?.trim() ||
    (raw.organization?.domain ? `https://${raw.organization.domain}` : null);
  const companyLinkedin = raw.organization?.linkedin_url?.trim() || null;
  const linkedinUrl = raw.linkedin_url || null;
  const phoneNumbers = normalizeUiPhoneNumbers(raw.phone_numbers);
  const fallbackPhone = getPhoneFallback(phoneNumbers);
  const primaryPhone = raw.primary_phone || fallbackPhone || null;
  const revealEmail = options?.revealEmail ?? true;
  const revealPhone = options?.revealPhone ?? true;
  const enrichmentStatus =
    raw.enrichment_status ||
    ((options?.phoneStatus === 'queued' && !primaryPhone) ? 'pending_phone' : undefined);

  return {
    id: raw.id,
    name,
    title,
    company,
    email: revealEmail && raw.email && raw.email !== 'email_not_unlocked@domain.com' ? raw.email : null,
    avatar,
    location,
    industry,
    companyWebsite,
    companyLinkedin,
    linkedinUrl,
    sourceProvider: raw.source_provider || (raw.apollo_id ? 'apollo' : undefined),
    sourceProviderId: raw.source_provider_id || raw.apollo_id || undefined,
    phoneNumbers: revealPhone ? (phoneNumbers || null) : null,
    primaryPhone: revealPhone ? primaryPhone : null,
    enrichmentStatus: revealPhone || revealEmail ? enrichmentStatus : undefined,
    country: null,
    city: null,
    status: 'saved',
    emailEnrichment: revealEmail && raw.email ? { enriched: true } : undefined,
  };
}

type ProfileContactState = 'ready' | 'missing' | 'queued' | 'not_requested';

function hasVisibleLeadEmail(raw?: Pick<Lead, 'email'> | null) {
  const email = String(raw?.email || '').trim();
  return Boolean(email) && email !== 'email_not_unlocked@domain.com';
}

function getPhoneValue(phone: any) {
  return String(phone?.sanitized_number || phone?.number || phone?.raw_number || '').trim() || null;
}

function normalizeUiPhoneNumbers(phoneNumbers?: any[] | null): UILaed['phoneNumbers'] {
  if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) return null;

  const normalized: NonNullable<UILaed['phoneNumbers']> = [];

  for (const phone of phoneNumbers) {
    const value = getPhoneValue(phone);
    if (!value) continue;

    normalized.push({
        raw_number: String(phone?.raw_number || phone?.number || value).trim(),
        sanitized_number: String(phone?.sanitized_number || phone?.number || phone?.raw_number || value).trim(),
        number: String(phone?.number || phone?.sanitized_number || phone?.raw_number || value).trim(),
        type: String(phone?.type || phone?.type_cd || '').trim() || null,
        type_cd: String(phone?.type_cd || phone?.type || '').trim() || null,
        position: String(phone?.position || '').trim() || null,
        status: String(phone?.status || '').trim() || null,
      });
  }

  return normalized.length > 0 ? normalized : null;
}

function hasVisibleLeadPhone(raw?: Pick<Lead, 'primary_phone' | 'phone_numbers'> | null) {
  const phoneNumbers = normalizeUiPhoneNumbers(raw?.phone_numbers);
  return Boolean(raw?.primary_phone || getPhoneFallback(phoneNumbers));
}

function buildLinkedInProfileNotice(params: {
  emailRequested: boolean;
  phoneRequested: boolean;
  emailState: ProfileContactState;
  phoneState: ProfileContactState;
}) {
  const { emailRequested, phoneRequested, emailState, phoneState } = params;

  let tone: 'info' | 'warning' = 'info';
  let title = 'Perfil encontrado';
  let description = 'Ya puedes revisar el resultado y decidir si quieres guardarlo.';

  if (emailState === 'queued' || phoneState === 'queued') {
    if (emailState === 'queued' && phoneState === 'queued') {
      title = 'Datos de contacto en camino';
      description = 'Encontramos el perfil y seguimos buscando el correo y el teléfono. El resultado se actualizará automáticamente.';
    } else if (emailState === 'queued') {
      title = 'Correo en camino';
      description = phoneState === 'ready'
        ? 'El teléfono ya está disponible. El correo aparecerá cuando esté listo.'
        : 'Encontramos el perfil y seguimos buscando el correo. El resultado se actualizará automáticamente.';
    } else {
      title = emailState === 'ready' ? 'Correo listo, teléfono en camino' : 'Teléfono en camino';
      description = emailState === 'ready'
        ? 'El correo ya está disponible. El teléfono aparecerá cuando esté listo.'
        : 'Encontramos el perfil y seguimos buscando el teléfono. El resultado se actualizará automáticamente.';
    }
  } else if (emailRequested && emailState === 'missing' && phoneRequested && phoneState === 'missing') {
    tone = 'warning';
    title = 'Perfil sin datos de contacto visibles';
    description = 'Encontramos el perfil, pero no hay correo ni telefono disponibles para esta URL.';
  } else if (emailRequested && emailState === 'missing') {
    tone = 'warning';
    title = 'Perfil encontrado, sin correo disponible';
    description = phoneState === 'ready'
      ? 'El telefono esta disponible, pero no encontramos un correo para este perfil.'
      : 'No encontramos un correo disponible para este perfil.';
  } else if (phoneRequested && phoneState === 'missing') {
    tone = 'warning';
    title = 'Telefono no disponible por ahora';
    description = emailState === 'ready'
      ? 'El perfil y el correo estan listos, pero no encontramos un telefono.'
      : 'Encontramos el perfil, pero no hay un telefono disponible.';
  } else if (!emailRequested && !phoneRequested) {
    title = 'Perfil encontrado';
    description = 'Encontramos el perfil sin solicitar datos de contacto.';
  }

  return { tone, title, description, emailState, phoneState };
}

function statusChipClasses(state: ProfileContactState) {
  if (state === 'ready') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200';
  if (state === 'queued') return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200';
  if (state === 'missing') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200';
  return 'border-border/70 bg-muted/40 text-muted-foreground';
}

function isPendingEnrichmentStatus(value?: string | null) {
  return String(value || '').trim().toLowerCase().startsWith('pending');
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
      raw_number: String(phone?.raw_number || phone?.number || phone?.sanitized_number || '').trim(),
      sanitized_number: String(phone?.sanitized_number || phone?.number || phone?.raw_number || '').trim(),
      number: String(phone?.number || phone?.sanitized_number || phone?.raw_number || '').trim(),
      type: String(phone?.type || phone?.type_cd || '').trim(),
      type_cd: String(phone?.type_cd || phone?.type || '').trim(),
      position: String(phone?.position || '').trim(),
      status: String(phone?.status || '').trim(),
    }))
    .filter((phone) => phone.raw_number || phone.sanitized_number || phone.number);
}

function getPhoneFallback(phoneNumbers?: UILaed['phoneNumbers']) {
  return phoneNumbers?.map((phone) => getPhoneValue(phone)).find(Boolean) || null;
}

function hasLeadPhone(lead: UILaed) {
  return Boolean(lead.primaryPhone || getPhoneFallback(lead.phoneNumbers));
}

function mapLeadToEnriched(l: UILaed) {
  return {
    id: l.id,
    sourceProvider: l.sourceProvider,
    sourceProviderId: l.sourceProviderId || l.apolloId,
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

function splitFilterInput(value?: string) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const DEFAULT_FILTERS = DEFAULT_LEAD_SEARCH_FILTERS;

const INDUSTRY_LABELS_ES: Record<string, string> = {
  'Human Resources': 'Recursos humanos',
  Technology: 'Tecnología',
  Healthcare: 'Salud',
  Finance: 'Finanzas',
  Manufacturing: 'Manufactura',
  Retail: 'Comercio minorista',
  Education: 'Educación',
  Accounting: 'Contabilidad',
  'Architecture & Planning': 'Arquitectura y planificación',
  'Apparel & Fashion': 'Moda y confección',
  Automotive: 'Automotriz',
  'Building Materials': 'Materiales de construcción',
  Biotechnology: 'Biotecnología',
  'Environment Services': 'Servicios ambientales',
  'Electrical/Electronic Manufacturing': 'Fabricación eléctrica y electrónica',
  'Computer Software': 'Software',
  Entertainment: 'Entretenimiento',
  'Education Management': 'Gestión educativa',
  Construction: 'Construcción',
  'Financial Services': 'Servicios financieros',
  'Government Administration': 'Administración pública',
  Hospitality: 'Hotelería y hospitalidad',
  'Health, Wellness & Fitness': 'Salud, bienestar y fitness',
  'Higher Education': 'Educación superior',
  'Information Services': 'Servicios de información',
};

function hasBatchSearchFilters(filters: LeadSearchFilters) {
  return Boolean(
    filters.industry.trim()
    || splitFilterInput(filters.companyKeywords).length
    || splitFilterInput(filters.location).length
    || splitFilterInput(filters.personLocation).length
    || filters.sizeRange.trim()
    || splitTitlesInput(filters.title).length
    || filters.seniorities.length,
  );
}

type SearchMode = LeadSearchMode;


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
  const profileStatusAbortRef = useRef<AbortController | null>(null);
  const submittingRef = useRef(false);
  const searchRunIdRef = useRef(0);
  const criteriaRef = useRef<HTMLFieldSetElement | null>(null);
  const profilePhoneToastStateRef = useRef<'idle' | 'found' | 'missing'>('idle');

  // Saved Searches State
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [saveSearchOpen, setSaveSearchOpen] = useState(false);
  const [newSearchName, setNewSearchName] = useState('');
  const [isShared, setIsShared] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);
  const [savedSearchPendingDelete, setSavedSearchPendingDelete] = useState<SavedSearch | null>(null);
  const [deletingSavedSearch, setDeletingSavedSearch] = useState(false);
  const [savedSearchesLoading, setSavedSearchesLoading] = useState(true);
  const [savedSearchesError, setSavedSearchesError] = useState('');
  const [saveSearchError, setSaveSearchError] = useState('');
  const [activeSavedSearchId, setActiveSavedSearchId] = useState<string | null>(null);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

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
    void loadSavedSearches();
  }, []);

  const loadSavedSearches = async () => {
    setSavedSearchesLoading(true);
    setSavedSearchesError('');
    try {
      const data = await savedSearchesService.getSavedSearches();
      setSavedSearches(data);
    } catch (loadError) {
      console.error('[search] Load saved searches failed:', loadError);
      setSavedSearches([]);
      setSavedSearchesError('No pudimos cargar tus búsquedas guardadas.');
    } finally {
      setSavedSearchesLoading(false);
    }
  };

  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  const handleFilterChange = (field: keyof typeof filters, value: any) => {
    setError('');
    if (field === 'searchMode') {
      setAdvancedFiltersOpen(value === 'linkedin_profile');
    }
    if (field === 'searchMode' || field === 'linkedinUrl' || field === 'revealEmail' || field === 'revealPhone') {
      setProfileSearchNotice(null);
      setLastProfilePhoneStatus(null);
      setProfilePhonePollingIds([]);
      setProfilePhonePollingStartedAt(null);
      profilePhoneToastStateRef.current = 'idle';
    }
    if (field === 'searchMode' || field === 'companyName' || field === 'companyDomains' || field === 'title' || field === 'seniorities' || field === 'maxResults') {
      setCompanyCandidates([]);
      setSelectedOrganization(null);
      setCompanySelectionPending(false);
    }
    setActiveSavedSearchId(null);
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const [isSaving, setIsSaving] = useState(false);
  const [profileSearchNotice, setProfileSearchNotice] = useState<null | {
    tone: 'info' | 'warning';
    title: string;
    description: string;
    emailState: ProfileContactState;
    phoneState: ProfileContactState;
  }>(null);
  const [lastProfilePhoneStatus, setLastProfilePhoneStatus] = useState<'not_requested' | 'queued' | 'skipped' | 'failed' | null>(null);
  const [profilePhonePollingIds, setProfilePhonePollingIds] = useState<string[]>([]);
  const [profilePhonePollingStartedAt, setProfilePhonePollingStartedAt] = useState<number | null>(null);
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
      const withDirectContactData = selectedNotContacted.filter((lead) => !!lead.email || hasLeadPhone(lead));
      let enrichedAdded = 0;
      if (withDirectContactData.length) {
        const enriched = withDirectContactData.map(mapLeadToEnriched);
        const res = await enrichedLeadsStorage.addDedup(enriched);
        enrichedAdded = res.addedCount;
      }

      const withoutDirectContactData = selectedNotContacted.filter((lead) => !lead.email && !hasLeadPhone(lead));
      const resSv = await supabaseService.addLeadsDedup(withoutDirectContactData);

      // Actualizar estado local de guardados
      const all = await supabaseService.getLeads();
      setSavedIds(new Set(all.map(l => l.id)));

      const savedToEnrichedOnly = enrichedAdded > 0 && resSv.addedCount === 0;
      const phonePendingNote =
        filters.searchMode === 'linkedin_profile' &&
        lastProfilePhoneStatus === 'queued' &&
        withDirectContactData.length > 0
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
      setSelectedOrganization((current) => result.selected_organization || (candidates.length === 1 ? candidates[0] : current));
      setProfileSearchNotice(null);
      setLastProfilePhoneStatus(null);
      setProfilePhonePollingIds([]);
      setProfilePhonePollingStartedAt(null);
      setLeads(result.leads.map((raw) => normalizeLeadForUI(raw, {
        revealEmail: true,
        revealPhone: true,
      })));
      return;
    }

    setCompanyCandidates([]);
    setCompanySelectionPending(false);
    setSelectedOrganization(null);
    setProfilePhonePollingIds([]);
    setProfilePhonePollingStartedAt(null);

    const phoneStatus = mode === 'linkedin_profile'
      ? (result.phone_enrichment?.status || null)
      : null;
    setLastProfilePhoneStatus(phoneStatus);
    setLeads(result.leads.map((raw) => normalizeLeadForUI(raw, {
      phoneStatus: phoneStatus || undefined,
      revealEmail: filters.revealEmail,
      revealPhone: filters.revealPhone,
    })));

    if (mode === 'linkedin_profile') {
      const warnings = Array.isArray(result.provider_warnings) ? result.provider_warnings.filter(Boolean) : [];
      const emailState: ProfileContactState = !filters.revealEmail
        ? 'not_requested'
        : result.leads.some((lead) => hasVisibleLeadEmail(lead))
          ? 'ready'
          : phoneStatus === 'queued'
            ? 'queued'
            : 'missing';
      const phoneState: ProfileContactState = !filters.revealPhone
        ? 'not_requested'
        : phoneStatus === 'queued'
          ? 'queued'
          : result.leads.some((lead) => hasVisibleLeadPhone(lead))
            ? 'ready'
            : 'missing';

      if (result.leads.length === 0 && phoneStatus !== 'queued') {
        setProfilePhonePollingStartedAt(null);
        setProfileSearchNotice({
          tone: 'warning',
          title: 'Perfil no disponible',
          description: result.phone_enrichment?.message || 'No encontramos información suficiente para crear un lead con esta URL.',
          emailState,
          phoneState,
        });
        return;
      }

      if (phoneStatus === 'queued') {
        const pollingIds = Array.from(new Set([
          ...(result.profile_tracking_ids || []),
          ...result.leads.map((raw) => raw.id),
        ].filter(Boolean)));

        if (pollingIds.length === 0) {
          setLastProfilePhoneStatus('failed');
          setProfilePhonePollingStartedAt(null);
          setProfileSearchNotice(buildLinkedInProfileNotice({
            emailRequested: filters.revealEmail,
            phoneRequested: filters.revealPhone,
            emailState,
            phoneState: 'missing',
          }));
          return;
        }

        setProfilePhonePollingIds(pollingIds);
        setProfilePhonePollingStartedAt(Date.now());
        setProfileSearchNotice(result.leads.length === 0
          ? {
              tone: 'info',
              title: 'Perfil en proceso',
              description: 'Estamos preparando el perfil. El resultado aparecerá aquí cuando esté disponible.',
              emailState,
              phoneState,
            }
          : buildLinkedInProfileNotice({
              emailRequested: filters.revealEmail,
              phoneRequested: filters.revealPhone,
              emailState,
              phoneState,
            }));
      } else if (phoneStatus === 'failed' && result.phone_enrichment?.message) {
        setProfilePhonePollingStartedAt(null);
        setProfileSearchNotice({
          tone: 'warning',
          title: 'Perfil encontrado, contacto pendiente',
          description: result.phone_enrichment.message,
          emailState,
          phoneState,
        });
      } else if (phoneStatus === 'skipped' || phoneStatus === 'failed') {
        setProfilePhonePollingStartedAt(null);
        setProfileSearchNotice(buildLinkedInProfileNotice({
          emailRequested: filters.revealEmail,
          phoneRequested: filters.revealPhone,
          emailState,
          phoneState,
        }));
      } else if (warnings.length > 0) {
        setProfilePhonePollingStartedAt(null);
        setProfileSearchNotice(buildLinkedInProfileNotice({
          emailRequested: filters.revealEmail,
          phoneRequested: filters.revealPhone,
          emailState,
          phoneState,
        }));
      } else if (filters.revealEmail || filters.revealPhone) {
        setProfilePhonePollingStartedAt(null);
        setProfileSearchNotice(buildLinkedInProfileNotice({
          emailRequested: filters.revealEmail,
          phoneRequested: filters.revealPhone,
          emailState,
          phoneState,
        }));
      } else {
        setProfilePhonePollingStartedAt(null);
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
    const organization = selectedOrg || selectedOrganization;
    let validationMessage = '';
    if (filters.searchMode === 'linkedin_profile' && !normalizeLinkedinProfileUrl(filters.linkedinUrl)) {
      validationMessage = 'La URL de LinkedIn no es valida.';
    } else if (filters.searchMode === 'company_name'
      && !filters.companyName.trim()
      && !organization
      && splitDomainInput(filters.companyDomains).length === 0) {
      validationMessage = 'Debes indicar un nombre de empresa o al menos un dominio.';
    } else if (filters.searchMode === 'filters' && !hasBatchSearchFilters(filters)) {
      validationMessage = 'Agrega al menos un filtro para iniciar la búsqueda.';
    }

    if (validationMessage) {
      const friendlyMessage = getFriendlySearchErrorMessage(validationMessage);
      setError(friendlyMessage);
      window.requestAnimationFrame(() => criteriaRef.current?.focus());
      if (filters.searchMode !== 'filters') {
        toast({ title: 'Revisa los criterios', description: friendlyMessage });
      }
      return;
    }

    if (submittingRef.current) return;
    submittingRef.current = true;
    const searchRunId = ++searchRunIdRef.current;

    const canUseClientQuota = typeof (Quota as any).canUseClientQuota === 'function' ? (Quota as any).canUseClientQuota : (_k: any) => true;
    const incClientQuota = typeof (Quota as any).incClientQuota === 'function' ? (Quota as any).incClientQuota : (_k: any) => { };
    const getClientLimit = typeof (Quota as any).getClientLimit === 'function' ? (Quota as any).getClientLimit : (_k: any) => 50;

    if (countQuota && !canUseClientQuota('leadSearch')) {
      toast({ title: 'Comprobando disponibilidad', description: `Validaremos si aún tienes búsquedas disponibles hoy (límite estimado: ${getClientLimit('leadSearch')}).` });
    }

    setIsLoading(true);
    setHasSearched(true);
    setLeads([]);
    setSelectedLeads(new Set());
    setPageIndex(0);
    setError('');
    setProfileSearchNotice(null);
    setLastProfilePhoneStatus(null);
    setProfilePhonePollingIds([]);
    setProfilePhonePollingStartedAt(null);
    profilePhoneToastStateRef.current = 'idle';
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      let result: LeadSearchResponse;

      if (filters.searchMode === 'linkedin_profile') {
        const linkedinUrl = normalizeLinkedinProfileUrl(filters.linkedinUrl);
        result = await searchLinkedInProfileLead({
          search_mode: 'linkedin_profile',
          linkedin_url: linkedinUrl,
          reveal_email: false,
          reveal_phone: false,
        }, abortRef.current.signal);

        const fallbackName = getLinkedinProfileDisplayName(filters.linkedinUrl) || undefined;
        const profile: Lead = result.leads[0]
          ? { ...result.leads[0], name: result.leads[0].name || fallbackName }
          : {
              id: `profile-search:${linkedinUrl}`,
              name: fallbackName,
              linkedin_url: linkedinUrl,
            };
        if (result.leads.length === 0) {
          result = {
            ...result,
            count: 1,
            leads_count: 1,
            leads: [profile],
          };
        } else if (profile.name && profile.name !== result.leads[0].name) {
          result = {
            ...result,
            leads: result.leads.map((lead, index) => index === 0 ? profile : lead),
          };
        }
        if (filters.revealEmail || filters.revealPhone) {
          try {
            const operationId = `profile-enrichment:${crypto.randomUUID()}`;
            const enrichment = await enrichLinkedInProfileLead({
              lead: profile,
              revealEmail: filters.revealEmail,
              revealPhone: filters.revealPhone,
              operationId,
              linkedinUrl,
            }, abortRef.current.signal);
            const trackingId = enrichment.enriched?.[0]?.id;
            if (trackingId) {
              const queuedLead: Lead = {
                ...profile,
                id: trackingId,
                linkedin_url: profile.linkedin_url || linkedinUrl,
                enrichment_status: 'pending',
              };
              result = {
                ...result,
                count: result.leads.length > 0 ? result.count : 1,
                leads_count: result.leads.length > 0 ? result.leads_count : 1,
                leads: result.leads.length > 0
                  ? result.leads.map((lead, index) => index === 0 ? queuedLead : lead)
                  : [queuedLead],
                enrichment_requested: true,
                profile_tracking_ids: [trackingId],
                phone_enrichment: {
                  requested: true,
                  queued: true,
                  status: 'queued',
                  message: 'Estamos buscando los datos de contacto solicitados.',
                  webhook_url: null,
                  provider_status: 202,
                  provider_details: null,
                },
              };
            }
          } catch (enrichmentError: any) {
            if (enrichmentError?.name === 'AbortError') throw enrichmentError;
            const message = String(enrichmentError?.message || 'No pudimos iniciar la búsqueda de datos de contacto.');
            result = {
              ...result,
              enrichment_requested: true,
              phone_enrichment: {
                requested: true,
                queued: false,
                status: 'failed',
                message,
                webhook_url: null,
                provider_status: null,
                provider_details: null,
              },
              provider_warnings: [...(result.provider_warnings || []), message],
            };
          }
        }
      } else if (filters.searchMode === 'company_name') {
        const companyName = filters.companyName.trim();
        const organization = selectedOrg || selectedOrganization;
        const organizationDomains = splitDomainInput(filters.companyDomains);

        result = await searchCompanyNameLeads({
          search_mode: 'company_name',
          company_name: companyName || organization?.name,
          organization_domains: organizationDomains,
          seniorities: filters.seniorities,
          titles: splitTitlesInput(filters.title),
          max_results: Math.max(1, Number(filters.maxResults) || 25),
          selected_organization_id: organization?.id,
          selected_organization_name: organization?.name,
        }, abortRef.current.signal);
      } else {
        const industryKeywords = [filters.industry.trim()].filter(Boolean);
        const companyKeywords = splitFilterInput(filters.companyKeywords);
        const companyLocations = splitFilterInput(filters.location);
        const personLocations = splitFilterInput(filters.personLocation);
        const sizeRanges = [filters.sizeRange.trim()].filter(Boolean);
        const titles = splitTitlesInput(filters.title);

        const payload: LeadsSearchParams = [{
          industry_keywords: industryKeywords,
          company_keywords: companyKeywords,
          company_location: companyLocations,
          person_locations: personLocations,
          employee_ranges: sizeRanges,
          titles,
          seniorities: filters.seniorities,
          include_similar_titles: true,
          per_page_orgs: 100,
          per_page_people: 100,
          max_org_pages: 1,
          max_people_pages_per_chunk: 1,
          enrich: false,
          max_results: Math.max(1, Math.min(100, Number(filters.maxResults) || 25)),
        }];
        result = await searchLeads(payload, abortRef.current.signal);
      }

      if (searchRunIdRef.current !== searchRunId) return;
      if (countQuota) incClientQuota('leadSearch');
      applySearchResult(result, filters.searchMode);
    } catch (error: any) {
      if (searchRunIdRef.current !== searchRunId) return;
      if (error.name !== 'AbortError') {
        const friendlyMessage = getFriendlySearchErrorMessage(error.message);
        setError(friendlyMessage);
        toast({
          title: 'No se pudo completar la busqueda',
          description: friendlyMessage,
        });
      }
      setLeads([]);
      setLastProfilePhoneStatus(null);
      setProfilePhonePollingIds([]);
      setProfilePhonePollingStartedAt(null);
    } finally {
      if (searchRunIdRef.current === searchRunId) {
        setIsLoading(false);
        submittingRef.current = false;
      }
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
    searchRunIdRef.current += 1;
    abortRef.current?.abort();
    submittingRef.current = false;
    setIsLoading(false);
    toast({ title: 'Búsqueda cancelada' });
  };

  const handleClear = () => {
    searchRunIdRef.current += 1;
    abortRef.current?.abort();
    submittingRef.current = false;
    setIsLoading(false);
    setFilters(DEFAULT_FILTERS);
    setHasSearched(false);
    setActiveSavedSearchId(null);
    setAdvancedFiltersOpen(false);
    setLeads([]);
    setSelectedLeads(new Set());
    setError('');
    setProfileSearchNotice(null);
    setLastProfilePhoneStatus(null);
    setProfilePhonePollingIds([]);
    setProfilePhonePollingStartedAt(null);
    profilePhoneToastStateRef.current = 'idle';
    setCompanyCandidates([]);
    setSelectedOrganization(null);
    setCompanySelectionPending(false);
  };

  useEffect(() => {
    if (filters.searchMode !== 'linkedin_profile' || profilePhonePollingIds.length === 0) {
      profileStatusAbortRef.current?.abort();
      profileStatusAbortRef.current = null;
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let failedAttempts = 0;
    let timeoutId: number | null = null;
    const maxAttempts = 18;
    const startedAt = Date.now();
    const maxDurationMs = maxAttempts * 5000;
    const finishWithoutContact = (description: string, items: Awaited<ReturnType<typeof getLinkedInProfileStatuses>> = []) => {
      if (cancelled) return;
      const emailState: ProfileContactState = !filters.revealEmail
        ? 'not_requested'
        : items.some((item) => hasVisibleLeadEmail(item))
          ? 'ready'
          : 'missing';
      const phoneState: ProfileContactState = !filters.revealPhone
        ? 'not_requested'
        : items.some((item) => hasVisibleLeadPhone(item))
          ? 'ready'
          : 'missing';
      setProfilePhonePollingIds([]);
      setProfilePhonePollingStartedAt(null);
      setLastProfilePhoneStatus('failed');
      profilePhoneToastStateRef.current = 'missing';
      setProfileSearchNotice({
        tone: 'warning',
        title: filters.revealEmail && filters.revealPhone
          ? 'Datos de contacto no disponibles'
          : filters.revealEmail
            ? 'Correo no disponible por ahora'
            : 'Teléfono no disponible por ahora',
        description,
        emailState,
        phoneState,
      });
    };

    const poll = async () => {
      if (cancelled) return;

      attempts += 1;
      const controller = new AbortController();
      profileStatusAbortRef.current = controller;

      try {
        const items = await getLinkedInProfileStatuses(profilePhonePollingIds, controller.signal);
        if (cancelled) return;

        if (items.length > 0) {
          const byId = new Map(items.map((item) => [String(item.id || '').trim(), item]));
          const resolvedWithRequestedData = items.filter((item) => {
            const phoneNumbers = normalizeUiPhoneNumbers(item.phone_numbers);
            const hasPhone = Boolean(item.primary_phone || getPhoneFallback(phoneNumbers));
            const hasEmail = hasVisibleLeadEmail(item);
            const emailSatisfied = !filters.revealEmail || hasEmail;
            const phoneSatisfied = !filters.revealPhone || hasPhone;
            const status = String(item.enrichment_status || '').trim();
            return emailSatisfied && phoneSatisfied && !isPendingEnrichmentStatus(status);
          });
          const stillPending = items.some((item) => {
            const status = String(item.enrichment_status || '').trim();
            return isPendingEnrichmentStatus(status);
          });

          setLeads((prev) => {
            const updated = prev.map((lead) => {
              const item = byId.get(String(lead.id || '').trim());
              if (!item) return lead;
              const nextPhoneNumbersRaw = normalizeUiPhoneNumbers(item.phone_numbers) || lead.phoneNumbers;
              const nextPrimaryPhoneRaw = item.primary_phone || getPhoneFallback(nextPhoneNumbersRaw) || lead.primaryPhone || null;
              const nextEmailRaw = hasVisibleLeadEmail(item)
                ? String(item.email || '').trim()
                : lead.email || null;
              const nextPhoneNumbers = filters.revealPhone ? (nextPhoneNumbersRaw || null) : null;
              const nextPrimaryPhone = filters.revealPhone ? nextPrimaryPhoneRaw : null;
              const nextEmail = filters.revealEmail ? nextEmailRaw : null;
              const nextLead: UILaed = {
                ...lead,
                email: nextEmail,
                phoneNumbers: nextPhoneNumbers,
                primaryPhone: nextPrimaryPhone,
                enrichmentStatus: filters.revealPhone || filters.revealEmail
                  ? (String(item.enrichment_status || '').trim() || (nextPrimaryPhoneRaw ? 'completed' : lead.enrichmentStatus))
                  : undefined,
                emailEnrichment: nextEmail ? { enriched: true } : undefined,
              };
              return nextLead;
            });
            return updated;
          });

          if (resolvedWithRequestedData.length > 0) {
            const emailReady = items.some((item) => hasVisibleLeadEmail(item));
            const phoneReady = items.some((item) => hasVisibleLeadPhone(item));
            setProfilePhonePollingIds([]);
            setProfilePhonePollingStartedAt(null);
            setProfileSearchNotice({
              tone: 'info',
              title: 'Perfil actualizado',
              description: filters.revealEmail && filters.revealPhone
                ? 'El correo y el teléfono ya están visibles en el resultado.'
                : filters.revealEmail
                  ? 'El correo ya está visible en el resultado.'
                  : 'El teléfono ya está visible en el resultado.',
              emailState: filters.revealEmail ? (emailReady ? 'ready' : 'missing') : 'not_requested',
              phoneState: filters.revealPhone ? (phoneReady ? 'ready' : 'missing') : 'not_requested',
            });
            setLastProfilePhoneStatus(null);
            if (profilePhoneToastStateRef.current !== 'found') {
              profilePhoneToastStateRef.current = 'found';
              toast({
                title: 'Datos actualizados',
                description: 'El perfil ya se actualizo en el resultado de la busqueda.',
              });
            }
            return;
          }

          if (!stillPending) {
            finishWithoutContact('Encontramos el perfil, pero el proveedor no devolvió todos los datos de contacto solicitados.', items);
            return;
          }
        }

        if (attempts >= maxAttempts || Date.now() - startedAt >= maxDurationMs) {
          finishWithoutContact(failedAttempts > 0
            ? 'No pudimos confirmar los datos de contacto después de varios intentos. Puedes volver a buscarlos.'
            : 'El proveedor está tardando más de lo esperado. Puedes volver a intentarlo en unos minutos.', items);
          return;
        }

        timeoutId = window.setTimeout(poll, 5000);
      } catch (error: any) {
        if (cancelled || error?.name === 'AbortError') return;
        failedAttempts += 1;
        console.warn('[search] profile contact polling failed:', error?.message || error);
        if (attempts >= maxAttempts || Date.now() - startedAt >= maxDurationMs) {
          finishWithoutContact('No pudimos confirmar los datos de contacto. Puedes volver a intentarlo.');
          return;
        }
        timeoutId = window.setTimeout(poll, 5000);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      profileStatusAbortRef.current?.abort();
      profileStatusAbortRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.searchMode, filters.revealEmail, filters.revealPhone, profilePhonePollingIds, toast]);

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
    const duplicate = savedSearches.find((savedSearch) => savedSearchNamesMatch(savedSearch.name, newSearchName));
    if (duplicate) {
      setSaveSearchError(`Ya existe una búsqueda llamada “${duplicate.name}”. Usa un nombre diferente.`);
      return;
    }

    setSavingSearch(true);
    setSaveSearchError('');
    try {
      const savedSearch = await savedSearchesService.saveSearch(newSearchName, filters, isShared);
      setSavedSearches((current) => [savedSearch, ...current.filter((item) => item.id !== savedSearch.id)]);
      toast({ title: 'Búsqueda guardada', description: 'Los filtros se han guardado correctamente.' });
      setSaveSearchOpen(false);
      setNewSearchName('');
      setIsShared(false);
      setActiveSavedSearchId(savedSearch.id);
    } catch (error) {
      const description = error instanceof DuplicateSavedSearchNameError
        ? error.message
        : 'No se pudo guardar la búsqueda. Intenta nuevamente.';
      setSaveSearchError(description);
      toast({ variant: 'destructive', title: 'No se guardó la búsqueda', description });
    } finally {
      setSavingSearch(false);
    }
  };

  const handleLoadSearch = (search: SavedSearch) => {
    const criteria = normalizeSavedSearchCriteria(search.criteria);
    searchRunIdRef.current += 1;
    abortRef.current?.abort();
    profileStatusAbortRef.current?.abort();
    submittingRef.current = false;
    setIsLoading(false);
    setFilters(criteria);
    setActiveSavedSearchId(search.id);
    setAdvancedFiltersOpen(Boolean(
      criteria.title ||
      criteria.seniorities.length > 0 ||
      criteria.companyDomains ||
      criteria.maxResults !== DEFAULT_FILTERS.maxResults ||
      criteria.revealEmail !== DEFAULT_FILTERS.revealEmail ||
      criteria.revealPhone !== DEFAULT_FILTERS.revealPhone
    ));
    setLeads([]);
    setSelectedLeads(new Set());
    setError('');
    setPageIndex(0);
    setPageSize(PAGE_SIZE_DEFAULT);
    setHasSearched(false);
    setProfileSearchNotice(null);
    setLastProfilePhoneStatus(null);
    setProfilePhonePollingIds([]);
    setProfilePhonePollingStartedAt(null);
    setCompanyCandidates([]);
    setSelectedOrganization(null);
    setCompanySelectionPending(false);
    toast({ title: 'Filtros cargados', description: `Se han aplicado los filtros de "${search.name}".` });
  };

  const handleRequestDeleteSearch = (e: React.MouseEvent, search: SavedSearch) => {
    e.stopPropagation();
    setSavedSearchPendingDelete(search);
  };

  const confirmDeleteSearch = async () => {
    if (!savedSearchPendingDelete) return;
    setDeletingSavedSearch(true);
    try {
      await savedSearchesService.deleteSearch(savedSearchPendingDelete.id);
      if (activeSavedSearchId === savedSearchPendingDelete.id) setActiveSavedSearchId(null);
      setSavedSearches((current) => current.filter((item) => item.id !== savedSearchPendingDelete.id));
      toast({ title: 'Búsqueda eliminada' });
    } catch (error) {
      console.error('[search] Delete saved search failed:', error);
      toast({ variant: 'destructive', title: 'No se pudo eliminar', description: 'La búsqueda guardada sigue disponible. Intenta nuevamente en unos segundos.' });
    } finally {
      setDeletingSavedSearch(false);
      setSavedSearchPendingDelete(null);
    }
  };

  const missingFilterError = error.toLowerCase().includes('al menos un filtro');

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 py-2">
      <PageHeader
        title="Búsqueda de Leads"
        description="Define tu audiencia, busca prospectos y guarda criterios para volver a usarlos."
      />

      <Card className="overflow-hidden rounded-2xl border-border/60 bg-card/90 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.16)] dark:bg-card/75">
        <CardHeader className="gap-3 border-b border-border/60 bg-muted/10 p-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0 sm:px-5">
          <div className="min-w-0 space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">Criterios de búsqueda</h2>
            <CardDescription className="truncate">
              {activeSavedSearchId
                ? `Usando “${savedSearches.find((item) => item.id === activeSavedSearchId)?.name || 'búsqueda guardada'}”`
                : 'Configura solo lo necesario para encontrar leads.'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1 sm:flex-shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="max-w-[190px] shadow-none" aria-label="Abrir búsquedas guardadas">
                  {savedSearchesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" />}
                  <span className="truncate">Guardadas{savedSearches.length > 0 ? ` (${savedSearches.length})` : ''}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 w-[min(20rem,calc(100vw-2rem))] overflow-auto">
                {savedSearchesLoading ? (
                  <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando búsquedas…
                  </div>
                ) : savedSearchesError ? (
                  <div className="space-y-2 p-3">
                    <p className="text-sm text-destructive">{savedSearchesError}</p>
                    <Button size="sm" variant="outline" onClick={() => void loadSavedSearches()}>Reintentar</Button>
                  </div>
                ) : savedSearches.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">Aún no guardaste búsquedas.</div>
                ) : (
                  savedSearches.map((savedSearch) => (
                    <div key={savedSearch.id} className="group flex items-center gap-1 rounded-md p-1 hover:bg-muted focus-within:bg-muted">
                      <button
                        type="button"
                        aria-current={activeSavedSearchId === savedSearch.id ? 'true' : undefined}
                        className="min-w-0 flex-1 rounded-md p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => handleLoadSearch(savedSearch)}
                      >
                      <span className="block min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{savedSearch.name}</span>
                          {activeSavedSearchId === savedSearch.id ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : null}
                        </div>
                        <span className="block truncate text-xs text-muted-foreground">
                          {savedSearch.isShared ? `Equipo · ${savedSearch.user?.fullName || 'Usuario'}` : 'Privada'}
                        </span>
                      </span>
                      </button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" onClick={(event) => handleRequestDeleteSearch(event, savedSearch)} aria-label={`Eliminar búsqueda guardada ${savedSearch.name}`}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="sm"
              className="shadow-none"
              aria-label="Guardar búsqueda"
              onClick={() => {
                setSaveSearchError('');
                setSaveSearchOpen(true);
              }}
            >
              <BookmarkPlus className="h-4 w-4" />
              <span className="hidden sm:inline">Guardar</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-4 sm:p-5">
          <fieldset
            ref={criteriaRef}
            disabled={isLoading}
            tabIndex={-1}
            aria-invalid={missingFilterError || undefined}
            aria-describedby={filters.searchMode === 'filters' ? 'filterRequirement' : undefined}
            className="min-w-0 space-y-5 border-0 p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
          <legend className="sr-only">Criterios de búsqueda</legend>
          <div className="grid h-10 w-full grid-cols-3 rounded-xl border border-border/60 bg-muted/60 p-1 sm:w-[420px]" role="group" aria-label="Modo de búsqueda">
            {([
              ['filters', 'Filtros'],
              ['company_name', 'Empresa'],
              ['linkedin_profile', 'Perfil'],
            ] as const).map(([value, label]) => {
              const active = filters.searchMode === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => handleFilterChange('searchMode', value)}
                  className={cn(
                    'inline-flex items-center justify-center whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
                    active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="space-y-4">
            {filters.searchMode === 'linkedin_profile' ? (
              <div className="space-y-4">
                <div className="max-w-3xl space-y-2">
                  <Label htmlFor="linkedinUrl">URL del perfil de LinkedIn *</Label>
                  <Input
                    id="linkedinUrl"
                    inputMode="url"
                    autoComplete="url"
                    placeholder="https://www.linkedin.com/in/nombre"
                    value={filters.linkedinUrl}
                    onChange={(event) => handleFilterChange('linkedinUrl', event.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">Define qué datos laborales solicitarás al enriquecer los perfiles encontrados.</p>
                </div>
                <Collapsible open={advancedFiltersOpen} onOpenChange={setAdvancedFiltersOpen}>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="px-0 text-muted-foreground hover:bg-transparent hover:text-foreground">
                      <SlidersHorizontal className="h-4 w-4" />
                      Datos de contacto
                      <ChevronDown className={`h-4 w-4 transition-transform ${advancedFiltersOpen ? 'rotate-180' : ''}`} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-muted/20 p-3">
                        <div>
                          <Label htmlFor="revealEmail">Correo laboral</Label>
                          <p className="text-xs text-muted-foreground">Solicita únicamente direcciones de trabajo.</p>
                        </div>
                        <Switch id="revealEmail" checked={filters.revealEmail} onCheckedChange={(value) => handleFilterChange('revealEmail', value)} />
                      </div>
                      <div className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-muted/20 p-3">
                        <div>
                          <Label htmlFor="revealPhone">Teléfono</Label>
                          <p className="text-xs text-muted-foreground">Se completa de forma asíncrona cuando está disponible.</p>
                        </div>
                        <Switch id="revealPhone" checked={filters.revealPhone} onCheckedChange={(value) => handleFilterChange('revealPhone', value)} />
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
                <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
                  El resultado inicial muestra datos profesionales. Los datos de contacto se actualizan en segundo plano.
                </p>
              </div>
            ) : filters.searchMode === 'company_name' ? (
              <div className="space-y-4">
                <div className="max-w-3xl space-y-2">
                  <Label htmlFor="companyName">Empresa *</Label>
                  <Input
                    id="companyName"
                    autoComplete="organization"
                    placeholder="Ej. Microsoft"
                    value={filters.companyName}
                    onChange={(event) => handleFilterChange('companyName', event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">También puedes buscar solo por dominio desde las opciones avanzadas.</p>
                </div>
                <Collapsible open={advancedFiltersOpen} onOpenChange={setAdvancedFiltersOpen}>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="px-0 text-muted-foreground hover:bg-transparent hover:text-foreground">
                      <SlidersHorizontal className="h-4 w-4" />
                      Opciones avanzadas
                      <ChevronDown className={`h-4 w-4 transition-transform ${advancedFiltersOpen ? 'rotate-180' : ''}`} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="companyDomains">Dominio de la empresa</Label>
                        <Input id="companyDomains" placeholder="Ej. empresa.com, empresa.cl" value={filters.companyDomains} onChange={(event) => handleFilterChange('companyDomains', event.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="companyTitles">Cargos</Label>
                        <Input id="companyTitles" placeholder="Ej. VP Marketing, Marketing Director" value={filters.title} onChange={(event) => handleFilterChange('title', event.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="maxResults">Máximo de resultados</Label>
                        <Input id="maxResults" type="number" min={1} max={100} value={String(filters.maxResults)} onChange={(event) => handleFilterChange('maxResults', Math.min(100, Math.max(1, Number(event.target.value) || 25)))} />
                      </div>
                      <div className="md:col-span-2">
                        <MultiCheckDropdown label="Nivel de responsabilidad" options={APOLLO_SENIORITIES} value={filters.seniorities} onChange={(next) => handleFilterChange('seniorities', next)} placeholder="Todos los niveles" disabled={isLoading} />
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                {selectedOrganization ? (
                  <div className="flex max-w-3xl items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                    <div>
                      <span className="font-medium text-emerald-900 dark:text-emerald-100">Empresa seleccionada: </span>
                      <span className="text-emerald-800 dark:text-emerald-200">{selectedOrganization.name}{selectedOrganization.primary_domain ? ` · ${selectedOrganization.primary_domain}` : ''}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-4">
                <p id="filterRequirement" className={cn('text-sm text-muted-foreground', missingFilterError && 'font-medium text-destructive')}>
                  {missingFilterError
                    ? error
                    : 'Todos los campos son opcionales, pero necesitas completar al menos uno para buscar.'}
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="industry">Industria</Label>
                    <Select value={filters.industry || 'all'} onValueChange={(value) => handleFilterChange('industry', value === 'all' ? '' : value)}>
                      <SelectTrigger id="industry"><SelectValue placeholder="Cualquier industria" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" disabled={isLoading}>Cualquier industria</SelectItem>
                        {industries.map((industry) => <SelectItem key={industry} value={industry} disabled={isLoading}>{INDUSTRY_LABELS_ES[industry] || industry}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Usa una categoría para obtener resultados más precisos.</p>
                  </div>
                   <div className="space-y-2">
                     <Label htmlFor="companyKeywords">Palabras clave de empresa</Label>
                     <Input id="companyKeywords" aria-describedby="companyKeywordsHelp" placeholder="Ej. payroll, onboarding" value={filters.companyKeywords} onChange={(event) => handleFilterChange('companyKeywords', event.target.value)} />
                     <p id="companyKeywordsHelp" className="text-xs text-muted-foreground">Busca términos asociados a la actividad o propuesta de la empresa. Separa varios con comas.</p>
                   </div>
                   <div className="space-y-2">
                     <Label htmlFor="location">Sede de la empresa</Label>
                     <Input id="location" aria-describedby="companyLocationHelp" placeholder="Ej. Chile, Argentina" value={filters.location} onChange={(event) => handleFilterChange('location', event.target.value)} />
                     <p id="companyLocationHelp" className="text-xs text-muted-foreground">Filtra por la ubicación de la organización, no por la residencia del lead.</p>
                   </div>
                   <div className="space-y-2">
                     <Label htmlFor="personLocation">Ubicación del lead</Label>
                     <Input id="personLocation" aria-describedby="personLocationHelp" placeholder="Ej. Santiago, Buenos Aires" value={filters.personLocation} onChange={(event) => handleFilterChange('personLocation', event.target.value)} />
                     <p id="personLocationHelp" className="text-xs text-muted-foreground">Filtra por la ubicación personal o laboral del prospecto.</p>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="sizeRange">Tamaño de empresa</Label>
                    <Select name="sizeRange" value={filters.sizeRange || 'all'} onValueChange={(value) => handleFilterChange('sizeRange', value === 'all' ? '' : value)}>
                      <SelectTrigger id="sizeRange"><SelectValue placeholder="Cualquier tamaño" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" disabled={isLoading}>Cualquier tamaño</SelectItem>
                        {companySizes.map((size) => <SelectItem key={size} value={size} disabled={isLoading}>{size.replace('+', ' o más')}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Collapsible open={advancedFiltersOpen} onOpenChange={setAdvancedFiltersOpen}>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="px-0 text-muted-foreground hover:bg-transparent hover:text-foreground">
                      <SlidersHorizontal className="h-4 w-4" />
                      Cargo, nivel y volumen
                      <ChevronDown className={`h-4 w-4 transition-transform ${advancedFiltersOpen ? 'rotate-180' : ''}`} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="title">Cargo o posición</Label>
                        <Input id="title" placeholder="Ej. Marketing Director" value={filters.title} onChange={(event) => handleFilterChange('title', event.target.value)} />
                      </div>
                      <MultiCheckDropdown label="Nivel de responsabilidad" options={APOLLO_SENIORITIES} value={filters.seniorities} onChange={(next) => handleFilterChange('seniorities', next)} placeholder="Todos los niveles" disabled={isLoading} />
                      <div className="space-y-2">
                        <Label htmlFor="filterMaxResults">Máximo de resultados</Label>
                        <Input id="filterMaxResults" type="number" min={1} max={100} value={String(filters.maxResults)} onChange={(event) => handleFilterChange('maxResults', Math.min(100, Math.max(1, Number(event.target.value) || 25)))} />
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  La búsqueda no enriquece contactos. Puedes enriquecerlos después desde Leads guardados.
                </p>
              </div>
            )}
          </div>
          </fieldset>

          <div className="sticky bottom-2 z-10 flex flex-col gap-2 rounded-xl border border-border/70 bg-card/95 p-2 pt-2 shadow-lg backdrop-blur sm:static sm:flex-row sm:items-center sm:justify-end sm:rounded-none sm:border-x-0 sm:border-b-0 sm:bg-transparent sm:p-0 sm:pt-4 sm:shadow-none sm:backdrop-blur-none">
            <Button variant="ghost" className="shadow-none" onClick={handleClear} disabled={isLoading}><X className="h-4 w-4" />Limpiar</Button>
            {isLoading ? <Button variant="outline" className="shadow-none" onClick={handleAbort}>Cancelar</Button> : null}
            <Button className="shadow-none sm:min-w-36" onClick={handleSearch} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {isLoading ? 'Buscando…' : 'Buscar leads'}
            </Button>
          </div>

          {profileSearchNotice ? (
            <Alert
              className={cn(
                'mt-4 overflow-hidden border-border/60 bg-card/90',
                profileSearchNotice.tone === 'warning' && 'border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100',
              )}
            >
              {profileSearchNotice.tone === 'warning'
                ? <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
                : (profilePhonePollingIds.length > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Info className="h-4 w-4" />)}
              <AlertTitle>{profileSearchNotice.title}</AlertTitle>
              <AlertDescription>
                <div className="space-y-3">
                  <p>{profileSearchNotice.description}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-2 text-sm">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span>Correo</span>
                      <Badge variant="outline" className={statusChipClasses(profileSearchNotice.emailState)}>
                        {profileSearchNotice.emailState === 'ready' ? 'Disponible' : profileSearchNotice.emailState === 'queued' ? 'Buscando…' : profileSearchNotice.emailState === 'missing' ? 'No disponible' : 'No solicitado'}
                      </Badge>
                    </div>
                    <div className="inline-flex items-center gap-2 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span>Teléfono</span>
                      <Badge variant="outline" className={statusChipClasses(profileSearchNotice.phoneState)}>
                        {profileSearchNotice.phoneState === 'ready' ? 'Disponible' : profileSearchNotice.phoneState === 'queued' ? 'Buscando…' : profileSearchNotice.phoneState === 'missing' ? 'No disponible' : 'No solicitado'}
                      </Badge>
                    </div>
                  </div>
                  {profilePhonePollingIds.length > 0 ? <p className="text-xs text-muted-foreground">Puedes seguir usando la app; este resultado se actualizará automáticamente.</p> : null}
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          {filters.searchMode === 'company_name' && companySelectionPending && companyCandidates.length > 0 ? (
            <div className="mt-4 rounded-xl border border-border/60 bg-muted/20 p-4">
              <div className="mb-3 flex items-start gap-3">
                <Building2 className="mt-0.5 h-4 w-4 text-blue-600" />
                <div>
                  <div className="font-medium">Selecciona la empresa correcta</div>
                  <p className="text-sm text-muted-foreground">Encontramos varias coincidencias para “{filters.companyName}”. Elige una para continuar.</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {companyCandidates.map((candidate) => (
                  <button
                    key={candidate.id}
                   type="button"
                    disabled={isLoading}
                    onClick={() => handleSelectOrganization(candidate)}
                    className="rounded-xl border border-border/60 bg-background p-3 text-left transition hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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

      <Card className="overflow-hidden rounded-2xl border-border/60 bg-card/90 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.16)] dark:bg-card/75">
        <CardHeader className="flex flex-col gap-3 border-b border-border/60 bg-muted/10 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">Resultados</h2>
            <CardDescription role="status" aria-live="polite" aria-atomic="true">
              {isLoading
                ? 'Buscando leads que coincidan con tus criterios…'
                : leads.length > 0
                ? `Mostrando ${pagedLeads.length} de ${leads.length} leads.`
                : companySelectionPending
                  ? 'Selecciona una empresa para continuar.'
                  : hasSearched
                    ? 'Revisa el resultado o ajusta los criterios.'
                    : 'Aquí aparecerán los leads que encuentres.'}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={selectedLeads.size === 0 || isSaving}
            onClick={handleSaveSelectedLeads}
            className="shadow-none"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isSaving ? 'Guardando…' : `Guardar seleccionados${selectedLeads.size > 0 ? ` (${selectedLeads.size})` : ''}`}
          </Button>
        </CardHeader>
        <CardContent className="p-4 sm:p-5">
          {error && !missingFilterError ? (
            <Alert role="alert" className="mb-4 rounded-2xl border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
              <AlertTitle>No pudimos completar la búsqueda</AlertTitle>
              <AlertDescription className="space-y-3 text-amber-800 dark:text-amber-100/80">
                <p id="searchValidationError">{error}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" className="border-amber-300 bg-background/80 text-foreground hover:bg-background dark:border-amber-500/40" onClick={handleSearch} disabled={isLoading}>
                    Intentar de nuevo
                  </Button>
                  <Button size="sm" variant="ghost" className="text-amber-900 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-500/10" onClick={() => setError('')}>
                    Ocultar aviso
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
          {isLoading ? (
            <div className="space-y-2" aria-busy="true" aria-label="Buscando leads">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex items-center gap-3 rounded-xl border border-border/60 p-3">
                  <Skeleton className="h-4 w-4" />
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40 max-w-full" />
                    <Skeleton className="h-3 w-64 max-w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : pagedLeads.length > 0 ? (
            <>
              <div className="space-y-2 md:hidden">
                {pagedLeads.map((lead) => {
                  const already = savedIds.has(lead.id);
                  const contacted = !!((lead.id && contactedIds.has(lead.id)) || (lead.email && contactedIds.has(lead.email)));
                  const disabled = already || contacted;
                  return (
                    <div key={lead.id} className="rounded-xl border border-border/60 p-3" data-state={selectedLeads.has(lead.id) ? 'selected' : undefined}>
                      <div className="flex items-start gap-3">
                        <Checkbox aria-label={`Seleccionar ${lead.name}`} className="mt-1" disabled={disabled} checked={selectedLeads.has(lead.id)} onCheckedChange={(checked) => handleSelectLead(lead.id, Boolean(checked))} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{lead.name}</p>
                              <p className="line-clamp-2 text-sm text-muted-foreground">{lead.title}</p>
                            </div>
                            {already ? <Badge variant="secondary">Guardado</Badge> : contacted ? <Badge variant="outline">Contactado</Badge> : null}
                          </div>
                          <p className="mt-2 truncate text-sm">{lead.company}</p>
                          <p className="truncate text-xs text-muted-foreground">{lead.industry}</p>
                          {lead.email ? <p className="mt-2 truncate text-xs text-muted-foreground">{lead.email}</p> : null}
                          {filters.searchMode === 'linkedin_profile' && filters.revealPhone ? (
                            <p className="mt-1 text-xs text-muted-foreground">{lead.primaryPhone || (isPendingEnrichmentStatus(lead.enrichmentStatus) ? 'Teléfono en proceso…' : 'Sin teléfono disponible')}</p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="hidden overflow-x-auto rounded-xl border border-border/60 md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[52px]">
                        <Checkbox aria-label="Seleccionar todos los leads de esta página" onCheckedChange={(checked) => handleSelectAll(Boolean(checked))} checked={isPageAllSelected} />
                      </TableHead>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Cargo</TableHead>
                      <TableHead>Empresa</TableHead>
                      <TableHead>Industria</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedLeads.map(lead => {
                    const already = savedIds.has(lead.id);
                    const contacted = !!((lead.id && contactedIds.has(lead.id)) || (lead.email && contactedIds.has(lead.email)));
                    const disabled = already || contacted;
                    return (
                      <TableRow key={lead.id} data-state={selectedLeads.has(lead.id) ? "selected" : ""}>
                        <TableCell>
                          <Checkbox
                            aria-label={`Seleccionar ${lead.name}`}
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
                            <div>
                              <div className="font-medium">{lead.name}</div>
                              {(lead.email || filters.searchMode === 'linkedin_profile') ? (
                                <div className="mt-1 flex flex-col gap-1 text-xs">
                                  {filters.searchMode === 'linkedin_profile' && filters.revealEmail ? (
                                    lead.email ? (
                                      <span className="text-muted-foreground">{lead.email}</span>
                                    ) : (
                                      <span className="text-amber-700">Correo no disponible</span>
                                    )
                                  ) : lead.email ? <span className="text-muted-foreground">{lead.email}</span> : null}
                                  {filters.searchMode === 'linkedin_profile' && filters.revealPhone ? (
                                    lead.primaryPhone ? (
                                      <span className="font-medium text-emerald-600">{lead.primaryPhone}</span>
                                    ) : isPendingEnrichmentStatus(lead.enrichmentStatus) ? (
                                      <span className="inline-flex items-center gap-1 text-blue-600">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        Teléfono en proceso...
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground">Sin teléfono visible</span>
                                    )
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{lead.title}</TableCell>
                        <TableCell>{lead.company}</TableCell>
                        <TableCell>{lead.industry}</TableCell>
                      </TableRow>
                    );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : !error ? (
            <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/10 px-6 py-8 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Search className="h-5 w-5" />
              </div>
              <p className="font-medium">
                {companySelectionPending
                  ? 'Elige una empresa para continuar'
                  : filters.searchMode === 'linkedin_profile' && profileSearchNotice
                    ? 'El perfil aún no está disponible'
                    : hasSearched
                      ? 'No encontramos leads con estos criterios'
                      : 'Tus resultados aparecerán aquí'}
              </p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {companySelectionPending
                  ? 'Selecciona una de las coincidencias mostradas arriba.'
                  : hasSearched
                    ? 'Prueba ampliando la ubicación, el tamaño de empresa o el cargo.'
                    : 'Completa los criterios y selecciona Buscar leads.'}
              </p>
            </div>
          ) : null}
          {totalPages > 1 && (
            <div className="flex flex-col gap-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                Mostrando{' '}
                {leads.length === 0 ? '0' : `${pageIndex * pageSize + 1}–${Math.min(leads.length, (pageIndex + 1) * pageSize)}`} de {leads.length}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  name="pageSize"
                  value={String(pageSize)}
                  onValueChange={(v) => { const n = Number(v); if (!Number.isNaN(n)) { setPageSize(n); setPageIndex(0); } }}
                >
                  <SelectTrigger className="w-full sm:w-[150px]"><SelectValue placeholder="Tamaño de página" /></SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((opt) => (<SelectItem key={opt} value={String(opt)}>{opt} / página</SelectItem>))}
                  </SelectContent>
                </Select>
                <Button className="flex-1 sm:flex-none" variant="outline" onClick={() => setPageIndex((p) => Math.max(0, p - 1))} disabled={pageIndex === 0}>Anterior</Button>
                <Button className="flex-1 sm:flex-none" variant="outline" onClick={() => setPageIndex((p) => (p + 1 < totalPages ? p + 1 : p))} disabled={pageIndex + 1 >= totalPages}>Siguiente</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={saveSearchOpen} onOpenChange={setSaveSearchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Guardar búsqueda</DialogTitle>
            <DialogDescription>Guarda los criterios actuales para volver a usarlos.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="search-name">Nombre de la búsqueda</Label>
              <Input
                id="search-name"
                value={newSearchName}
                onChange={(event) => {
                  setNewSearchName(event.target.value);
                  setSaveSearchError('');
                }}
                placeholder="Ej. Gerentes de Marketing en Chile"
                aria-invalid={Boolean(saveSearchError)}
                aria-describedby={saveSearchError ? 'save-search-error' : undefined}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && newSearchName.trim() && !savingSearch) void handleSaveSearch();
                }}
              />
              {saveSearchError ? <p id="save-search-error" className="text-sm text-destructive">{saveSearchError}</p> : null}
            </div>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border/60 p-3">
              <div>
                <Label htmlFor="shared">Compartir con el equipo</Label>
                <p className="text-xs text-muted-foreground">Otros miembros podrán cargar estos criterios.</p>
              </div>
              <Switch id="shared" checked={isShared} onCheckedChange={setIsShared} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveSearchOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveSearch} disabled={savingSearch || !newSearchName.trim()}>
              {savingSearch ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {savingSearch ? 'Guardando…' : 'Guardar búsqueda'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!savedSearchPendingDelete} onOpenChange={(open) => !open && !deletingSavedSearch && setSavedSearchPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar búsqueda guardada</AlertDialogTitle>
            <AlertDialogDescription>
              Quitaremos “{savedSearchPendingDelete?.name}” de tus búsquedas guardadas. No afecta los leads encontrados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingSavedSearch}>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDeleteSearch} disabled={deletingSavedSearch}>
              {deletingSavedSearch ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {deletingSavedSearch ? 'Eliminando…' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
