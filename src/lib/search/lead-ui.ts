// Pure helpers of «Buscar prospectos», moved out of src/app/(app)/search/page.tsx without changes (Plan 9, PR-10):
// how a provider lead becomes a row, how phones and contact states read, and how filter inputs split.
import { safeAvatarUrl } from '@/lib/avatar';
import type { CompanySearchOrganization } from '@/lib/leads-client';
import type { Lead } from '@/lib/schemas/leads';
import type { LeadSearchFilters } from '@/lib/search/saved-search-criteria';
import type { Lead as UILaed } from '@/lib/types';

export function getFriendlySearchErrorMessage(message?: string) {
  const raw = String(message || '').trim();
  const lower = raw.toLowerCase();
  const generic = 'No pudimos completar la búsqueda. Prueba de nuevo en unos minutos; si se repite, cambia algún filtro.';

  if (!raw) return generic;

  if (raw.includes('APOLLO_PROFILE_NO_USABLE_DATA')) {
    return 'No hay nombre, cargo ni empresa para esa dirección. Prueba solo con datos profesionales o busca a la persona por su empresa.';
  }

  if (lower.includes('perfil distinto') || lower.includes('otra persona') || lower.includes('corresponda a la url')) {
    return 'El proveedor devolvió datos de otra persona para esa dirección y no los mostramos. Busca a la persona por su empresa y cargo.';
  }

  if (/http_5\d\d|upstream|gateway|timeout|failed to fetch|no pudimos iniciar|no pudimos confirmar/.test(lower)) {
    return 'El proveedor de datos no respondió. Es temporal y no depende de tus filtros: prueba de nuevo en unos minutos.';
  }

  if (lower.includes('linkedin') || lower.includes('url')) {
    return 'Revisa la dirección de LinkedIn e intenta nuevamente.';
  }

  if (lower.includes('industria') || lower.includes('ubicacion') || lower.includes('ubicación') || lower.includes('tamano') || lower.includes('tamaño') || lower.includes('obligatorio') || lower.includes('al menos un filtro') || lower.startsWith('debes')) {
    return raw;
  }

  if (lower.includes('crédito') || lower.includes('credito')) return raw;

  if (lower.includes('quota') || lower.includes('limite') || lower.includes('límite') || lower.includes('429')) {
    if (lower.includes('alcanzaste el límite diario') || lower.includes('alcanzaste el limite diario')) return raw;
    return 'Llegaste al límite disponible por hoy. Puedes volver a intentarlo más tarde o pedir más cupo a quien administra tu cuenta.';
  }

  if (lower.includes('unauthorized') || lower.includes('401') || lower.includes('sesion') || lower.includes('sesión')) {
    return 'Tu sesión necesita renovarse. Vuelve a iniciar sesión y repite la búsqueda.';
  }

  return generic;
}

export function normalizeLeadForUI(raw: Lead, options?: {
  phoneStatus?: 'not_requested' | 'queued' | 'skipped' | 'failed' | undefined;
  revealEmail?: boolean;
  revealPhone?: boolean;
  organization?: CompanySearchOrganization | null;
}): UILaed {
  const name =
    raw.name?.trim() || `${raw.first_name || ''} ${raw.last_name || ''}`.trim() || '—';

  const company =
    options?.organization?.name?.trim() || raw.organization_name?.trim() || raw.org_name?.trim() || raw.organization?.name?.trim() || '—';

  const title = raw.title?.trim() || '—';
  const industry = options?.organization?.industry?.trim() || raw.organization_industry?.trim() || raw.industry?.trim() || raw.organization?.industry?.trim() || '—';

  const location = [raw.city, raw.state, raw.country].filter(Boolean).join(', ') || '—';

  // A real photo or nothing: the row draws initials itself instead of sending the name to an avatar service.
  const avatar = safeAvatarUrl(raw.photo_url) || '';

  const companyWebsite =
    options?.organization?.website_url?.trim() ||
    options?.organization?.primary_domain?.trim() ||
    raw.organization_website?.trim() ||
    raw.organization?.website_url?.trim() ||
    raw.organization_domain?.trim() ||
    (raw.organization?.domain ? `https://${raw.organization.domain}` : null);
  const companyLinkedin = options?.organization?.linkedin_url?.trim() || raw.organization?.linkedin_url?.trim() || null;
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
    country: raw.country || null,
    city: raw.city || null,
    status: 'saved',
    emailEnrichment: revealEmail && raw.email ? { enriched: true } : undefined,
    hasEmailOnFile: (raw as { has_email?: unknown }).has_email === true || undefined,
  };
}

export type ProfileContactState = 'ready' | 'missing' | 'queued' | 'not_requested';

export function hasVisibleLeadEmail(raw?: Pick<Lead, 'email'> | null) {
  const email = String(raw?.email || '').trim();
  return Boolean(email) && email !== 'email_not_unlocked@domain.com';
}

export function getPhoneValue(phone: any) {
  return String(phone?.sanitized_number || phone?.number || phone?.raw_number || '').trim() || null;
}

export function normalizeUiPhoneNumbers(phoneNumbers?: any[] | null): UILaed['phoneNumbers'] {
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

export function hasVisibleLeadPhone(raw?: Pick<Lead, 'primary_phone' | 'phone_numbers'> | null) {
  const phoneNumbers = normalizeUiPhoneNumbers(raw?.phone_numbers);
  return Boolean(raw?.primary_phone || getPhoneFallback(phoneNumbers));
}

export function buildLinkedInProfileNotice(params: {
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
    description = 'Encontramos el perfil, pero no hay correo ni teléfono disponibles para esta URL.';
  } else if (emailRequested && emailState === 'missing') {
    tone = 'warning';
    title = 'Perfil encontrado, sin correo disponible';
    description = phoneState === 'ready'
      ? 'El teléfono está disponible, pero no encontramos un correo para este perfil.'
      : 'No encontramos un correo disponible para este perfil.';
  } else if (phoneRequested && phoneState === 'missing') {
    tone = 'warning';
    title = 'Telefono no disponible por ahora';
    description = emailState === 'ready'
      ? 'El perfil y el correo están listos, pero no encontramos un teléfono.'
      : 'Encontramos el perfil, pero no hay un teléfono disponible.';
  } else if (!emailRequested && !phoneRequested) {
    title = 'Perfil encontrado';
    description = 'Encontramos el perfil sin solicitar datos de contacto.';
  }

  return { tone, title, description, emailState, phoneState };
}

/** How an email or phone state of a LinkedIn profile reads: a Badge tone of the app's palette and its word. */
export function contactStateBadge(state: ProfileContactState): { variant: 'success' | 'info' | 'warning' | 'neutral'; label: string } {
  if (state === 'ready') return { variant: 'success', label: 'Disponible' };
  if (state === 'queued') return { variant: 'info', label: 'Buscando…' };
  if (state === 'missing') return { variant: 'warning', label: 'No disponible' };
  return { variant: 'neutral', label: 'No solicitado' };
}

export type SavedLeadIds = { ids: Set<string>; providerIds: Set<string> };

/**
 * A search row carries the provider's id; a saved contact keeps that id in sourceProviderId (or, in old rows, as its own
 * id). Comparing only the saved rows' own ids, as the page did, never marked a result as «Guardado».
 */
export function isLeadSaved(lead: Pick<UILaed, 'id' | 'sourceProviderId'>, saved: SavedLeadIds) {
  const id = String(lead.id || '').trim();
  const providerId = String(lead.sourceProviderId || '').trim();
  return Boolean((id && (saved.ids.has(id) || saved.providerIds.has(id))) || (providerId && saved.providerIds.has(providerId)));
}

/** Contacted ids hold lead ids and emails in lower case (see contactedKeys). */
export function isLeadContacted(lead: Pick<UILaed, 'id' | 'email'>, contacted: Set<string>) {
  const email = String(lead.email || '').trim().toLowerCase();
  return Boolean((lead.id && contacted.has(String(lead.id))) || (email && contacted.has(email)));
}

export function contactedKeys(rows: Array<{ leadId?: string | null; email?: string | null }>) {
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.leadId) keys.add(String(row.leadId));
    const email = String(row.email || '').trim().toLowerCase();
    if (email) keys.add(email);
  }
  return keys;
}

const normalizedList = (value?: string) => splitFilterInput(value).map((item) => item.toLocaleLowerCase('es-CL')).sort();

/** What the company list depends on: change one of these and the companies shown no longer match the filters. */
export function companyFilterSignature(filters: Pick<LeadSearchFilters, 'companyKeywords' | 'location' | 'companyNameFilter' | 'sizeRange'>) {
  return JSON.stringify([normalizedList(filters.companyKeywords), normalizedList(filters.location), String(filters.companyNameFilter || '').trim().toLocaleLowerCase('es-CL'), String(filters.sizeRange || '').trim()]);
}

/** What the contacts inside the chosen companies depend on. */
export function peopleFilterSignature(filters: Pick<LeadSearchFilters, 'title' | 'seniorities' | 'personLocation' | 'maxResults'>) {
  return JSON.stringify([normalizedList(filters.title), [...(filters.seniorities || [])].sort(), normalizedList(filters.personLocation), Number(filters.maxResults) || 0]);
}

export function isPendingEnrichmentStatus(value?: string | null) {
  return String(value || '').trim().toLowerCase().startsWith('pending');
}

export const displayDomain = (url?: string) => {
  if (!url) return '';
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return String(url).replace(/^https?:\/\//, '').replace(/^www\./, '');
  }
};

export function normalizePhoneNumbersForEnriched(phoneNumbers?: UILaed['phoneNumbers']) {
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

export function getPhoneFallback(phoneNumbers?: UILaed['phoneNumbers']) {
  return phoneNumbers?.map((phone) => getPhoneValue(phone)).find(Boolean) || null;
}

export function hasLeadPhone(lead: UILaed) {
  return Boolean(lead.primaryPhone || getPhoneFallback(lead.phoneNumbers));
}

export function mapLeadToEnriched(l: UILaed) {
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

export function splitTitlesInput(value?: string) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function splitFilterInput(value?: string) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function hasBatchSearchFilters(filters: LeadSearchFilters) {
  return Boolean(
    splitFilterInput(filters.companyKeywords).length
    || splitFilterInput(filters.location).length
    || splitFilterInput(filters.personLocation).length
    || filters.sizeRange.trim()
    || splitTitlesInput(filters.title).length
    || filters.seniorities.length,
  );
}
