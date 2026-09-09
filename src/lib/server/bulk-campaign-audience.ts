import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { AudienceSearchSchema, matchAudience, type AudienceCriteria, type AudiencePerson, type AudienceSearch } from '@/lib/bulk-campaigns';

/** Explicit pagination: never classify an incomplete contact history as never contacted. */
export async function readAudienceRows(query: () => any): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; offset <= 10000; offset += 500) {
    const { data, error } = await query().order('id').range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data || []));
    if (rows.length > 10000) throw new Error('Tu base supera el límite de esta consulta. Se necesita una búsqueda paginada en servidor para continuar.');
    if (!data || data.length < 500) return rows;
  }
  throw new Error('No se pudo completar la consulta de audiencia.');
}

export function normalizeAudience(sources: any[], history: any[], dispatches: any[]): AudiencePerson[] {
  const people = new Map<string, AudiencePerson>();
  for (const row of sources) {
    const email = String(row.email || '').trim().toLowerCase();
    if (!z.string().email().safeParse(email).success) continue;
    const person: AudiencePerson = {
      email, name: String(row.full_name || row.name || ''), company: String(row.company_name || row.company || ''),
      title: String(row.title || row.role || ''), industry: String(row.organization_industry || row.industry || row.data?.industry || ''),
      country: String(row.country || row.data?.country || ''),
      size: String(row.organization_size || row.company_size || row.data?.companySize || ''),
      seniority: String(row.seniority || row.data?.seniority || ''),
      leadRef: String(row.lead_id || row.id),
      lastSentAt: null, contacted: false, replied: false, blockedReason: null, reasons: [],
    };
    const prior = people.get(email);
    if (prior) {
      for (const key of ['name', 'company', 'title', 'industry', 'country'] as const) if (!prior[key]) prior[key] = person[key];
    } else people.set(email, person);
    if (row.status === 'do_not_contact' || row.campaign_followup_allowed === false || row.bounced_at || row.delivery_status === 'bounced') people.get(email)!.blockedReason = 'No contactar o correo rebotado';
  }
  const latest = (person: AudiencePerson, value: unknown) => {
    if (typeof value === 'string' && Number.isFinite(Date.parse(value)) && (!person.lastSentAt || Date.parse(value) > Date.parse(person.lastSentAt))) person.lastSentAt = value;
  };
  for (const row of history) {
    const person = people.get(String(row.email || '').trim().toLowerCase());
    if (!person) continue;
    // Even ambiguous legacy records exclude a person from first contact.
    person.contacted = true;
    if (!['failed', 'unknown', 'pending', 'scheduled'].includes(row.status)) { latest(person, row.sent_at); latest(person, row.last_follow_up_at); }
    person.replied ||= Boolean(row.replied_at || row.status === 'replied');
    if (row.campaign_followup_allowed === false || row.status === 'do_not_contact' || row.bounced_at || row.delivery_status === 'bounced') person.blockedReason = 'No contactar o correo rebotado';
  }
  for (const row of dispatches) {
    const person = people.get(String(row.metadata?.recipient?.email || '').trim().toLowerCase());
    if (!person) continue;
    if (row.status === 'sent') { person.contacted = true; latest(person, row.completed_at); }
    if (['pending', 'sending', 'unknown'].includes(row.status)) { person.contacted = true; person.blockedReason = 'Hay un envío pendiente de confirmación'; }
  }
  return [...people.values()].sort((a, b) => a.email.localeCompare(b.email));
}

function cleanTerms(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.map(value => String(value || '').trim()).filter(Boolean).slice(0, 12);
}

/** Paginated server-side search. SQL filters history-aware; reasons are attached deterministically in TS. */
export async function searchAudiencePage(auth: AuthContext, input: unknown) {
  const search = AudienceSearchSchema.parse(input);
  const criteria = search.criteria;
  const { data, error } = await getSupabaseAdminClient().rpc('search_bulk_audience_v1', {
    p_organization_id: auth.organizationId, p_user_id: auth.user.id,
    p_relationship: criteria.relationship,
    p_titles: cleanTerms(criteria.titles), p_industries: cleanTerms(criteria.industries),
    p_countries: cleanTerms(criteria.countries), p_sizes: cleanTerms(criteria.sizes),
    p_seniorities: cleanTerms(criteria.seniorities),
    p_min_days: criteria.minimumDaysSinceSent, p_exclude_replied: criteria.excludeReplied,
    p_search: search.search, p_limit: search.pageSize, p_offset: search.page * search.pageSize,
  });
  if (error) throw error;
  const rows = Array.isArray(data?.people) ? data.people : [];
  const people = rows.flatMap((row: any) => {
    const person: AudiencePerson = {
      email: String(row.email || '').trim().toLowerCase(),
      name: String(row.name || ''), company: String(row.company || ''), title: String(row.title || ''),
      industry: String(row.industry || ''), country: String(row.country || ''),
      size: String(row.size || ''), seniority: String(row.seniority || ''),
      leadRef: String(row.leadRef || row.lead_ref || ''),
      lastSentAt: typeof row.lastSentAt === 'string' ? row.lastSentAt : null,
      contacted: row.contacted === true, replied: row.replied === true,
      blockedReason: typeof row.blockedReason === 'string' ? row.blockedReason : null,
      reasons: [],
    };
    if (!z.string().email().safeParse(person.email).success) return [];
    const reasons = matchAudience(person, criteria);
    return reasons ? [{ ...person, reasons }] : [];
  });
  return { people, total: Number(data?.total || 0), page: search.page, pageSize: search.pageSize };
}

export async function loadAudience(auth: AuthContext, criteria?: AudienceCriteria) {
  const admin = getSupabaseAdminClient();
  const visible = (table: string) => () => auth.supabase.from(table).select('*').eq('organization_id', auth.organizationId);
  const [leads, enriched, contacted, history, dispatches] = await Promise.all([
    readAudienceRows(visible('leads')), readAudienceRows(visible('enriched_leads')), readAudienceRows(visible('contacted_leads')),
    readAudienceRows(() => admin.from('contacted_leads').select('id,email,status,sent_at,last_follow_up_at,replied_at,campaign_followup_allowed,bounced_at,delivery_status').eq('organization_id', auth.organizationId)),
    readAudienceRows(() => admin.from('outbound_dispatches').select('id,metadata,status,completed_at').eq('organization_id', auth.organizationId).eq('channel', 'email')),
  ]);
  const people = normalizeAudience([...enriched, ...leads, ...contacted], history, dispatches);
  return criteria ? people.flatMap(person => {
    const reasons = matchAudience(person, criteria);
    return reasons ? [{ ...person, reasons }] : [];
  }) : people;
}
