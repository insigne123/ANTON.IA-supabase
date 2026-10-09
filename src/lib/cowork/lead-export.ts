import { z } from 'zod';

const cell = z.union([z.string(), z.number(), z.null()]).optional();
const optionalUrl = z.string().url().max(2048).refine(value => /^https?:\/\//i.test(value)).nullable().optional();
const rowSchema = z.object({ id: z.string().min(1).max(215), name: cell, title: cell, company: cell, email: cell, status: cell, industry: cell, location: cell,
  domain: cell, employees: cell,
  linkedin_url: optionalUrl, company_website: optionalUrl, company_linkedin: optionalUrl,
  // Why a person of an external search is on the list (search-ranking.ts).
  fit: cell,
}).strip();
export const COWORK_OBSERVED_CONTACT_MAX = 500;
const resultSchema = z.object({ items: z.array(rowSchema.extend({ id: z.string().uuid() })).max(COWORK_OBSERVED_CONTACT_MAX), scope: z.literal('own_saved_contacts') });
// Up to 100 per search (COWORK_SEARCH_MAX); older results had up to 25.
const externalResultSchema = z.object({ items: z.array(rowSchema.extend({ id: z.string().startsWith('apollo:').max(207) })).max(100), scope: z.literal('external_search') });
const companyResultSchema = z.object({ items: z.array(rowSchema.extend({ id: z.string().startsWith('apollo-company:').max(215), website: optionalUrl })).max(100), scope: z.literal('external_company_search') });
export const coworkLeadColumns = ['id', 'name', 'title', 'company', 'email', 'status', 'industry', 'location', 'domain', 'employees', 'company_website', 'fit'] as const;

export function csvCell(value: unknown) {
  const text = String(value ?? '');
  // Quote CSV grammar and neutralize spreadsheet formulas/control prefixes.
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Export only observed records, never model-authored tables. */
export function collectCoworkLeadRows(observations: unknown[]) {
  const rows = new Map<string, z.infer<typeof rowSchema>>();
  for (const observation of observations) {
    if (!observation || typeof observation !== 'object') continue;
    const payload = observation as Record<string, unknown>;
    if (payload.action !== 'leads.search' && payload.action !== 'leads.get' && payload.action !== 'prospecting.search') continue;
    if (payload.action === 'prospecting.search') {
      const companies = companyResultSchema.safeParse(payload.result);
      if (companies.success) {
        for (const { website, ...row } of companies.data.items) rows.set(row.id, { ...row, company_website: website, status: 'Empresa encontrada' });
        continue;
      }
    }
    const parsed = (payload.action === 'prospecting.search' ? externalResultSchema : resultSchema).safeParse(payload.result);
    if (!parsed.success) continue;
    for (const row of parsed.data.items) rows.set(row.id, row);
  }
  return [...rows.values()];
}

/**
 * The saved contacts leads.recommend put in front of Cowork (its top list): the organization's own people, so a proposal may
 * target them as it does the ones leads.search returned. Before (Plan 15), «¿A quiénes les ofrezco AXIS?» recommended Valentina
 * and Matías and every proposal to prepare them was rejected as unseen, until the turn failed.
 */
export function collectCoworkRecommendedLeadIds(observations: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const observation of observations) {
    if (!observation || typeof observation !== 'object' || (observation as { action?: unknown }).action !== 'leads.recommend') continue;
    const top = ((observation as { result?: { top?: unknown } }).result?.top);
    if (!Array.isArray(top)) continue;
    for (const item of top) {
      const leadId = item && typeof item === 'object' ? (item as { leadId?: unknown }).leadId : null;
      if (typeof leadId === 'string' && leadId) ids.add(leadId);
    }
  }
  return ids;
}

export function buildCoworkLeadCsv(observations: unknown[]) {
  const rows = collectCoworkLeadRows(observations);
  if (!rows.length) return null;
  return '\uFEFF' + [coworkLeadColumns.map(csvCell).join(','), ...rows.map(row => coworkLeadColumns.map(column => csvCell(row[column])).join(','))].join('\r\n');
}
