"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { InitialsAvatar } from '@/components/initials-avatar';
import { safeAvatarUrl } from '@/lib/avatar';
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
import { companySizes } from '@/lib/data';
import { organizationService } from '@/lib/services/organization-service';
import type { Lead as UILaed, SavedSearch } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Save, X, ChevronDown, ChevronRight, Loader2, Bookmark, BookmarkPlus, Trash2, Info, AlertCircle, Building2, CheckCircle2, Mail, Phone, SlidersHorizontal, Upload, Users } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { supabaseService } from '@/lib/supabase-service';
import { enrichedLeadsStorage } from '@/lib/services/enriched-leads-service';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import * as Quota from '@/lib/quota-client';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_OPTIONS } from '@/lib/search-config';
import { companySearchPrefill } from '@/lib/search/company-prefill';
import {
  getLinkedInProfileStatuses,
  enrichApolloOrganization,
  ApolloOrganizationEnrichmentClientError,
  searchCompanies,
  searchCompanyNameLeads,
  searchCompanyPeople,
  searchLeads,
  searchLinkedInProfileLead,
  type CompanySearchOrganization,
  type LeadsSearchParams,
} from '@/lib/leads-client';
import { ToastAction } from '@/components/ui/toast';
import { useRouter } from 'next/navigation';
import { activeFilterChips, idealCustomerStarter, savedLeadsToast, searchStartersFor, type ActiveFilterChip, type SearchStarter } from '@/lib/search/search-guidance';
import { mapProfileToForm } from '@/lib/profile/profile-mappings';
import { profileService } from '@/lib/services/profile-service';
import { FilterRelaxHint } from '@/components/search/SearchGuidance';
import { ProfileSearchProblemAlert } from '@/components/search/ProfileSearchProblemAlert';
import {
  ProfileSearchProblemError, profileProblemFromMessage, profileSearchMessage, profileSearchPersonHint, profileUrlProblem,
  type ProfileSearchAction, type ProfileSearchMessage,
} from '@/lib/search/profile-search-outcome';
import type { Lead, LeadSearchResponse } from '@/lib/schemas/leads';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { APOLLO_SENIORITIES } from '@/lib/apollo-taxonomies';
import { DuplicateSavedSearchNameError, savedSearchesService } from '@/lib/services/saved-searches-service';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { splitDomainInput } from '@/lib/domain';
import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';
import { hasUsableLinkedInProfileData } from '@/lib/linkedin-profile-result';
import { Badge } from '@/components/ui/badge';
import { TeamLockBadge } from '@/components/collaboration/TeamLockBadge';
import { useTeamLocks } from '@/hooks/use-team-locks';
import { normalizeLockEmail, normalizeLockLinkedin } from '@/lib/team-lock';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  DEFAULT_LEAD_SEARCH_FILTERS,
  normalizeSavedSearchCriteria,
  savedSearchNamesMatch,
  type LeadSearchMode,
} from '@/lib/search/saved-search-criteria';
import { MultiCheckDropdown } from '@/components/search/MultiCheckDropdown';
import {
  buildLinkedInProfileNotice, getFriendlySearchErrorMessage, hasBatchSearchFilters, hasLeadPhone, hasVisibleLeadEmail,
  hasVisibleLeadPhone, isPendingEnrichmentStatus, mapLeadToEnriched, normalizeLeadForUI, splitFilterInput, splitTitlesInput,
  normalizeUiPhoneNumbers, contactStateBadge, displayDomain, getPhoneFallback, type ProfileContactState,
  companyFilterSignature, contactedKeys, isLeadContacted, isLeadSaved, peopleFilterSignature, type SavedLeadIds,
} from '@/lib/search/lead-ui';
import { ResultsActionBar } from '@/components/search/ResultsActionBar';
import { SearchIntro } from '@/components/search/SearchIntro';
import { SearchLeadRow } from '@/components/search/SearchLeadRow';

const DEFAULT_FILTERS = DEFAULT_LEAD_SEARCH_FILTERS;

type SearchMode = LeadSearchMode;


export default function SearchPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [leads, setLeads] = useState<UILaed[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [contactedIds, setContactedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [profileOnlyRetry, setProfileOnlyRetry] = useState(false);
  // A LinkedIn profile search problem with its next step (src/lib/search/profile-search-outcome.ts).
  const [profileProblem, setProfileProblem] = useState<ProfileSearchMessage | null>(null);
  // The person a failed profile search was looking for, shown while searching for them by company.
  const [companySearchHint, setCompanySearchHint] = useState('');
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
  // On phones the criteria fold into one bar once there are results, so the results are what you see first.
  const [criteriaOpen, setCriteriaOpen] = useState(true);

  // Company-first flow: filtros → empresas → ventanas por empresa (50 por empresa).
  type CompanyWindowState = {
    organization: CompanySearchOrganization;
    leads: UILaed[];
    page: number;
    perPage: number;
    totalEntries?: number;
    totalPages?: number;
    isLoading: boolean;
    isExpanding: boolean;
    hasMore: boolean;
    error: string;
    deliveredIds: string[];
  };
  const [filterStep, setFilterStep] = useState<'filters' | 'companies' | 'people'>('filters');
  const [companies, setCompanies] = useState<CompanySearchOrganization[]>([]);
  const [companiesPage, setCompaniesPage] = useState(1);
  const [companiesTotalPages, setCompaniesTotalPages] = useState(1);
  const [companiesTotalEntries, setCompaniesTotalEntries] = useState<number | undefined>(undefined);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<string>>(new Set());
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [companyWindows, setCompanyWindows] = useState<Record<string, CompanyWindowState>>({});
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(false);
  const [isLoadingCompanyPeople, setIsLoadingCompanyPeople] = useState(false);
  const companiesAbortRef = useRef<AbortController | null>(null);
  const companyPeopleAbortRef = useRef<AbortController | null>(null);
  const companyRun = useRef(0);
  const expandingCompanies = useRef(new Set<string>());

  const activeWindow = activeCompanyId ? companyWindows[activeCompanyId] : undefined;
  const companyWindowList = useMemo(
    () => Object.values(companyWindows).sort((a, b) => a.organization.name.localeCompare(b.organization.name, 'es')),
    [companyWindows],
  );
  // Results another member already works (Plan 5, PR-9b): matched by email, provider id or LinkedIn; empty without collaboration.
  const lockPeople = useMemo(() => [...pagedLeads, ...(activeWindow?.leads || [])], [pagedLeads, activeWindow]);
  const teamLocks = useTeamLocks({
    emails: lockPeople.map(lead => normalizeLockEmail(lead.email)).filter(email => email.includes('@')),
    providerIds: lockPeople.map(lead => String(lead.id || '')).filter(Boolean),
    linkedinUrls: lockPeople.map(lead => normalizeLockLinkedin(lead.linkedinUrl)).filter(Boolean),
  });
  const teamLockFor = (lead: UILaed) => teamLocks
    ? teamLocks.byEmail[normalizeLockEmail(lead.email)] || teamLocks.byProviderId[String(lead.id || '')] || teamLocks.byLinkedin[normalizeLockLinkedin(lead.linkedinUrl)]
    : undefined;
  const [savedApolloIds, setSavedApolloIds] = useState<Set<string>>(new Set());
  const savedLeadIds = useMemo<SavedLeadIds>(() => ({ ids: savedIds, providerIds: savedApolloIds }), [savedIds, savedApolloIds]);
  const isSavedLead = (lead: UILaed) => isLeadSaved(lead, savedLeadIds);
  const isContactedLead = (lead: UILaed) => isLeadContacted(lead, contactedIds);
  // The filters each list was searched with. Editing a filter marks the list as old instead of erasing it.
  const [companySearchSignature, setCompanySearchSignature] = useState('');
  const [peopleSearchSignature, setPeopleSearchSignature] = useState('');

  const refreshSavedApolloIds = async () => {
    try {
      const [saved, enriched] = await Promise.all([
        supabaseService.getLeads().catch(() => [] as UILaed[]),
        enrichedLeadsStorage.get().catch(() => [] as any[]),
      ]);
      const ids = new Set<string>();
      for (const lead of (saved || []) as any[]) {
        const apolloId = String(lead?.sourceProviderId || lead?.apolloId || '').trim();
        if (apolloId) ids.add(apolloId);
        const lid = String(lead?.id || '').trim();
        // Legacy rows may already store the Apollo id as the primary id.
        if (lid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lid)) ids.add(lid);
      }
      const enrichedList = Array.isArray(enriched) ? enriched : (enriched as any)?.leads || [];
      for (const lead of enrichedList as any[]) {
        const apolloId = String(lead?.sourceProviderId || lead?.sourceProvider_id || lead?.apolloId || '').trim();
        if (apolloId) ids.add(apolloId);
      }
      setSavedApolloIds(ids);
    } catch {
      // Saved exclusion is best-effort; windows still work without it.
    }
  };

  useEffect(() => {
    void refreshSavedApolloIds();
  }, []);

  const getCompanyPersonFilters = () => {
    // Industry is legacy: never sent to Apollo. If a saved search still carries it,
    // surface it once as company keywords so the user reviews it explicitly.
    const legacyIndustry = String((filters as any)?.industry || '').trim();
    const companyKeywords = [...splitFilterInput(filters.companyKeywords), ...(legacyIndustry ? [legacyIndustry] : [])]
      .map((item) => item.trim()).filter(Boolean);
    return {
      legacyIndustry,
      companyKeywords,
      companyNameFilter: String(filters.companyNameFilter || '').trim(),
      companyLocations: splitFilterInput(filters.location),
      sizeRanges: [String(filters.sizeRange || '').trim()].filter(Boolean),
      titles: splitTitlesInput(filters.title),
      seniorities: Array.isArray(filters.seniorities) ? filters.seniorities : [],
      personLocations: splitFilterInput(filters.personLocation),
      leadsPerCompany: Math.min(100, Math.max(1, Number(filters.maxResults) || 50)),
    };
  };

  const handleSearchCompanies = async (page = 1) => {
    const { legacyIndustry, companyKeywords, companyNameFilter, companyLocations, sizeRanges } = getCompanyPersonFilters();
    if (companyKeywords.length === 0 && !companyNameFilter && companyLocations.length === 0 && sizeRanges.length === 0) {
      const message = 'Agrega al menos un filtro de empresa para iniciar la búsqueda.';
      setError(message);
      toast({ title: 'Revisa los criterios', description: message });
      return;
    }
    if (legacyIndustry) {
      toast({
        title: 'Revisa tus criterios',
        description: `Tu búsqueda guardada usaba Industria (“${legacyIndustry}”). La movimos a Palabras clave para que la revises antes de continuar.`,
      });
    }
    companiesAbortRef.current?.abort();
    const controller = new AbortController();
    companiesAbortRef.current = controller;
    setIsLoadingCompanies(true);
    setIsLoading(true);
    setError('');
    setHasSearched(true);
    try {
      const result = await searchCompanies({
        company_name: companyNameFilter || undefined,
        company_keywords: companyKeywords,
        company_location: companyLocations,
        employee_ranges: sizeRanges,
        page,
        per_page: 25,
      } as any, controller.signal);
      if (controller.signal.aborted) return;
      const orgs = Array.isArray(result.organizations) ? result.organizations : [];
      setCompanies((current) => page === 1 ? orgs : [...new Map([...current, ...orgs].map((org) => [org.id, org])).values()]);
      setCompaniesPage(Number(result.page ?? page) || page);
      setCompaniesTotalPages(Number(result.total_pages ?? 1) || 1);
      setCompaniesTotalEntries(result.total_entries);
      if (page === 1) {
        setSelectedCompanyIds(new Set());
        // A new company list starts over: the contacts found in the previous companies no longer apply.
        setCompanySearchSignature(companyFilterSignature(filters));
        setCompanyWindows({});
        setActiveCompanyId(null);
        setLeads([]);
        setSelectedLeads(new Set());
        setPeopleSearchSignature('');
      }
      setFilterStep('companies');
      if (orgs.length === 0) {
        setError('No encontramos empresas con estos filtros. Prueba ampliando palabras clave, sede o tamaño.');
      }
    } catch (searchError: any) {
      if (searchError?.name === 'AbortError') return;
      const friendlyMessage = getFriendlySearchErrorMessage(searchError?.message);
      setError(friendlyMessage);
      toast({ title: 'No se pudo completar la búsqueda', description: friendlyMessage });
    } finally {
      if (companiesAbortRef.current === controller) {
        setIsLoadingCompanies(false);
        setIsLoading(false);
      }
    }
  };

  const fetchCompanyWindowPage = async (organization: CompanySearchOrganization, page: number, perPage: number, excludeIds: string[], signal?: AbortSignal) => {
    const { titles, seniorities, personLocations } = getCompanyPersonFilters();
    const result = await searchCompanyPeople({
      organization_id: organization.id,
      titles,
      seniorities,
      person_locations: personLocations,
      include_similar_titles: true,
      page,
      per_page: perPage,
      exclude_person_ids: [],
    }, signal);
    const rawLeads = Array.isArray((result as any)?.leads) ? (result as any).leads : [];
    // Exclude already saved (by Apollo id) and already delivered in this window.
    const delivered = new Set(excludeIds.map((id) => String(id)));
    const fresh = rawLeads.filter((raw: any) => {
      const apolloId = String(raw?.id || raw?.source_provider_id || '').trim();
      if (!apolloId) return false;
      if (delivered.has(apolloId)) return false;
      if (savedApolloIds.has(apolloId)) return false;
      return true;
    });
    return {
      leads: fresh.map((raw: any) => normalizeLeadForUI(raw, { revealEmail: true, revealPhone: false, organization })),
      totalEntries: (result as any)?.total_entries as number | undefined,
      totalPages: (result as any)?.total_pages as number | undefined,
      hasMore: page < 500 && (typeof result.total_entries === 'number' ? page * perPage < result.total_entries : Number(result.raw_count ?? rawLeads.length) >= perPage),
    };
  };

  const handleSearchCompanyPeople = async () => {
    if (isLoadingCompanyPeople) return;
    const run = ++companyRun.current;
    companyPeopleAbortRef.current?.abort();
    const controller = new AbortController();
    companyPeopleAbortRef.current = controller;
    const selected = companies.filter((org) => selectedCompanyIds.has(org.id));
    if (selected.length === 0) {
      toast({ title: 'Selecciona empresas', description: 'Elige al menos una empresa para buscar contactos.' });
      return;
    }
    const { leadsPerCompany } = getCompanyPersonFilters();
    const peopleSignature = peopleFilterSignature(filters);
    const reuseWindows = peopleSearchSignature === peopleSignature;
    setIsLoadingCompanyPeople(true);
    setIsLoading(true);
    setError('');
    try {
      // Concurrency limited so one slow company does not block the rest.
      const nextWindows: Record<string, CompanyWindowState> = {};
      const queue = [...selected];
      const workers = Array.from({ length: Math.min(5, queue.length) }, async () => {
        while (queue.length > 0) {
          if (controller.signal.aborted || run !== companyRun.current) return;
          const organization = queue.shift();
          if (!organization) return;
          try {
            if (reuseWindows && companyWindows[organization.id]) {
              nextWindows[organization.id] = companyWindows[organization.id];
              continue;
            }
            const { leads, totalEntries, totalPages, hasMore } = await fetchCompanyWindowPage(organization, 1, leadsPerCompany, [], controller.signal);
            nextWindows[organization.id] = {
              organization,
              leads,
              page: 1,
              perPage: leadsPerCompany,
              totalEntries,
              totalPages,
              isLoading: false,
              isExpanding: false,
              hasMore,
              error: leads.length === 0 ? 'Sin contactos con estos filtros en esta empresa.' : '',
              deliveredIds: leads.map((lead: UILaed) => String(lead.id)),
            };
          } catch (windowError: any) {
            nextWindows[organization.id] = {
              organization,
              leads: [],
              page: 0,
              perPage: leadsPerCompany,
              isLoading: false,
              isExpanding: false,
              hasMore: true,
              error: getFriendlySearchErrorMessage(windowError?.message),
              deliveredIds: [],
            };
          }
        }
      });
      await Promise.all(workers);
      if (controller.signal.aborted || run !== companyRun.current) return;
      setCompanyWindows(nextWindows);
      setPeopleSearchSignature(peopleSignature);
      setActiveCompanyId(selected[0]?.id || null);
      setFilterStep('people');
      // Flatten for the existing save flow.
      setLeads(Object.values(nextWindows).flatMap((window) => window.leads));
      setSelectedLeads(new Set());
      setPageIndex(0);
    } finally {
      if (run === companyRun.current) {
        setIsLoadingCompanyPeople(false);
        setIsLoading(false);
      }
    }
  };

  const handleExpandCompany = async (organizationId: string) => {
    const window = companyWindows[organizationId];
    if (!window || window.isExpanding || window.isLoading || !window.hasMore) return;
    if (expandingCompanies.current.has(organizationId)) return;
    expandingCompanies.current.add(organizationId);
    const run = companyRun.current;
    setCompanyWindows((current) => ({
      ...current,
      [organizationId]: { ...current[organizationId], isExpanding: true, error: '' },
    }));
    try {
      const nextPage = window.page + 1;
      const { leads, totalEntries, totalPages, hasMore } = await fetchCompanyWindowPage(
        window.organization, nextPage, window.perPage, window.deliveredIds,
      );
      if (run !== companyRun.current) {
        setCompanyWindows((current) => current[organizationId] ? { ...current, [organizationId]: { ...current[organizationId], isExpanding: false } } : current);
        return;
      }
      setCompanyWindows((current) => {
        const existing = current[organizationId];
        if (!existing) return current;
        const merged = [...existing.leads];
        const seen = new Set(existing.deliveredIds);
        for (const lead of leads) {
          if (seen.has(String(lead.id))) continue;
          seen.add(String(lead.id));
          merged.push(lead);
        }
        const next = {
          ...existing,
          leads: merged,
          page: nextPage,
          totalEntries: totalEntries ?? existing.totalEntries,
          totalPages: totalPages ?? existing.totalPages,
          isExpanding: false,
          // If Apollo returned fewer than requested, assume exhaustion for these filters.
          hasMore,
          error: leads.length === 0 ? (hasMore ? 'Esta página no añadió contactos nuevos. Puedes seguir expandiendo.' : 'No quedan más contactos con estos filtros en esta empresa.') : '',
          deliveredIds: Array.from(seen),
        };
        return { ...current, [organizationId]: next };
      });
      setLeads((current) => {
        const seen = new Set(current.map((lead: UILaed) => String(lead.id)));
        const additions = leads.filter((lead: UILaed) => !seen.has(String(lead.id)));
        return [...current, ...additions];
      });
      if (leads.length > 0) {
        toast({ title: `Se agregaron ${leads.length} contactos`, description: window.organization.name });
      }
    } catch (expandError: any) {
      if (run !== companyRun.current) {
        setCompanyWindows((current) => current[organizationId] ? { ...current, [organizationId]: { ...current[organizationId], isExpanding: false } } : current);
        return;
      }
      if ((expandError as any)?.name === 'AbortError') return;
      setCompanyWindows((current) => ({
        ...current,
        [organizationId]: {
          ...current[organizationId],
          isExpanding: false,
          error: getFriendlySearchErrorMessage((expandError as any)?.message),
        },
      }));
    } finally {
      expandingCompanies.current.delete(organizationId);
    }
  };

  const toggleCompanySelection = (organizationId: string, checked: boolean) => {
    setSelectedCompanyIds((current) => {
      const next = new Set(current);
      if (checked) next.add(organizationId);
      else next.delete(organizationId);
      return next;
    });
  };

  useEffect(() => { setPageIndex(0); }, [leads]);

  // Cargar leads guardados y contactados para verificar estado
  useEffect(() => {
    Promise.all([
      supabaseService.getLeads(),
      contactedLeadsStorage.get()
    ]).then(([saved, contacted]) => {
      setSavedIds(new Set(saved.map(l => l.id)));
      setContactedIds(contactedKeys(contacted));
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

  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS, maxResults: 50 });
  const [checkpointReady, setCheckpointReady] = useState(false);
  const [checkpointLoading, setCheckpointLoading] = useState(true);
  const [checkpointNotice, setCheckpointNotice] = useState('');
  const checkpointRevision = useRef(0);
  const checkpointOrganization = useRef('');
  const checkpointQueue = useRef(Promise.resolve());
  const checkpointStopped = useRef(false);
  useEffect(() => {
    const unsubscribe = organizationService.subscribeToCurrentOrganizationChanges(() => window.location.reload());
    return () => { unsubscribe(); };
  }, []);

  // Starting points follow what the active organization sells (src/lib/search/search-guidance.ts).
  const [organizationName, setOrganizationName] = useState('');
  useEffect(() => {
    let cancelled = false;
    organizationService.listOrganizations()
      .then((list) => {
        if (cancelled) return;
        setOrganizationName(list.organizations.find((org) => org.id === list.activeOrganizationId)?.name || '');
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  // «Tu cliente ideal» from «Perfil» goes first when the person defined it.
  const [idealCustomer, setIdealCustomer] = useState<SearchStarter | null>(null);
  const [idealCustomerChecked, setIdealCustomerChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    profileService.getProfile()
      .then((data) => { if (!cancelled) setIdealCustomer(idealCustomerStarter(mapProfileToForm(data))); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setIdealCustomerChecked(true); });
    return () => { cancelled = true; };
  }, []);
  const searchStarters = useMemo(
    () => [...(idealCustomer ? [idealCustomer] : []), ...searchStartersFor(organizationName)].slice(0, 4),
    [idealCustomer, organizationName],
  );

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/leads/search/checkpoint', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      if (cancelled) return;
      checkpointRevision.current = data.revision;
      checkpointOrganization.current = String(data.scope || '').split(':')[0];
      const snapshot = data.snapshot;
      if (snapshot?.version === 1 && snapshot.filters && Array.isArray(snapshot.companies) && snapshot.companyWindows && typeof snapshot.companyWindows === 'object') {
        const restoredFilters = normalizeSavedSearchCriteria(snapshot.filters);
        const hasWindows = Object.keys(snapshot.companyWindows).length > 0;
        setFilters(restoredFilters);
        setCompanySearchSignature(typeof snapshot.companySignature === 'string' ? snapshot.companySignature : snapshot.companies.length > 0 ? companyFilterSignature(restoredFilters) : '');
        setPeopleSearchSignature(typeof snapshot.peopleSignature === 'string' ? snapshot.peopleSignature : hasWindows ? peopleFilterSignature(restoredFilters) : '');
        setCompanies(snapshot.companies);
        setCompaniesPage(snapshot.companiesPage || 1);
        setCompaniesTotalPages(snapshot.companiesTotalPages || 1);
        setCompaniesTotalEntries(snapshot.companiesTotalEntries);
        setSelectedCompanyIds(new Set(snapshot.selectedCompanyIds || []));
        setActiveCompanyId(snapshot.activeCompanyId || null);
        const restored = Object.fromEntries(Object.entries(snapshot.companyWindows).map(([id, value]) => [id, { ...(value as CompanyWindowState), isLoading: false, isExpanding: false }]));
        setCompanyWindows(restored);
        setLeads(Object.values(restored).flatMap((item) => item.leads || []));
        setFilterStep(['filters', 'companies', 'people'].includes(snapshot.filterStep) ? snapshot.filterStep : 'filters');
        if (snapshot.companies.length > 0 || hasWindows) {
          setCheckpointNotice('Recuperamos tu última búsqueda: sigue donde quedaste.');
          setCriteriaOpen(false);
        }
      }
      setCheckpointReady(true);
    }).catch(() => {
      if (!cancelled) setCheckpointNotice('La recuperación de búsquedas no está disponible. El avance se conserva mientras mantengas esta pantalla abierta.');
    }).finally(() => { if (!cancelled) setCheckpointLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // «Buscar decisores» in «Oportunidades» opens Búsqueda by company with the roles to look for. It fills the form after the
  // checkpoint is restored (so it wins over the last search) and waits for the person to run it.
  const companyPrefillChecked = useRef(false);
  useEffect(() => {
    if (checkpointLoading || companyPrefillChecked.current) return;
    companyPrefillChecked.current = true;
    const prefill = companySearchPrefill(window.location.search);
    if (!prefill) return;
    window.history.replaceState(window.history.state, '', window.location.pathname);
    companyRun.current += 1;
    companyPeopleAbortRef.current?.abort();
    setError('');
    setProfileProblem(null);
    setCompanySearchHint('');
    setFilterStep('filters');
    setCompanies([]);
    setCompanyWindows({});
    setSelectedCompanyIds(new Set());
    setActiveCompanyId(null);
    setActiveSavedSearchId(null);
    setLeads([]);
    setSelectedLeads(new Set());
    setFilters((prev) => ({ ...prev, searchMode: 'company_name', companyName: prefill.companyName, companyDomains: prefill.companyDomains, title: prefill.title, seniorities: [] }));
    setAdvancedFiltersOpen(true);
    toast({ title: `Búsqueda en ${prefill.companyName || prefill.companyDomains} lista`, description: 'Revisa los cargos y presiona «Buscar leads».' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkpointLoading]);

  const checkpointBaseline = useRef<string | null>(null);
  useEffect(() => {
    if (!checkpointReady || filters.searchMode !== 'filters' || isLoading || Object.values(companyWindows).some((item) => item.isExpanding || item.isLoading)) return;
    const snapshot = {
      version: 1, filters, companies, companiesPage, companiesTotalPages, companiesTotalEntries, selectedCompanyIds: [...selectedCompanyIds],
      activeCompanyId, companyWindows, filterStep, companySignature: companySearchSignature, peopleSignature: peopleSearchSignature,
    };
    const serialized = JSON.stringify(snapshot);
    // What was just restored, or the empty start, is not a change. Saving it wrote the checkpoint on every visit.
    if (checkpointBaseline.current === null) {
      checkpointBaseline.current = serialized;
      return;
    }
    if (serialized === checkpointBaseline.current) return;
    const timeout = window.setTimeout(() => {
      checkpointQueue.current = checkpointQueue.current.then(async () => {
        if (checkpointStopped.current) return;
        const response = await fetch('/api/leads/search/checkpoint', {
          method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-organization-id': checkpointOrganization.current },
          body: JSON.stringify({ revision: checkpointRevision.current, snapshot }),
        });
        if (!response.ok) {
          checkpointStopped.current = true;
          setCheckpointNotice(response.status === 409 ? 'Otra pestaña actualizó esta búsqueda. Recarga para recuperar su avance.' : 'No pudimos guardar el avance. Mantén esta pantalla abierta.');
          return;
        }
        checkpointRevision.current = (await response.json()).revision;
        checkpointBaseline.current = serialized;
      }).catch(() => { setCheckpointNotice('No pudimos guardar el avance de la búsqueda.'); });
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [checkpointReady, filters, companies, companiesPage, companiesTotalPages, companiesTotalEntries, selectedCompanyIds, activeCompanyId, companyWindows, filterStep, isLoading, companySearchSignature, peopleSearchSignature]);

  const handleFilterChange = (field: keyof typeof filters, value: any) => {
    if (field === 'searchMode') {
      companyRun.current += 1;
      companyPeopleAbortRef.current?.abort();
    }
    setError('');
    setProfileProblem(null);
    if (field === 'searchMode' && value !== 'company_name') setCompanySearchHint('');
    setProfileOnlyRetry(false);
    if (field === 'searchMode') {
      setAdvancedFiltersOpen(value === 'linkedin_profile');
    }
    if (field === 'searchMode' || field === 'linkedinUrl' || field === 'revealEmail' || field === 'revealPhone') {
      profileStatusAbortRef.current?.abort();
      if (field === 'linkedinUrl' || field === 'searchMode') {
        searchRunIdRef.current += 1;
        abortRef.current?.abort();
        submittingRef.current = false;
        setIsLoading(false);
        setLeads([]);
        setSelectedLeads(new Set());
      }
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
    // Company and person filters no longer erase what was found: the lists stay, marked as old, until the next search
    // (companySearchSignature and peopleSearchSignature). Before, one keystroke threw away the companies and contacts.
    setActiveSavedSearchId(null);
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const resetCompanyFirstFlow = () => {
    companyRun.current += 1;
    setCompanySearchSignature('');
    setPeopleSearchSignature('');
    companiesAbortRef.current?.abort();
    companyPeopleAbortRef.current?.abort();
    setFilterStep('filters');
    setCompanies([]);
    setCompaniesPage(1);
    setCompaniesTotalPages(1);
    setCompaniesTotalEntries(undefined);
    setSelectedCompanyIds(new Set());
    setActiveCompanyId(null);
    setCompanyWindows({});
    setIsLoadingCompanies(false);
    setIsLoadingCompanyPeople(false);
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
  const [isEnrichingOrganization, setIsEnrichingOrganization] = useState(false);
  const organizationEnrichmentOperationsRef = useRef(new Map<string, string>());

  const handleSaveSelectedLeads = async () => {
    const selected = leads.filter(lead => selectedLeads.has(lead.id));
    // Filter out already contacted
    const selectedNotContacted = selected.filter(l => !isContactedLead(l));

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
      await refreshSavedApolloIds();

      const phonePendingNote =
        filters.searchMode === 'linkedin_profile' &&
        lastProfilePhoneStatus === 'queued' &&
        withDirectContactData.length > 0
          ? ' El teléfono sigue en camino y aparecerá solo.'
          : '';
      const saved = savedLeadsToast({ withContact: enrichedAdded, withoutContact: resSv.addedCount, duplicates: resSv.duplicateCount });
      toast({
        title: saved.title,
        description: `${saved.description}${phonePendingNote}`,
        action: saved.href ? (
          <ToastAction altText={saved.actionLabel} onClick={() => router.push(saved.href)}>{saved.actionLabel}</ToastAction>
        ) : undefined,
      });

      setSelectedLeads(new Set());
    } catch (error) {
      console.error('Error saving leads:', error);
      toast({ variant: "destructive", title: "No pudimos guardar", description: "Los contactos no se guardaron. Intenta de nuevo en unos segundos." });
    } finally {
      setIsSaving(false);
    }
  };

  const applySearchResult = (result: LeadSearchResponse, mode: SearchMode, reveal?: { revealEmail: boolean; revealPhone: boolean }) => {
    const emailRequested = reveal?.revealEmail ?? filters.revealEmail;
    const phoneRequested = reveal?.revealPhone ?? filters.revealPhone;
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
      const canonicalOrganization = result.selected_organization || (candidates.length === 1 ? candidates[0] : selectedOrganization);
      setSelectedOrganization(canonicalOrganization || null);
      setProfileSearchNotice(null);
      setLastProfilePhoneStatus(null);
      setProfilePhonePollingIds([]);
      setProfilePhonePollingStartedAt(null);
      setLeads(result.leads.map((raw) => normalizeLeadForUI(raw, {
        revealEmail: true,
        revealPhone: true,
        organization: canonicalOrganization,
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
      revealEmail: emailRequested,
      revealPhone: phoneRequested,
    })));

    if (mode === 'linkedin_profile') {
      const warnings = Array.isArray(result.provider_warnings) ? result.provider_warnings.filter(Boolean) : [];
      const emailState: ProfileContactState = !emailRequested
        ? 'not_requested'
        : result.leads.some((lead) => hasVisibleLeadEmail(lead))
          ? 'ready'
          : phoneStatus === 'queued'
            ? 'queued'
            : 'missing';
      const phoneState: ProfileContactState = !phoneRequested
        ? 'not_requested'
        : phoneStatus === 'queued'
          ? 'queued'
          : result.leads.some((lead) => hasVisibleLeadPhone(lead))
            ? 'ready'
            : 'missing';

      if (result.leads.length === 0 && phoneStatus !== 'queued' && !result.profile_pending) {
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

      if (phoneStatus === 'queued' || result.profile_pending) {
        const pollingIds = Array.from(new Set([
          ...(result.profile_tracking_ids || []),
          ...result.leads.map((raw) => raw.id),
        ].filter(Boolean)));

        if (pollingIds.length === 0) {
          setLastProfilePhoneStatus('failed');
          setProfilePhonePollingStartedAt(null);
          setProfileSearchNotice(buildLinkedInProfileNotice({
            emailRequested,
            phoneRequested,
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
              emailRequested,
              phoneRequested,
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
          emailRequested,
          phoneRequested,
          emailState,
          phoneState,
        }));
      } else if ((result.provider_warnings || []).includes('APOLLO_PROFESSIONAL_ONLY')) {
        setProfilePhonePollingStartedAt(null);
        setProfileSearchNotice({
          tone: 'warning',
          title: 'Perfil sin datos de contacto',
          description: 'Se encontraron los datos profesionales, pero no hay correo ni teléfono disponibles para esta URL en las bases de datos. Puedes guardar el perfil o completar los datos manualmente.',
          emailState: 'missing',
          phoneState: 'missing',
        });
      } else if (warnings.length > 0) {
        setProfilePhonePollingStartedAt(null);
        setProfileSearchNotice(buildLinkedInProfileNotice({
          emailRequested,
          phoneRequested,
          emailState,
          phoneState,
        }));
      } else if (emailRequested || phoneRequested) {
        setProfilePhonePollingStartedAt(null);
        setProfileSearchNotice(buildLinkedInProfileNotice({
          emailRequested,
          phoneRequested,
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
    revealOverride,
  }: {
    countQuota?: boolean;
    selectedOrg?: CompanySearchOrganization | null;
    revealOverride?: { revealEmail: boolean; revealPhone: boolean };
  } = {}) => {
    const organization = selectedOrg || selectedOrganization;
    const activeRevealEmail = revealOverride?.revealEmail ?? filters.revealEmail;
    const activeRevealPhone = revealOverride?.revealPhone ?? filters.revealPhone;
    let validationMessage = '';
    if (filters.searchMode === 'linkedin_profile') {
      const urlProblem = profileUrlProblem(filters.linkedinUrl);
      if (urlProblem) {
        setError('');
        setProfileProblem(profileSearchMessage(urlProblem, { url: filters.linkedinUrl }));
        window.requestAnimationFrame(() => document.getElementById('linkedinUrl')?.focus());
        return;
      }
    }
    if (filters.searchMode === 'company_name'
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
    setProfileProblem(null);
    setProfileOnlyRetry(false);
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
          reveal_email: activeRevealEmail,
          reveal_phone: activeRevealPhone,
        }, abortRef.current.signal);
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
      applySearchResult(result, filters.searchMode, { revealEmail: activeRevealEmail, revealPhone: activeRevealPhone });
    } catch (error: any) {
      if (searchRunIdRef.current !== searchRunId) return;
      if (error.name !== 'AbortError' && filters.searchMode === 'linkedin_profile') {
        const problem = error instanceof ProfileSearchProblemError ? error.problem : profileProblemFromMessage(error?.message);
        setProfileProblem(profileSearchMessage(problem, { url: filters.linkedinUrl }));
      } else if (error.name !== 'AbortError') {
        const friendlyMessage = getFriendlySearchErrorMessage(error.message);
        setError(friendlyMessage);
        setProfileOnlyRetry(
          filters.searchMode === 'linkedin_profile'
          && String(error?.message || '').includes('APOLLO_PROFILE_NO_USABLE_DATA')
          && (filters.revealEmail || filters.revealPhone),
        );
        toast({
          title: 'No se pudo completar la búsqueda',
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
    if (filters.searchMode === 'filters') {
      resetCompanyFirstFlow();
      await handleSearchCompanies(1);
      return;
    }
    await executeSearch();
  };

  const handleProfileOnlyRetry = async () => {
    const override = { revealEmail: false, revealPhone: false };
    setFilters(prev => ({ ...prev, ...override }));
    setProfileOnlyRetry(false);
    await executeSearch({ revealOverride: override });
  };

  const applySearchStarter = (starter: SearchStarter) => {
    companyRun.current += 1;
    companyPeopleAbortRef.current?.abort();
    setError('');
    setProfileProblem(null);
    setFilterStep('filters');
    setCompanies([]);
    setCompanyWindows({});
    setSelectedCompanyIds(new Set());
    setActiveCompanyId(null);
    setCompanySearchSignature('');
    setPeopleSearchSignature('');
    setActiveSavedSearchId(null);
    setFilters((prev) => ({ ...prev, searchMode: 'filters', industry: '', companyNameFilter: '', personLocation: '', ...starter.filters }));
    toast({ title: `Filtros de «${starter.label}» listos`, description: 'Revísalos y presiona «Buscar empresas».' });
  };

  const removeFilterChip = (chip: ActiveFilterChip) => {
    handleFilterChange(chip.field, chip.field === 'seniorities' ? [] : '');
  };

  const handleProfileProblemAction = (action: ProfileSearchAction) => {
    if (action === 'retry') {
      void handleSearch();
    } else if (action === 'professional_only') {
      void handleProfileOnlyRetry();
    } else if (action === 'sign_in') {
      window.location.assign('/login');
    } else if (action === 'fix_url') {
      setProfileProblem(null);
      window.requestAnimationFrame(() => {
        const input = document.getElementById('linkedinUrl') as HTMLInputElement | null;
        input?.focus();
        input?.select();
      });
    } else {
      const person = profileSearchPersonHint(filters.linkedinUrl);
      handleFilterChange('searchMode', 'company_name');
      setCompanySearchHint(person);
      window.requestAnimationFrame(() => document.getElementById('companyName')?.focus());
    }
  };

  const handleAbort = () => {
    companyRun.current += 1;
    searchRunIdRef.current += 1;
    abortRef.current?.abort();
    companiesAbortRef.current?.abort();
    companyPeopleAbortRef.current?.abort();
    submittingRef.current = false;
    setIsLoading(false);
    setIsLoadingCompanies(false);
    setIsLoadingCompanyPeople(false);
    toast({ title: 'Búsqueda cancelada' });
  };

  const handleEnrichOrganization = async () => {
    const domain = selectedOrganization?.primary_domain;
    if (!selectedOrganization || !domain || isEnrichingOrganization) return;
    const operationId = organizationEnrichmentOperationsRef.current.get(domain)
      || `organization-enrich:${crypto.randomUUID()}`;
    organizationEnrichmentOperationsRef.current.set(domain, operationId);
    setIsEnrichingOrganization(true);
    try {
      const enriched = await enrichApolloOrganization({ domain, operationId });
      if (!enriched) {
        toast({ title: 'Sin datos adicionales', description: 'No encontramos más información pública para esta empresa.' });
        return;
      }
      organizationEnrichmentOperationsRef.current.delete(domain);
      setSelectedOrganization((current) => current?.id === selectedOrganization.id
        ? { ...current, ...enriched }
        : current);
      toast({ title: 'Empresa actualizada', description: 'Añadimos el perfil público disponible de la organización.' });
    } catch (error) {
      if (!(error instanceof ApolloOrganizationEnrichmentClientError) || !error.preserveOperation) {
        organizationEnrichmentOperationsRef.current.delete(domain);
      }
      toast({
        variant: 'destructive',
        title: 'No pudimos actualizar la empresa',
        description: error instanceof Error ? error.message : 'Inténtalo nuevamente.',
      });
    } finally {
      setIsEnrichingOrganization(false);
    }
  };

  const handleClear = () => {
    searchRunIdRef.current += 1;
    abortRef.current?.abort();
    submittingRef.current = false;
    setIsLoading(false);
    setFilters({ ...DEFAULT_FILTERS, maxResults: 50 });
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
    resetCompanyFirstFlow();
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
    // Apollo phone reveal arrives via webhook and has been observed to take
    // over 2.5 minutes. Giving up at 90s showed a false failure while the
    // backend completed successfully seconds later.
    const maxAttempts = 60;
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

        const requestedProfile = normalizeLinkedinProfileUrl(filters.linkedinUrl).toLowerCase();
        if (items.some(item => item.linkedin_url && normalizeLinkedinProfileUrl(item.linkedin_url).toLowerCase() !== requestedProfile)) {
          throw new Error('El proveedor devolvió un perfil distinto. No se actualizarán los datos de otra persona.');
        }
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
                name: item.name || lead.name,
                title: item.title || lead.title,
                company: item.organization_name || item.org_name || lead.company,
                industry: item.organization_industry || item.industry || lead.industry,
                avatar: safeAvatarUrl(item.photo_url) || lead.avatar,
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
            // Tracking rows are not leads. Add a result only after polling
            // returns usable profile data; previously an empty initial result
            // could never become visible because this only mapped prev.
            const knownIds = new Set(updated.map((lead) => String(lead.id)));
            const discovered = items.filter((item) => !knownIds.has(String(item.id)) && hasUsableLinkedInProfileData(item as Partial<Lead>))
              .map((item) => normalizeLeadForUI(item as Lead, {
                revealEmail: filters.revealEmail,
                revealPhone: filters.revealPhone,
              }));
            return [...updated, ...discovered];
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
                description: 'El perfil ya se actualizó en el resultado de la búsqueda.',
              });
            }
            return;
          }

          if (!stillPending) {
            const hasProfile = items.some((item) => hasUsableLinkedInProfileData(item as Partial<Lead>));
            finishWithoutContact(hasProfile
              ? 'El perfil está disponible, pero no se encontraron todos los datos de contacto solicitados en las bases de datos.'
              : 'No pudimos confirmar este perfil en las bases de datos. Revisa la URL antes de volver a buscar.', items);
            if (!hasProfile) {
              setLeads([]);
              setProfileSearchNotice({ tone: 'warning', title: 'Perfil no confirmado',
                description: 'No se encontró información suficiente en las bases de datos para confirmar este perfil. Revisa la URL antes de volver a buscar.',
                emailState: filters.revealEmail ? 'missing' : 'not_requested',
                phoneState: filters.revealPhone ? 'missing' : 'not_requested' });
            }
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
  }, [filters.searchMode, filters.linkedinUrl, filters.revealEmail, filters.revealPhone, profilePhonePollingIds, toast]);

  const isPageAllSelected = useMemo(() => {
    if (pagedLeads.length === 0) return false;
    const selectable = pagedLeads.filter(lead => !isLeadSaved(lead, savedLeadIds) && !isLeadContacted(lead, contactedIds));
    if (selectable.length === 0) return false;
    return selectable.every(lead => selectedLeads.has(lead.id));
  }, [pagedLeads, selectedLeads, savedLeadIds, contactedIds]);

  const handleSelectAll = (checked: boolean) => {
    const newSelectedLeads = new Set(selectedLeads);
    pagedLeads.forEach(lead => {
      if (!isSavedLead(lead) && !isContactedLead(lead)) {
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
    const legacyIndustry = String((criteria as any)?.industry || '').trim();
    const migrated = legacyIndustry
      ? {
          ...criteria,
          industry: '',
          companyKeywords: [legacyIndustry, String(criteria.companyKeywords || '').trim()].filter(Boolean).join(', '),
        }
      : criteria;
    searchRunIdRef.current += 1;
    abortRef.current?.abort();
    profileStatusAbortRef.current?.abort();
    submittingRef.current = false;
    setIsLoading(false);
    setFilters(migrated);
    resetCompanyFirstFlow();
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
    toast({
      title: 'Filtros cargados',
      description: legacyIndustry
        ? `Industria (“${legacyIndustry}”) se movió a Palabras clave. Revísala antes de buscar.`
        : `Se han aplicado los filtros de "${search.name}".`,
    });
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

  // What the results column shows in «Filtros»: the intro before searching, then companies, then their contacts.
  const contactsFound = companyWindowList.reduce((total, window) => total + window.leads.length, 0);
  const resultsView: 'intro' | 'companies' | 'people' =
    filterStep === 'people' && (companyWindowList.length > 0 || isLoadingCompanyPeople) ? 'people'
      : companies.length > 0 || isLoadingCompanies || filterStep === 'companies' ? 'companies'
        : 'intro';
  const companiesStale = companies.length > 0 && Boolean(companySearchSignature) && companySearchSignature !== companyFilterSignature(filters);
  const peopleStale = companyWindowList.length > 0 && Boolean(peopleSearchSignature) && peopleSearchSignature !== peopleFilterSignature(filters);
  const hasResults = filters.searchMode === 'filters'
    ? resultsView !== 'intro'
    : leads.length > 0 || isLoading || hasSearched || companySelectionPending;
  const activeChips = activeFilterChips(filters);
  const criteriaSummary = filters.searchMode === 'filters'
    ? activeChips.length > 0 ? activeChips.map((chip) => chip.value).join(' · ') : 'Sin filtros'
    : filters.searchMode === 'company_name'
      ? filters.companyName.trim() || filters.companyDomains.trim() || 'Escribe una empresa'
      : filters.linkedinUrl.trim() || 'Pega un perfil de LinkedIn';
  const leadsPerCompany = getCompanyPersonFilters().leadsPerCompany;
  const showLeadsBar = selectedLeads.size > 0 && (filters.searchMode !== 'filters' || resultsView === 'people');
  const selectWindowLeads = (window: CompanyWindowState) => setSelectedLeads((current) => {
    const next = new Set(current);
    for (const lead of window.leads) if (!isSavedLead(lead) && !isContactedLead(lead)) next.add(lead.id);
    return next;
  });

  useEffect(() => { if (missingFilterError) setCriteriaOpen(true); }, [missingFilterError]);
  const runSearch = () => {
    setCriteriaOpen(false);
    void handleSearch();
  };

  const modeSwitch = (
    <fieldset disabled={isLoading || checkpointLoading} className="min-w-0 border-0 p-0">
      <legend className="sr-only">Modo de búsqueda</legend>
      <div data-tour="search-modes" className="grid h-10 w-full grid-cols-3 rounded-xl border border-border/60 bg-muted/60 p-1" role="group" aria-label="Modo de búsqueda">
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
                active ? 'bg-background text-foreground shadow-sm' : 'text-foreground/70 hover:text-foreground',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );

  const savedSearchesMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2 shadow-none" aria-label={`Abrir búsquedas guardadas${savedSearches.length > 0 ? ` (${savedSearches.length})` : ''}`}>
          {savedSearchesLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Bookmark className="h-4 w-4" aria-hidden="true" />}
          <span>Guardadas{savedSearches.length > 0 ? ` (${savedSearches.length})` : ''}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-[min(20rem,calc(100vw-2rem))] overflow-auto">
        {savedSearchesLoading ? (
          <div className="flex items-center gap-2 p-3 text-sm text-foreground/70">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Cargando búsquedas…
          </div>
        ) : savedSearchesError ? (
          <div className="space-y-2 p-3">
            <p className="text-sm text-destructive">{savedSearchesError}</p>
            <Button size="sm" variant="outline" onClick={() => void loadSavedSearches()}>Reintentar</Button>
          </div>
        ) : savedSearches.length === 0 ? (
          <div className="p-3 text-sm text-foreground/70">Aún no guardas búsquedas. Usa «Guardar» para volver a estos criterios.</div>
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
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{savedSearch.name}</span>
                    {activeSavedSearchId === savedSearch.id ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-cw-success" aria-hidden="true" /> : null}
                  </span>
                  <span className="block truncate text-xs text-foreground/70">
                    {savedSearch.isShared ? `Equipo · ${savedSearch.user?.fullName || 'Usuario'}` : 'Privada'}
                  </span>
                </span>
              </button>
              <Button variant="ghost" size="icon" className="h-8 w-8 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" onClick={(event) => handleRequestDeleteSearch(event, savedSearch)} aria-label={`Eliminar búsqueda guardada ${savedSearch.name}`}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
              </Button>
            </div>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const criteriaFields = filters.searchMode === 'linkedin_profile' ? (
    <div className="space-y-4">
      <div className="space-y-2">
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
        <p className="text-xs text-foreground/70">Pega la dirección que empieza con linkedin.com/in/. No sirven las de Sales Navigator ni las páginas de empresas.</p>
      </div>
      <Collapsible open={advancedFiltersOpen} onOpenChange={setAdvancedFiltersOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="px-0 text-foreground/70 hover:bg-transparent hover:text-foreground">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Datos de contacto
            <ChevronDown className={`h-4 w-4 transition-transform ${advancedFiltersOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-muted/20 p-3">
              <div>
                <Label htmlFor="revealEmail">Correo laboral</Label>
                <p className="text-xs text-foreground/70">Solicita únicamente direcciones de trabajo.</p>
              </div>
              <Switch id="revealEmail" checked={filters.revealEmail} onCheckedChange={(value) => handleFilterChange('revealEmail', value)} />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-muted/20 p-3">
              <div>
                <Label htmlFor="revealPhone">Teléfono</Label>
                <p className="text-xs text-foreground/70">Cuesta 10 créditos por persona y llega en 1 a 3 minutos, si el proveedor lo tiene.</p>
              </div>
              <Switch id="revealPhone" checked={filters.revealPhone} onCheckedChange={(value) => handleFilterChange('revealPhone', value)} />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
      <p className="text-xs text-foreground/70" role="status" aria-live="polite">
        Primero verás los datos profesionales; el correo y el teléfono llegan después, sin que tengas que esperar.
      </p>
    </div>
  ) : filters.searchMode === 'company_name' ? (
    <div className="space-y-4">
      <div className="space-y-2">
        {companySearchHint ? (
          <p className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm" role="status">
            Buscando a <strong>{companySearchHint}</strong>: escribe su empresa y, en opciones avanzadas, su cargo.
          </p>
        ) : null}
        <Label htmlFor="companyName">Empresa *</Label>
        <Input
          id="companyName"
          autoComplete="organization"
          placeholder="Ej. Microsoft"
          value={filters.companyName}
          onChange={(event) => handleFilterChange('companyName', event.target.value)}
        />
        <p className="text-xs text-foreground/70">También puedes buscar solo por dominio desde las opciones avanzadas.</p>
      </div>
      <Collapsible open={advancedFiltersOpen} onOpenChange={setAdvancedFiltersOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="px-0 text-foreground/70 hover:bg-transparent hover:text-foreground">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Opciones avanzadas
            <ChevronDown className={`h-4 w-4 transition-transform ${advancedFiltersOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1">
            <div className="space-y-2 md:col-span-2 lg:col-span-1">
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
            <div className="md:col-span-2 lg:col-span-1">
              <MultiCheckDropdown label="Nivel de responsabilidad" options={APOLLO_SENIORITIES} value={filters.seniorities} onChange={(next) => handleFilterChange('seniorities', next)} placeholder="Todos los niveles" disabled={isLoading} />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {selectedOrganization ? (
        <div className="flex flex-col gap-3 rounded-xl border border-cw-border bg-cw-success-soft p-3 text-sm">
          <div className="flex min-w-0 items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cw-success" aria-hidden="true" />
            <div className="min-w-0">
              <span className="font-medium">Empresa elegida: </span>
              <span>{selectedOrganization.name}{selectedOrganization.primary_domain ? ` · ${selectedOrganization.primary_domain}` : ''}</span>
              {selectedOrganization.short_description ? <p className="mt-1 line-clamp-2 text-xs text-foreground/70">{selectedOrganization.short_description}</p> : null}
            </div>
          </div>
          {selectedOrganization.primary_domain ? (
            <Button type="button" variant="outline" size="sm" className="self-start bg-background/70 shadow-none" onClick={handleEnrichOrganization} disabled={isLoading || isEnrichingOrganization}>
              {isEnrichingOrganization ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Building2 className="h-4 w-4" aria-hidden="true" />}
              {isEnrichingOrganization ? 'Actualizando…' : 'Completar empresa'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : (
    <div className="space-y-5">
      <p id="filterRequirement" className={cn('text-sm text-foreground/70', missingFilterError && 'font-medium text-destructive')}>
        {missingFilterError
          ? error
          : 'Primero eliges empresas con estos filtros; después buscamos contactos solo dentro de las que marques.'}
      </p>
      {(filters as any)?.industry ? (
        <Alert variant="warning">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Revisa tus criterios</AlertTitle>
          <AlertDescription>
            Esta búsqueda guardada usa el filtro antiguo «Industria», que ya no se aplica. Mueve ese término a «Palabras clave de empresa» antes de continuar.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
          Empresas
        </h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1">
          <div className="space-y-2">
            <Label htmlFor="companyKeywords">Palabras clave de empresa</Label>
            <Input id="companyKeywords" aria-describedby="companyKeywordsHelp" placeholder="Ej. retail, logística, moda" value={filters.companyKeywords} onChange={(event) => handleFilterChange('companyKeywords', event.target.value)} />
            <p id="companyKeywordsHelp" className="text-xs text-foreground/70">Lo que hace la empresa. Separa varias con comas.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="location">Sede de la empresa</Label>
            <Input id="location" aria-describedby="companyLocationHelp" placeholder="Ej. Chile, Argentina" value={filters.location} onChange={(event) => handleFilterChange('location', event.target.value)} />
            <p id="companyLocationHelp" className="text-xs text-foreground/70">Dónde está la empresa, no dónde vive el contacto.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="companyNameFilter">Nombre de empresa</Label>
            <Input id="companyNameFilter" aria-describedby="companyNameFilterHelp" placeholder="Ej. Adecco, SONDA" value={filters.companyNameFilter} onChange={(event) => handleFilterChange('companyNameFilter', event.target.value)} />
            <p id="companyNameFilterHelp" className="text-xs text-foreground/70">Se combina con los demás filtros.</p>
          </div>
          <div className="space-y-2">
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
      </div>
      <div className="space-y-3 border-t border-border/60 pt-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Users className="h-4 w-4 text-primary" aria-hidden="true" />
          Contactos en esas empresas
        </h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1">
          <div className="space-y-2">
            <Label htmlFor="title">Cargo o posición</Label>
            <Input id="title" placeholder="Ej. Gerente de Personas" value={filters.title} onChange={(event) => handleFilterChange('title', event.target.value)} />
          </div>
          <MultiCheckDropdown label="Nivel de responsabilidad" options={APOLLO_SENIORITIES} value={filters.seniorities} onChange={(next) => handleFilterChange('seniorities', next)} placeholder="Todos los niveles" disabled={isLoading} />
          <div className="space-y-2">
            <Label htmlFor="personLocation">Ubicación del contacto</Label>
            <Input id="personLocation" aria-describedby="personLocationHelp" placeholder="Ej. Santiago, Buenos Aires" value={filters.personLocation} onChange={(event) => handleFilterChange('personLocation', event.target.value)} />
            <p id="personLocationHelp" className="text-xs text-foreground/70">Dónde vive o trabaja la persona.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="filterMaxResults">Contactos por empresa</Label>
            <Input id="filterMaxResults" type="number" min={1} max={100} aria-describedby="filterMaxResultsHelp" value={String(filters.maxResults)} onChange={(event) => handleFilterChange('maxResults', Math.min(100, Math.max(1, Number(event.target.value) || 50)))} />
            <p id="filterMaxResultsHelp" className="text-xs text-foreground/70">Cuántos traer de cada empresa marcada. Puedes pedir más después.</p>
          </div>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-foreground/70">
        La búsqueda no gasta créditos en correos: los buscas después, en «Por completar».
      </p>
    </div>
  );

  const searchError = error && !missingFilterError ? (
    <Alert variant="warning">
      <AlertCircle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>No pudimos completar la búsqueda</AlertTitle>
      <AlertDescription className="space-y-3">
        <p id="searchValidationError">{error}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" className="bg-background/80" onClick={runSearch} disabled={isLoading}>
            Intentar de nuevo
          </Button>
          {filters.searchMode === 'linkedin_profile' && profileOnlyRetry && (filters.revealEmail || filters.revealPhone) ? (
            <Button size="sm" variant="outline" className="bg-background/80" onClick={handleProfileOnlyRetry} disabled={isLoading}>
              Buscar solo datos profesionales
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setError('')}>
            Ocultar aviso
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  ) : null;

  const rowSkeleton = (label: string) => (
    <div className="space-y-2" aria-busy="true" aria-label={label}>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-xl border border-border/60 bg-background p-3">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  );

  const profileDetails = (lead: UILaed) => filters.searchMode === 'linkedin_profile' ? (
    <div className="mt-1 flex flex-col gap-0.5 text-xs">
      {filters.revealEmail && !lead.email ? <span className="text-cw-warning">Correo no disponible</span> : null}
      {filters.revealPhone ? (
        lead.primaryPhone ? (
          <span className="font-medium text-cw-success">{lead.primaryPhone}</span>
        ) : isPendingEnrichmentStatus(lead.enrichmentStatus) ? (
          <span className="inline-flex items-center gap-1 text-primary">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Teléfono en camino…
          </span>
        ) : (
          <span className="text-foreground/70">Sin teléfono visible</span>
        )
      ) : null}
    </div>
  ) : null;

  const stepButton = (step: 'companies' | 'people', index: number, label: string, count: number, disabled = false) => {
    const active = resultsView === step;
    return (
      <button
        type="button"
        aria-current={active ? 'step' : undefined}
        disabled={disabled || isLoading}
        onClick={() => setFilterStep(step)}
        className={cn(
          'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          active ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border/70 bg-card text-foreground/70 hover:text-foreground',
        )}
      >
        <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-xs tabular-nums', active ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{index}</span>
        {label}
        {count > 0 ? <span className="tabular-nums text-foreground/70">{count.toLocaleString('es-CL')}</span> : null}
      </button>
    );
  };

  const companiesSection = (
    <section aria-labelledby="companies-title" className="space-y-3 rounded-2xl border border-border/60 bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 id="companies-title" className="text-base font-semibold tracking-tight">
            {isLoadingCompanies ? 'Buscando empresas…' : companies.length > 0 ? `${companies.length.toLocaleString('es-CL')} empresas` : 'Empresas'}
          </h2>
          <p className="text-sm text-foreground/70" role="status" aria-live="polite">
            Marca las que te interesan; en cada una buscaremos hasta {leadsPerCompany} contactos.
            {companiesTotalEntries ? ` Hay unas ${companiesTotalEntries.toLocaleString('es-CL')} en total.` : ''}
          </p>
        </div>
        {companies.length > 0 ? (
          <div className="flex shrink-0 gap-1">
            <Button type="button" variant="ghost" size="sm" disabled={isLoading} onClick={() => setSelectedCompanyIds(new Set(companies.map((org) => org.id)))}>
              Marcar todas
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={isLoading || selectedCompanyIds.size === 0} onClick={() => setSelectedCompanyIds(new Set())}>
              Desmarcar
            </Button>
          </div>
        ) : null}
      </div>
      {companiesStale ? (
        <Alert variant="info" role="status">
          <Info className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center gap-2">
            Cambiaste los filtros de empresa: esta lista es de la búsqueda anterior.
            <Button type="button" size="sm" variant="outline" className="h-7 bg-background/80" onClick={runSearch} disabled={isLoading}>Actualizar empresas</Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {isLoadingCompanies ? rowSkeleton('Buscando empresas') : companies.length > 0 ? (
        <>
          <ul className="grid gap-2 xl:grid-cols-2" aria-label="Empresas encontradas">
            {companies.map((org) => {
              const checked = selectedCompanyIds.has(org.id);
              const place = [org.city, org.country].filter(Boolean).join(', ');
              return (
                <li key={org.id}>
                  <label className={cn(
                    'flex h-full cursor-pointer items-start gap-3 rounded-xl border border-border/60 bg-background p-3 transition-colors hover:border-primary/40 focus-within:ring-2 focus-within:ring-ring',
                    checked && 'border-primary/50 bg-primary/5',
                  )}>
                    <Checkbox
                      aria-label={`Marcar ${org.name}`}
                      checked={checked}
                      onCheckedChange={(value) => toggleCompanySelection(org.id, Boolean(value))}
                      className="mt-2.5"
                    />
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/70">
                      <Building2 className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{org.name}</span>
                      <span className="block truncate text-xs text-foreground/70">{displayDomain(org.primary_domain || org.website_url || '') || 'Sin sitio web visible'}</span>
                      <span className="mt-1 block text-xs text-foreground/70">
                        {place || 'Ubicación no disponible'}
                        {typeof org.estimated_num_employees === 'number' ? ` · ${org.estimated_num_employees.toLocaleString('es-CL')} personas` : ''}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {companiesPage < companiesTotalPages && companiesPage < 500 ? (
            <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={isLoading} onClick={() => void handleSearchCompanies(companiesPage + 1)}>
              Cargar más empresas
            </Button>
          ) : null}
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/10 px-6 py-8 text-center">
          <p className="font-medium">No encontramos empresas con estos filtros</p>
          <p className="mt-1 text-sm text-foreground/70">{error && !missingFilterError ? error : 'Prueba ampliando palabras clave, sede o tamaño.'}</p>
          <FilterRelaxHint chips={activeChips} onRemove={removeFilterChip} disabled={isLoadingCompanies} />
        </div>
      )}
    </section>
  );

  const peopleSection = (
    <section aria-labelledby="people-title" className="space-y-3 rounded-2xl border border-border/60 bg-card p-4 sm:p-5">
      <div className="space-y-1">
        <h2 id="people-title" className="text-base font-semibold tracking-tight">Contactos por empresa</h2>
        <p className="text-sm text-foreground/70" role="status" aria-live="polite" aria-atomic="true">
          {isLoadingCompanyPeople
            ? 'Buscando contactos en las empresas marcadas…'
            : companyWindowList.length > 0
              ? `${contactsFound.toLocaleString('es-CL')} contactos en ${companyWindowList.length} empresas. Marca los que quieras guardar.`
              : 'Marca empresas y busca contactos para ver resultados.'}
        </p>
      </div>
      {peopleStale ? (
        <Alert variant="info" role="status">
          <Info className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center gap-2">
            Cambiaste los filtros de contactos: estos resultados son de la búsqueda anterior.
            <Button type="button" size="sm" variant="outline" className="h-7 bg-background/80" onClick={() => void handleSearchCompanyPeople()} disabled={isLoading || selectedCompanyIds.size === 0}>
              Buscar de nuevo en {selectedCompanyIds.size} {selectedCompanyIds.size === 1 ? 'empresa' : 'empresas'}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {isLoadingCompanyPeople && companyWindowList.length === 0 ? rowSkeleton('Buscando contactos') : companyWindowList.length === 0 ? (
        <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/10 px-6 py-8 text-center">
          <Building2 className="mb-3 h-5 w-5 text-foreground/70" aria-hidden="true" />
          <p className="font-medium">Aún no hay contactos</p>
          <p className="mt-1 max-w-md text-sm text-foreground/70">Vuelve a «Empresas», marca al menos una y busca contactos.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <div role="group" aria-label="Empresas con contactos" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0">
            {companyWindowList.map((window) => {
              const active = window.organization.id === activeCompanyId;
              return (
                <button
                  key={window.organization.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setActiveCompanyId(window.organization.id)}
                  className={cn(
                    'flex shrink-0 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-full',
                    active ? 'border-primary/50 bg-primary/5' : 'border-border/60 bg-background hover:border-primary/30',
                  )}
                >
                  <span className="min-w-0 max-w-[11rem] md:max-w-none">
                    <span className="block truncate font-medium">{window.organization.name}</span>
                    <span className="hidden truncate text-xs text-foreground/70 md:block">
                      {displayDomain(window.organization.primary_domain || window.organization.website_url || '') || 'Sin sitio web'}
                    </span>
                  </span>
                  <Badge variant={active ? 'info' : 'neutral'} className="tabular-nums">{window.leads.length}</Badge>
                </button>
              );
            })}
          </div>
          <div className="min-w-0 space-y-3">
            {!activeWindow ? (
              <p className="text-sm text-foreground/70">Elige una empresa para ver sus contactos.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">{activeWindow.organization.name}</h3>
                    <p className="text-xs text-foreground/70">
                      {activeWindow.leads.length} {activeWindow.leads.length === 1 ? 'contacto' : 'contactos'}
                      {activeWindow.totalEntries ? ` de unos ${activeWindow.totalEntries.toLocaleString('es-CL')}` : ''}
                    </p>
                  </div>
                  {activeWindow.leads.some((lead) => !isSavedLead(lead) && !isContactedLead(lead)) ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => selectWindowLeads(activeWindow)}>Marcar todos</Button>
                  ) : null}
                </div>
                {activeWindow.error && activeWindow.leads.length === 0 ? (
                  <Alert variant="warning">
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    <AlertTitle>Sin resultados en esta empresa</AlertTitle>
                    <AlertDescription>{activeWindow.error}</AlertDescription>
                  </Alert>
                ) : activeWindow.leads.length > 0 ? (
                  <ul className="space-y-2" aria-label={`Contactos de ${activeWindow.organization.name}`}>
                    {activeWindow.leads.map((lead) => (
                      <li key={lead.id}>
                        <SearchLeadRow
                          lead={lead}
                          selected={selectedLeads.has(lead.id)}
                          saved={isSavedLead(lead)}
                          contacted={isContactedLead(lead)}
                          onSelect={(checked) => handleSelectLead(lead.id, checked)}
                          lock={teamLockFor(lead)}
                          showCompany={false}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
                {activeWindow.error && activeWindow.leads.length > 0 ? (
                  <p className="text-sm text-cw-warning">{activeWindow.error}</p>
                ) : null}
                <div className="flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-foreground/70">
                    {peopleStale
                      ? 'Vuelve a buscar con los filtros nuevos para traer más.'
                      : activeWindow.hasMore
                        ? `Puedes traer hasta ${activeWindow.perPage} más de esta empresa.`
                        : 'No quedan más contactos con estos filtros en esta empresa.'}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!activeWindow.hasMore || activeWindow.isExpanding || peopleStale}
                    onClick={() => void handleExpandCompany(activeWindow.organization.id)}
                  >
                    {activeWindow.isExpanding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                    {activeWindow.isExpanding ? 'Buscando más…' : activeWindow.page === 0 ? 'Reintentar' : `Traer ${activeWindow.perPage} más`}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );

  const profileNotice = profileSearchNotice ? (
    <Alert variant={profileSearchNotice.tone === 'warning' ? 'warning' : 'info'} role="status">
      {profileSearchNotice.tone === 'warning'
        ? <AlertCircle className="h-4 w-4" aria-hidden="true" />
        : (profilePhonePollingIds.length > 0 ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Info className="h-4 w-4" aria-hidden="true" />)}
      <AlertTitle>{profileSearchNotice.title}</AlertTitle>
      <AlertDescription>
        <div className="space-y-3">
          <p>{profileSearchNotice.description}</p>
          <div className="flex flex-wrap items-center gap-3">
            {([['Correo', Mail, profileSearchNotice.emailState], ['Teléfono', Phone, profileSearchNotice.phoneState]] as const).map(([label, Icon, state]) => {
              const badge = contactStateBadge(state);
              return (
                <span key={label} className="inline-flex items-center gap-2 text-sm">
                  <Icon className="h-4 w-4 text-foreground/70" aria-hidden="true" />
                  {label}
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </span>
              );
            })}
          </div>
          {profilePhonePollingIds.length > 0 ? <p className="text-xs text-foreground/70">Puedes seguir usando la app; este resultado se actualiza solo.</p> : null}
        </div>
      </AlertDescription>
    </Alert>
  ) : null;

  const companyCandidatesSection = filters.searchMode === 'company_name' && companySelectionPending && companyCandidates.length > 0 ? (
    <section aria-labelledby="candidates-title" className="space-y-3 rounded-2xl border border-border/60 bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 h-4 w-4 text-primary" aria-hidden="true" />
        <div>
          <h2 id="candidates-title" className="font-medium">¿Cuál de estas empresas es?</h2>
          <p className="text-sm text-foreground/70">Encontramos varias coincidencias para «{filters.companyName}». Elige una para seguir.</p>
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
            <span className="block font-medium">{candidate.name}</span>
            <span className="mt-1 block text-sm text-foreground/70">{displayDomain(candidate.primary_domain || candidate.website_url || '') || 'Sin sitio web visible'}</span>
            <span className="mt-2 block text-xs text-foreground/70">
              {[candidate.city, candidate.state, candidate.country].filter(Boolean).join(', ') || 'Ubicación no disponible'}
            </span>
          </button>
        ))}
      </div>
    </section>
  ) : null;

  const leadsResults = (
    <section aria-labelledby="results-title" className="space-y-4 rounded-2xl border border-border/60 bg-card p-4 sm:p-5">
      <div className="space-y-1">
        <h2 id="results-title" className="text-base font-semibold tracking-tight">Resultados</h2>
        <p className="text-sm text-foreground/70" role="status" aria-live="polite" aria-atomic="true">
          {isLoading
            ? 'Buscando personas que calcen con tus criterios…'
            : leads.length > 0
              ? `${leads.length.toLocaleString('es-CL')} ${leads.length === 1 ? 'persona' : 'personas'}. Marca las que quieras guardar.`
              : companySelectionPending
                ? 'Elige una empresa para seguir.'
                : hasSearched
                  ? 'Revisa el resultado o ajusta los criterios.'
                  : 'Aquí aparecerán las personas que encuentres.'}
        </p>
      </div>
      {filters.searchMode === 'linkedin_profile' && profileProblem ? (
        <ProfileSearchProblemAlert message={profileProblem} busy={isLoading} onAction={handleProfileProblemAction} onDismiss={() => setProfileProblem(null)} />
      ) : null}
      {searchError}
      {isLoading ? rowSkeleton('Buscando personas') : pagedLeads.length > 0 ? (
        <>
          <ul className="space-y-2 md:hidden" aria-label="Personas encontradas">
            {pagedLeads.map((lead) => (
              <li key={lead.id}>
                <SearchLeadRow
                  lead={lead}
                  selected={selectedLeads.has(lead.id)}
                  saved={isSavedLead(lead)}
                  contacted={isContactedLead(lead)}
                  onSelect={(checked) => handleSelectLead(lead.id, checked)}
                  lock={teamLockFor(lead)}
                  details={profileDetails(lead)}
                />
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-xl border border-border/60 md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[52px]">
                    <Checkbox aria-label="Marcar todas las personas de esta página" onCheckedChange={(checked) => handleSelectAll(Boolean(checked))} checked={isPageAllSelected} />
                  </TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedLeads.map((lead) => {
                  const saved = isSavedLead(lead);
                  const contacted = isContactedLead(lead);
                  return (
                    <TableRow key={lead.id} data-state={selectedLeads.has(lead.id) ? 'selected' : ''}>
                      <TableCell>
                        <Checkbox
                          aria-label={saved || contacted ? `${lead.name}: ${saved ? 'ya guardado' : 'ya contactado'}` : `Seleccionar ${lead.name}`}
                          disabled={saved || contacted}
                          checked={selectedLeads.has(lead.id)}
                          onCheckedChange={(checked) => handleSelectLead(lead.id, Boolean(checked))}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {lead.avatar ? (
                            <Avatar>
                              <Image src={lead.avatar} width={40} height={40} className="rounded-full" alt="" unoptimized />
                              <AvatarFallback>{lead.name ? lead.name.charAt(0) : ''}</AvatarFallback>
                            </Avatar>
                          ) : (
                            <InitialsAvatar name={lead.name} className="h-10 w-10" />
                          )}
                          <div className="min-w-0">
                            <div className="font-medium">{lead.name}</div>
                            {lead.email ? <div className="text-xs text-foreground/70">{lead.email}</div> : null}
                            {profileDetails(lead)}
                            <TeamLockBadge lock={teamLockFor(lead)} className="mt-0.5" />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{lead.title}</TableCell>
                      <TableCell>
                        <div>{lead.company}</div>
                        {lead.industry && lead.industry !== '—' ? <div className="text-xs text-foreground/70">{lead.industry}</div> : null}
                      </TableCell>
                      <TableCell>
                        {saved ? <Badge variant="success">Guardado</Badge> : contacted ? <Badge variant="info">Contactado</Badge> : <span className="text-xs text-foreground/70">Nuevo</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      ) : !error && !(filters.searchMode === 'linkedin_profile' && profileProblem) ? (
        <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/10 px-6 py-8 text-center">
          <Search className="mb-3 h-5 w-5 text-foreground/70" aria-hidden="true" />
          <p className="font-medium">
            {companySelectionPending
              ? 'Elige una empresa para seguir'
              : filters.searchMode === 'linkedin_profile' && profileSearchNotice
                ? 'El perfil aún no está disponible'
                : hasSearched
                  ? 'No encontramos personas con estos criterios'
                  : 'Tus resultados aparecerán aquí'}
          </p>
          <p className="mt-1 max-w-md text-sm text-foreground/70">
            {companySelectionPending
              ? 'Selecciona una de las coincidencias de arriba.'
              : hasSearched
                ? 'Prueba ampliando la ubicación, el tamaño de empresa o el cargo.'
                : filters.searchMode === 'linkedin_profile'
                  ? 'Pega el perfil y presiona «Buscar».'
                  : 'Escribe la empresa y presiona «Buscar».'}
          </p>
          {hasSearched && !companySelectionPending && filters.searchMode !== 'linkedin_profile' ? (
            <FilterRelaxHint chips={activeChips} onRemove={removeFilterChip} disabled={isLoading} />
          ) : null}
        </div>
      ) : null}
      {totalPages > 1 ? (
        <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-foreground/70">
            {leads.length === 0 ? '0' : `${pageIndex * pageSize + 1}–${Math.min(leads.length, (pageIndex + 1) * pageSize)}`} de {leads.length}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              name="pageSize"
              value={String(pageSize)}
              onValueChange={(v) => { const n = Number(v); if (!Number.isNaN(n)) { setPageSize(n); setPageIndex(0); } }}
            >
              <SelectTrigger className="w-full sm:w-[150px]" aria-label="Personas por página"><SelectValue placeholder="Tamaño de página" /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((opt) => (<SelectItem key={opt} value={String(opt)}>{opt} por página</SelectItem>))}
              </SelectContent>
            </Select>
            <Button className="flex-1 sm:flex-none" variant="outline" onClick={() => setPageIndex((p) => Math.max(0, p - 1))} disabled={pageIndex === 0}>Anterior</Button>
            <Button className="flex-1 sm:flex-none" variant="outline" onClick={() => setPageIndex((p) => (p + 1 < totalPages ? p + 1 : p))} disabled={pageIndex + 1 >= totalPages}>Siguiente</Button>
          </div>
        </div>
      ) : null}
    </section>
  );

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 py-2">
      <PageHeader
        title="Buscar prospectos"
        description="Elige a quién buscar, revisa los resultados y guarda los contactos que te sirven."
        actions={(
          <Button asChild variant="ghost" className="w-full sm:w-auto">
            <Link href="/leads/import?from=buscar"><Upload className="h-4 w-4" aria-hidden="true" />¿Ya tienes tu lista? Impórtala</Link>
          </Button>
        )}
      />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <aside aria-label="Criterios de búsqueda" className="min-w-0 space-y-3 lg:sticky lg:top-16">
          {hasResults ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3 lg:hidden">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {filters.searchMode === 'filters' ? `Filtros${activeChips.length > 0 ? ` (${activeChips.length})` : ''}` : filters.searchMode === 'company_name' ? 'Empresa' : 'Perfil'}
                </p>
                <p className="truncate text-xs text-foreground/70">{criteriaSummary}</p>
              </div>
              <Button type="button" variant="outline" size="sm" aria-expanded={criteriaOpen} aria-controls="search-criteria" onClick={() => setCriteriaOpen((open) => !open)}>
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                {criteriaOpen ? 'Ocultar' : 'Editar'}
              </Button>
            </div>
          ) : null}
          <Card
            id="search-criteria"
            className={cn(
              'min-w-0 flex-col overflow-hidden rounded-2xl border-border/60 bg-card shadow-[0_10px_28px_-24px_rgba(15,23,42,0.16)] lg:flex lg:max-h-[calc(100vh-13rem)]',
              hasResults && !criteriaOpen ? 'hidden' : 'flex',
            )}
          >
            <CardHeader className="space-y-3 border-b border-border/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold tracking-tight">Criterios</h2>
                <div className="flex shrink-0 items-center gap-0.5">
                  {savedSearchesMenu}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 shadow-none"
                    aria-label="Guardar búsqueda"
                    onClick={() => {
                      setSaveSearchError('');
                      setSaveSearchOpen(true);
                    }}
                  >
                    <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden sm:inline lg:hidden xl:inline">Guardar</span>
                  </Button>
                </div>
              </div>
              {activeSavedSearchId ? (
                <CardDescription className="truncate text-foreground/70">
                  Usando «{savedSearches.find((item) => item.id === activeSavedSearchId)?.name || 'búsqueda guardada'}»
                </CardDescription>
              ) : null}
              {modeSwitch}
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto p-4">
              <fieldset
                ref={criteriaRef}
                disabled={isLoading || checkpointLoading}
                tabIndex={-1}
                aria-invalid={missingFilterError || undefined}
                aria-describedby={filters.searchMode === 'filters' ? 'filterRequirement' : undefined}
                className="min-w-0 border-0 p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <legend className="sr-only">Criterios de búsqueda</legend>
                {criteriaFields}
              </fieldset>
            </CardContent>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 bg-card p-3">
              <Button variant="ghost" className="shadow-none" onClick={handleClear} disabled={isLoading}>
                <X className="h-4 w-4" aria-hidden="true" />Limpiar
              </Button>
              {isLoading ? <Button variant="outline" className="shadow-none" onClick={handleAbort}>Cancelar</Button> : null}
              <Button data-tour="search-run" className="flex-1 shadow-none sm:flex-none sm:min-w-36" onClick={runSearch} disabled={isLoading || checkpointLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
                {isLoading ? 'Buscando…' : filters.searchMode === 'filters' ? 'Buscar empresas' : 'Buscar'}
              </Button>
            </div>
          </Card>
        </aside>

        <section
          aria-label="Resultados"
          className={cn('min-w-0 space-y-4', filters.searchMode === 'filters' && resultsView === 'intro' && 'order-first lg:order-none')}
        >
          {checkpointNotice ? <p role="status" className="text-sm text-foreground/70">{checkpointNotice}</p> : null}
          {filters.searchMode === 'filters' ? (
            resultsView === 'intro' ? (
              <>
                {searchError}
                <SearchIntro starters={searchStarters} onPick={applySearchStarter} disabled={isLoading || isLoadingCompanies} missingIdealCustomer={idealCustomerChecked && !idealCustomer} />
              </>
            ) : (
              <>
                <nav aria-label="Etapas de la búsqueda" className="flex flex-wrap items-center gap-2">
                  {stepButton('companies', 1, 'Empresas', companies.length)}
                  <ChevronRight className="h-4 w-4 text-foreground/70" aria-hidden="true" />
                  {stepButton('people', 2, 'Contactos', contactsFound, companyWindowList.length === 0)}
                </nav>
                {resultsView === 'people' ? peopleSection : companiesSection}
                {resultsView === 'companies' && companies.length > 0 ? (
                  <ResultsActionBar
                    label={`${selectedCompanyIds.size} de ${companies.length} empresas marcadas`}
                    hint={selectedCompanyIds.size === 0 ? 'Marca al menos una para buscar contactos.' : `Buscaremos hasta ${leadsPerCompany} contactos en cada una.`}
                  >
                    <Button type="button" disabled={isLoadingCompanyPeople || selectedCompanyIds.size === 0} onClick={() => void handleSearchCompanyPeople()}>
                      {isLoadingCompanyPeople ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
                      {isLoadingCompanyPeople ? 'Buscando contactos…' : 'Buscar contactos'}
                    </Button>
                  </ResultsActionBar>
                ) : null}
              </>
            )
          ) : (
            <>
              {profileNotice}
              {companyCandidatesSection}
              {leadsResults}
            </>
          )}
          {showLeadsBar ? (
            <ResultsActionBar
              label={`${selectedLeads.size} ${selectedLeads.size === 1 ? 'contacto seleccionado' : 'contactos seleccionados'}`}
              hint="Con correo o teléfono van a «Por escribir»; sin correo, a «Por completar»."
            >
              <Button type="button" variant="ghost" onClick={() => setSelectedLeads(new Set())} disabled={isSaving}>Quitar selección</Button>
              <Button type="button" onClick={handleSaveSelectedLeads} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                {isSaving ? 'Guardando…' : `Guardar ${selectedLeads.size}`}
              </Button>
            </ResultsActionBar>
          ) : null}
        </section>
      </div>

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
                <p className="text-xs text-foreground/70">Otros miembros podrán cargar estos criterios.</p>
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
