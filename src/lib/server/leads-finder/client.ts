import { createHash } from 'node:crypto';
import type { LeadSearchInput } from '@/lib/server/apollo-provider/validation';
import { LEADS_FINDER_ACTOR, leadsFinderInput } from './input';

/**
 * Runs Apify «Leads Finder» and splits each lead in two (Plan 11, PR 6a):
 * - `lead`: what the search shows, in the same shape as an Apollo search result, with the last name masked like Apollo's
 *   («Pe***z») and without email, phone, personal email or the person's LinkedIn;
 * - `contact`: what the actor already brought, kept on the server (the vault, PR 6b) until the person enriches the lead.
 * The browser never receives a `contact`.
 */
export const LEADS_FINDER_PROVIDER = 'leads_finder' as const;
/** «from $1.50 / 1,000 leads» on the actor's page; the estimate rounds up so the monthly cap never undercounts. */
export const leadsFinderUsdPerLead = (env: Record<string, string | undefined> = process.env) => {
  const value = Number(env.LEADS_FINDER_USD_PER_LEAD);
  return Number.isFinite(value) && value > 0 && value < 1 ? value : 0.002;
};

export type LeadsFinderContact = {
  fullName: string; firstName: string; lastName: string; email: string | null; personalEmail: string | null;
  mobileNumber: string | null; linkedinUrl: string | null; emailStatus: 'validated' | 'not_validated' | 'unknown' | null;
};
export type LeadsFinderLead = ReturnType<typeof publicLead>;
type Dependencies = { fetch: typeof fetch; token: string | undefined; usdPerLead?: number; maxRunUsd?: number };

export class LeadsFinderError extends Error {
  constructor(message: string, readonly status: number, readonly mayHaveCharged: boolean) { super(message); this.name = 'LeadsFinderError'; }
}

const text = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const nullable = (value: unknown) => text(value) || null;
const number = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
/** Apollo masks a last name as its first two letters, three asterisks and its last letter. */
export function maskLastName(lastName: string) {
  const value = lastName.trim();
  if (!value) return '';
  return value.length >= 4 ? `${value.slice(0, 2)}***${value.slice(-1)}` : `${value.slice(0, 1)}***`;
}
const cleanDomain = (value: unknown) => text(value).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || null;
const linkedinUrl = (value: unknown) => {
  const raw = text(value);
  if (!raw) return null;
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
  return /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(url.replace(/^http:/i, 'https:')) ? url.replace(/^http:/i, 'https:') : null;
};
/** A stable id that reveals nothing: the same person found twice keeps it, and it cannot be turned back into an email. */
function stableId(item: Record<string, unknown>) {
  const key = [text(item.linkedin), text(item.email).toLowerCase(), `${text(item.full_name)}|${text(item.company_domain || item.company_name)}`.toLowerCase()]
    .find(value => value && value !== '|');
  return key ? `lf_${createHash('sha256').update(key).digest('hex').slice(0, 24)}` : null;
}

function publicLead(item: Record<string, unknown>, id: string) {
  const firstName = text(item.first_name) || text(item.full_name).split(' ')[0] || '';
  const lastName = text(item.last_name) || text(item.full_name).split(' ').slice(1).join(' ');
  const maskedLast = maskLastName(lastName);
  const domain = cleanDomain(item.company_domain) || cleanDomain(item.company_website);
  return {
    id,
    name: [firstName, maskedLast].filter(Boolean).join(' '),
    first_name: firstName,
    last_name: maskedLast,
    has_email: Boolean(text(item.email)),
    has_direct_phone: Boolean(text(item.mobile_number)),
    title: nullable(item.job_title) || nullable(item.headline),
    headline: nullable(item.headline),
    city: nullable(item.city),
    state: nullable(item.state),
    country: nullable(item.country),
    seniority: nullable(item.seniority_level),
    departments: text(item.functional_level) ? [text(item.functional_level)] : [],
    source_provider: LEADS_FINDER_PROVIDER,
    source_provider_id: id,
    organization_name: nullable(item.company_name),
    organization_domain: domain,
    organization_industry: nullable(item.industry),
    organization_size: number(item.company_size),
    organization: {
      id: null,
      name: nullable(item.company_name),
      domain,
      industry: nullable(item.industry),
      website_url: nullable(item.company_website),
      linkedin_url: linkedinUrl(item.company_linkedin),
      short_description: nullable(item.company_description)?.slice(0, 600) ?? null,
    },
  };
}

function contactOf(item: Record<string, unknown>, onlyValidated: boolean): LeadsFinderContact {
  const status = text(item.email_status).toLowerCase();
  const email = nullable(item.email)?.toLowerCase() ?? null;
  return {
    fullName: text(item.full_name) || [text(item.first_name), text(item.last_name)].filter(Boolean).join(' '),
    firstName: text(item.first_name), lastName: text(item.last_name),
    email, personalEmail: nullable(item.personal_email)?.toLowerCase() ?? null,
    mobileNumber: nullable(item.mobile_number), linkedinUrl: linkedinUrl(item.linkedin),
    // The actor does not echo the status (a real run, 6 Oct 2026: no email_status in 50 of 50 items). When the search
    // asked for validated emails only, an email that came back passed that check.
    emailStatus: status === 'validated' || status === 'not_validated' || status === 'unknown' ? status : email && onlyValidated ? 'validated' : null,
  };
}

/** Each actor item, as a search result plus its hidden contact; items without a name or a way to tell them apart are dropped.
 * `requested` is the input's email_status filter: with only «validated», a returned email counts as validated. */
export function splitLeadsFinderItems(items: unknown[], requested: string[] = []) {
  const onlyValidated = requested.length === 1 && requested[0] === 'validated';
  const seen = new Set<string>();
  const results: Array<{ lead: LeadsFinderLead; contact: LeadsFinderContact }> = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const id = stableId(item);
    if (!id || seen.has(id) || !(text(item.first_name) || text(item.full_name))) continue;
    seen.add(id);
    results.push({ lead: publicLead(item, id), contact: contactOf(item, onlyValidated) });
  }
  return results;
}

/** Apify error types that mean the run never started, so nothing was charged (same reading as Fantastic Jobs). */
const REJECTED_BEFORE_START = new Set(['invalid-input', 'invalid-input-schema', 'run-input-body-not-valid-json', 'invalid-content-type-header']);
async function failure(response: Response) {
  const body = await response.json().catch(() => null) as { error?: { type?: unknown } } | null;
  const type = typeof body?.error?.type === 'string' ? body.error.type.slice(0, 60) : null;
  const tag = type ? ` (${type})` : '';
  if (response.status === 401 || response.status === 403) return new LeadsFinderError('Apify rechazó el token; revisa el acceso a la cuenta.', 503, false);
  if (response.status === 402) return new LeadsFinderError('Apify: no queda saldo en la cuenta.', 503, false);
  if (response.status === 404) return new LeadsFinderError('El buscador de Leads Finder no está disponible en Apify.', 503, false);
  if (response.status === 429) return new LeadsFinderError('Apify limitó las consultas por un momento; vuelve a intentarlo en un minuto.', 429, false);
  if (response.status === 408 || type === 'run-timeout-exceeded') return new LeadsFinderError('La búsqueda tardó demasiado; prueba con filtros más acotados.', 504, true);
  if (response.status === 400 && type && (REJECTED_BEFORE_START.has(type) || type.startsWith('invalid-'))) {
    return new LeadsFinderError(`Leads Finder rechazó los filtros${tag}; no se cobró nada.`, 400, false);
  }
  if (response.status === 400) return new LeadsFinderError(`La búsqueda de Leads Finder falló${tag}.`, 502, true);
  return new LeadsFinderError(`Apify respondió ${response.status}.`, 502, false);
}

/**
 * One search: the actor's input from the app's filters, a synchronous run capped in time and in money, and the results
 * split in public leads and hidden contacts. The token travels in a header, never in the URL.
 */
export async function searchLeadsFinder(input: LeadSearchInput, dependencies: Dependencies = { fetch: globalThis.fetch, token: process.env.APIFY_TOKEN }) {
  if (!dependencies.token) throw new LeadsFinderError('Falta el token de Apify (APIFY_TOKEN).', 503, false);
  const mapped = leadsFinderInput(input);
  if (!mapped.ok) throw new LeadsFinderError(mapped.error, 400, false);
  const usdPerLead = dependencies.usdPerLead ?? leadsFinderUsdPerLead();
  const maxRunUsd = Math.max(0.01, Math.min(dependencies.maxRunUsd ?? 0.5, 5));
  const params = new URLSearchParams({
    timeout: '110', memory: '512', maxItems: String(mapped.input.fetch_count), maxTotalChargeUsd: String(maxRunUsd),
    restartOnError: 'false', forcePermissionLevel: 'LIMITED_PERMISSIONS',
  });
  const response = await dependencies.fetch(`https://api.apify.com/v2/acts/${LEADS_FINDER_ACTOR}/run-sync-get-dataset-items?${params}`, {
    method: 'POST', headers: { authorization: `Bearer ${dependencies.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(mapped.input), signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw await failure(response);
  const items = await response.json().catch(() => null) as unknown;
  if (!Array.isArray(items)) throw new LeadsFinderError('Leads Finder no entregó una lista de contactos.', 502, true);
  const results = splitLeadsFinderItems(items.slice(0, mapped.input.fetch_count), mapped.input.email_status ?? []);
  return {
    results,
    fetched: items.length,
    notApplied: mapped.notApplied,
    // The dataset response has no receipt: estimate from what came back, never below what was returned.
    costUsd: Math.min(maxRunUsd, Math.round(items.length * usdPerLead * 10_000) / 10_000),
  };
}
