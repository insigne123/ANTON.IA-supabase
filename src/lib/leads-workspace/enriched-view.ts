// Pure rules of «Por escribir» (saved/leads/enriched), moved out of the page without changes (Plan 9, PR-12): when a
// contact counts as researched or ready for a draft, how the filters match, the phone state and the export row.
import { buildResearchReport, canShowResearchDraftAction, researchReadinessFor } from '@/lib/research-workspace';
import type { NativeResearchLeadStatus } from '@/lib/native-research-contracts';
import { hasActivePhoneLookup } from '@/lib/enriched-phone-status';
import type { EnrichedLead, Lead } from '@/lib/types';

export const extractDomainFromEmail = (email?: string | null) =>
  email && email.includes('@') ? email.split('@')[1].toLowerCase() : undefined;

export function nativeResearchReview(status: NativeResearchLeadStatus | null | undefined) {
  if (!status?.result) return null;
  const report = buildResearchReport(status.result);
  const readiness = researchReadinessFor({
    status: status.status,
    lead: status.result.lead,
    result: status.result,
    snapshotId: status.researchSnapshotId,
    evidenceCount: report.coverage.evidenceRecords,
    sourceCount: report.coverage.sources,
  });
  return { report, readiness };
}

export function isNativeResearchReport(status: NativeResearchLeadStatus | null | undefined) {
  const review = nativeResearchReview(status);
  return Boolean(
    review
    && status
    && ['completed', 'partial'].includes(status.status)
    && status.researchSnapshotId
    && review.report.coverage.companyFacts > 0,
  );
}

export function hasNativeResearchResult(status: NativeResearchLeadStatus | null | undefined) {
  return Boolean(
    status?.result
    && ['completed', 'partial', 'insufficient_data'].includes(status.status),
  );
}

export function nativeResearchCanCreateDraft(lead: EnrichedLead, status: NativeResearchLeadStatus | null | undefined) {
  const review = nativeResearchReview(status);
  return Boolean(
    lead.email
    && status?.result
    && review
    && canShowResearchDraftAction({
      readiness: review.readiness,
      snapshotId: status.researchSnapshotId,
      eligible: status.result.draftEligibility.eligible,
      canCreateDraft: true,
    }),
  );
}

/** Lower case without accents, so «Gestión» matches «gestion». */
export const normalizeSearchText = (value?: string | null) =>
  (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** «retail, minería» → ['retail', 'mineria']. */
export const splitFilterTerms = (value: string) =>
  value
    .split(',')
    .map((term) => normalizeSearchText(term).trim())
    .filter(Boolean);

export type EnrichedPhoneState = 'ready' | 'pending' | 'missing';

export function enrichedLeadPhoneState(lead: EnrichedLead): EnrichedPhoneState {
  const fallbackPhone = lead.phoneNumbers?.length ? lead.phoneNumbers[0].sanitized_number : undefined;
  const shownPhone = lead.primaryPhone || fallbackPhone;
  if (shownPhone && shownPhone !== 'Not Found') return 'ready';
  if (hasActivePhoneLookup(lead)) return 'pending';
  return 'missing';
}

/** The ids with a phone lookup still running, sorted: a key that changes only when that set changes. */
export function pendingPhoneLookupKey(leads: EnrichedLead[]) {
  return leads.filter((lead) => hasActivePhoneLookup(lead)).map((lead) => String(lead.id || '').trim()).filter(Boolean).sort().join(',');
}

export type EnrichedLeadFilters = {
  searchTerm: string;
  companyFilter: string;
  nameFilter: string;
  titleFilter: string;
  industryFilter: string;
  phoneFilter: 'all' | EnrichedPhoneState;
  createdFrom: string;
  createdTo: string;
  /** The include/exclude groups, comma separated. */
  applied: { incCompany: string; incLead: string; incTitle: string; excCompany: string; excLead: string; excTitle: string };
};

/** A contact passes when it matches every filter written; several terms in one group mean any of them. */
export function filterEnrichedLeads(leads: EnrichedLead[], filters: EnrichedLeadFilters) {
  const { applied, searchTerm, companyFilter, nameFilter, titleFilter, industryFilter, phoneFilter, createdFrom, createdTo } = filters;
  const incCompanies = splitFilterTerms(applied.incCompany);
  const incLeads = splitFilterTerms(applied.incLead);
  const incTitles = splitFilterTerms(applied.incTitle);
  const excCompanies = splitFilterTerms(applied.excCompany);
  const excLeads = splitFilterTerms(applied.excLead);
  const excTitles = splitFilterTerms(applied.excTitle);

  const containsAny = (value?: string | null, terms?: string[]) => {
    if (!terms || terms.length === 0) return true;
    const normalized = normalizeSearchText(value);
    return terms.some((term) => normalized.includes(term));
  };
  const excludesAll = (value?: string | null, terms?: string[]) => {
    if (!terms || terms.length === 0) return true;
    const normalized = normalizeSearchText(value);
    return terms.every((term) => !normalized.includes(term));
  };
  const createdInRange = (lead: EnrichedLead) => {
    if (!createdFrom && !createdTo) return true;
    const created = new Date(lead.createdAt || 0);
    if (Number.isNaN(created.getTime())) return false;
    if (createdFrom && created < new Date(`${createdFrom}T00:00:00`)) return false;
    if (createdTo && created > new Date(`${createdTo}T23:59:59`)) return false;
    return true;
  };

  return leads.filter((lead) =>
    (!searchTerm || [lead.fullName, lead.companyName, lead.title, lead.email, lead.companyDomain]
      .some((value) => normalizeSearchText(value).includes(normalizeSearchText(searchTerm)))) &&
    containsAny(lead.companyName, incCompanies) &&
    containsAny(lead.fullName, incLeads) &&
    containsAny(lead.title, incTitles) &&
    (!companyFilter || normalizeSearchText(lead.companyName).includes(normalizeSearchText(companyFilter))) &&
    (!nameFilter || normalizeSearchText(lead.fullName).includes(normalizeSearchText(nameFilter))) &&
    (!titleFilter || normalizeSearchText(lead.title).includes(normalizeSearchText(titleFilter))) &&
    (industryFilter === 'all' || String(lead.industry || lead.organizationIndustry || '').trim() === industryFilter) &&
    (phoneFilter === 'all' || enrichedLeadPhoneState(lead) === phoneFilter) &&
    createdInRange(lead) &&
    excludesAll(lead.companyName, excCompanies) &&
    excludesAll(lead.fullName, excLeads) &&
    excludesAll(lead.title, excTitles),
  );
}

/** Fills a missing company name or domain from the saved contact with the same LinkedIn, or the same name and company. */
export function withCompanyFromSaved(enriched: EnrichedLead[], saved: Lead[]) {
  return enriched.map((lead) => {
    if (lead.companyName && lead.companyDomain) return lead;
    const match =
      saved.find((item) => lead.linkedinUrl && item.linkedinUrl === lead.linkedinUrl) ||
      saved.find((item) => `${item.name}|${item.company}`.toLowerCase() === `${lead.fullName}|${lead.companyName || ''}`.toLowerCase());
    const fromEmail = extractDomainFromEmail(lead.email);
    const fromWebsite =
      match?.companyWebsite
        ? (match.companyWebsite.startsWith('http') ? new URL(match.companyWebsite).hostname : match.companyWebsite)
          .replace(/^https?:\/\//, '').replace(/^www\./, '')
        : undefined;
    return {
      ...lead,
      companyName: lead.companyName ?? match?.company ?? lead.companyName ?? undefined,
      companyDomain: lead.companyDomain ?? fromWebsite ?? fromEmail ?? lead.companyDomain ?? undefined,
    };
  });
}

export const ENRICHED_EXPORT_HEADERS = ['Nombre', 'Cargo', 'Empresa', 'Email', 'Teléfono', 'LinkedIn', 'Dominio'];

export const enrichedExportRow = (lead: EnrichedLead): (string | number)[] => ([
  lead.fullName || '',
  lead.title || '',
  lead.companyName || '',
  lead.email || (lead.emailStatus === 'locked' ? '(locked)' : ''),
  lead.primaryPhone || (lead.phoneNumbers && lead.phoneNumbers[0] ? lead.phoneNumbers[0].sanitized_number : '') || '',
  lead.linkedinUrl || '',
  lead.companyDomain || '',
]);
