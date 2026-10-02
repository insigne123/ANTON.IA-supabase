import { z } from 'zod';
import { coworkLeadsSummary, type CoworkLeadsSummaryInput } from '@/lib/cowork/leads-summary';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';
import { normalizeLockEmail, teamLockNotice } from '@/lib/team-lock';
import { readTeamLocks } from '@/lib/server/team-locks';
import { ENRICHED_CONTACT_COLUMNS, mergeOwnContacts, type EnrichedContactRecord } from './own-contacts';

// Email is searchable too: people often look a contact up by the address they know.
const SEARCH_FIELDS = ['name', 'title', 'company', 'email', 'location', 'city', 'country'] as const;
// The same fields in «Por escribir» (enriched_leads), which Cowork reads too (Plan 6, PR-A).
const ENRICHED_SEARCH_FIELDS = ['full_name', 'title', 'company_name', 'email', 'city', 'country'] as const;

/** What Cowork sees of a saved contact's LinkedIn: the canonical profile address or nothing. A stored value that is not a profile
 * (a company page, a typo) is never passed on, so nobody is proposed for an invitation that cannot be queued, and a malformed one
 * cannot make the whole result unreadable for the exports and batches that validate it. */
function withProfile<Row extends { linkedin_url?: unknown }>(row: Row): Row & { linkedin_url: string | null } {
  return { ...row, linkedin_url: normalizeLinkedinProfileUrl(typeof row.linkedin_url === 'string' ? row.linkedin_url : null) || null };
}

/** «En conversación con Ana» on each contact another member holds (Plan 5, PR-9b), so Cowork does not propose writing to
 * them. Without collaboration, or if the read fails, the rows go as they are: sending is still checked by the database. */
async function withTeamLocks<Row extends { email?: unknown }>(client: SupabaseClient, scope: { userId: string; organizationId: string }, rows: Row[]) {
  const emails = rows.map(row => normalizeLockEmail(row.email)).filter(email => email.includes('@'));
  if (!emails.length) return rows;
  try {
    const locks = await readTeamLocks(client as any, scope, { emails });
    if (!locks.enabled) return rows;
    return rows.map(row => {
      const notice = teamLockNotice(locks.byEmail[normalizeLockEmail(row.email)]);
      return notice ? { ...row, teamLock: notice.text } : row;
    });
  } catch {
    return rows;
  }
}

function searchTerms(raw: string) {
  return raw.replace(/[^\p{L}\p{N}\s@.-]/gu, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').filter(term => term.length >= 2).slice(0, 6);
}

/**
 * Only records owned by this user in this org: the saved contacts and «Por escribir» (Plan 6, PR-A). A person of «Por escribir»
 * that is also saved shows once, as the saved contact, with the email and LinkedIn the email search found. Each item says its
 * source: «saved» or «enriched» (in «Por escribir», already with an email).
 */
export async function queryCoworkLeads(
  client: SupabaseClient,
  scope: { userId: string; organizationId: string },
  action: 'leads.search' | 'leads.get',
  value: string,
) {
  let query = client.from('leads')
    .select('id,name,title,company,email,status,industry,linkedin_url,location,city,country,created_at')
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .order('created_at', { ascending: false });
  let enriched = client.from('enriched_leads').select(ENRICHED_CONTACT_COLUMNS)
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .order('created_at', { ascending: false });
  let terms: string[] = [];
  if (action === 'leads.get') {
    const id = z.string().uuid().parse(value);
    query = query.eq('id', id).limit(1);
    enriched = enriched.eq('id', id).limit(1);
  } else {
    // Multi-term queries match by ranked overlap, never by whole-phrase
    // substring: every term counts where it appears, so «reclutador junior
    // GrupoExpro Santiago» still finds a recruiter even when the city is
    // unknown. PostgREST OR grammar must never receive raw model-supplied
    // punctuation.
    const raw = z.string().max(120).parse(value);
    terms = searchTerms(raw);
    if (raw.trim() && terms.length === 0) throw new Error('Invalid search term');
    if (terms.length > 0) {
      query = query.or(terms.flatMap(term => SEARCH_FIELDS.map(field => `${field}.ilike.%${term}%`)).join(','));
      enriched = enriched.or(terms.flatMap(term => ENRICHED_SEARCH_FIELDS.map(field => `${field}.ilike.%${term}%`)).join(','));
    }
    query = query.limit(60);
    enriched = enriched.limit(60);
  }
  const [{ data, error }, porEscribir] = await Promise.all([query, enriched]);
  if (error) throw new Error('No se pudieron consultar los contactos guardados.');
  // «Por escribir» is a second source: if it cannot be read, the saved contacts still answer.
  const merged = mergeOwnContacts((data || []) as Array<Record<string, unknown>>,
    porEscribir.error ? [] : ((porEscribir.data || []) as unknown as EnrichedContactRecord[]));
  const sources = { saved: merged.saved, enriched: merged.enriched };
  if (action === 'leads.get') {
    const rows = await withTeamLocks(client, scope, merged.rows.slice(0, 1).map(withProfile));
    return { items: rows, returned: rows.length, limit: 1, scope: 'own_saved_contacts', sources, truncated: false };
  }
  // Ties keep the most recent first across both lists: ISO timestamps compare as text, like the database orders them.
  const created = (row: Record<string, unknown>) => String(row.created_at || '');
  const ranked = merged.rows.map(row => {
    const haystack = SEARCH_FIELDS.map(field => String((row as Record<string, unknown>)[field] || '')).join(' ').toLocaleLowerCase('es');
    const matched = terms.filter(term => haystack.includes(term.toLocaleLowerCase('es'))).length;
    return { row, matched };
  }).sort((left, right) => right.matched - left.matched || created(right.row).localeCompare(created(left.row)));
  const best = ranked[0]?.matched || 0;
  const items = await withTeamLocks(client, scope, ranked.slice(0, 20).map(entry => withProfile(entry.row)));
  return {
    items, returned: items.length, limit: 20, scope: 'own_saved_contacts', sources,
    truncated: ranked.length > 20,
    partial: terms.length > 0 && items.length > 0 && best < terms.length,
    terms: terms.length,
  };
}

const COUNT_FIELDS = ['title', 'company', 'industry'] as const;

/** The phrases a segment is asked with: «reclutador | recursos humanos | talent». Each one is cleaned like the search terms (no
 * wildcard or grammar characters) and kept whole, so «recursos humanos» is one phrase and not two words. */
export function segmentPhrases(raw: string) {
  return raw.split(/[|,;]/).map(part => part.replace(/[^\p{L}\p{N}\s@.-]/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter(part => part.length >= 2).slice(0, 6).map(part => part.slice(0, 40));
}

const ENRICHED_COUNT_FIELDS = ['title', 'company_name', 'organization_industry'] as const;

/** How many of the person's contacts belong to a segment: exact counts, not the 20 that «leads.search» returns. A contact
 * belongs when any phrase appears in its title, company or industry. No phrases counts all of them. Only ids leave the database:
 * head-only counts of the saved contacts and of «Por escribir» (the ones the email search did not tie to a saved contact). */
export async function countCoworkLeads(
  client: SupabaseClient,
  scope: { userId: string; organizationId: string },
  value: string,
) {
  const raw = z.string().max(120).parse(value);
  const phrases = segmentPhrases(raw);
  if (raw.trim() && phrases.length === 0) throw new Error('Invalid search term');
  const base = () => {
    let query = client.from('leads').select('id', { count: 'exact', head: true })
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId);
    if (phrases.length) query = query.or(phrases.flatMap(phrase => COUNT_FIELDS.map(field => `${field}.ilike."%${phrase}%"`)).join(','));
    return query;
  };
  const enrichedBase = () => {
    let query = client.from('enriched_leads').select('id', { count: 'exact', head: true })
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).is('data->>sourceSavedLeadId', null);
    if (phrases.length) query = query.or(phrases.flatMap(phrase => ENRICHED_COUNT_FIELDS.map(field => `${field}.ilike."%${phrase}%"`)).join(','));
    return query;
  };
  const [total, withEmail, withProfile, enrichedTotal, enrichedEmail, enrichedProfile] = await Promise.all([
    base(),
    base().not('email', 'is', null).neq('email', ''),
    base().ilike('linkedin_url', '%linkedin.com/in/%'),
    enrichedBase(),
    enrichedBase().not('email', 'is', null).neq('email', ''),
    enrichedBase().ilike('linkedin_url', '%linkedin.com/in/%'),
  ]);
  if (total.error || withEmail.error || withProfile.error) throw new Error('No se pudieron contar los contactos guardados.');
  const count = (result: { count: number | null; error?: unknown }) => (result.error ? 0 : Number(result.count || 0));
  const saved = { total: count(total), withEmail: count(withEmail), withLinkedinProfile: count(withProfile) };
  // «Por escribir» adds to the figures; if it cannot be counted, the saved contacts still answer and the result says so.
  const enrichedRead = !enrichedTotal.error && !enrichedEmail.error && !enrichedProfile.error;
  const porEscribir = { total: count(enrichedTotal), withEmail: count(enrichedEmail), withLinkedinProfile: count(enrichedProfile) };
  const totalAll = saved.total + porEscribir.total;
  const withEmailAll = saved.withEmail + porEscribir.withEmail;
  return {
    scope: 'own_saved_contacts', phrases, exact: enrichedRead,
    total: totalAll, withEmail: withEmailAll, withoutEmail: totalAll - withEmailAll,
    withLinkedinProfile: saved.withLinkedinProfile + porEscribir.withLinkedinProfile,
    bySource: { saved, porEscribir: enrichedRead ? porEscribir : null },
    matchedIn: [...COUNT_FIELDS],
    limitation: 'Cuenta por texto en cargo, empresa y sector de tus contactos guardados y de «Por escribir»; un cargo escrito de otra forma no entra. Los conteos son exactos, pero «quiénes son» se ve con leads.search.',
  };
}

const SUMMARY_LIMIT = 5000;

/** «Revisa mis leads» (Plan 5, PR-7): the person's contacts by state with exact figures (up to 5,000 saved and 5,000 of «Por
 * escribir») and the next step of each group. «Por escribir» counts since Plan 6, PR-A: most contacts with an email live only
 * there. Only ids, emails and dates leave the database; no names. */
export async function summarizeCoworkLeads(client: SupabaseClient, scope: { userId: string; organizationId: string }) {
  const own = (table: string, fields: string) => client.from(table).select(fields).eq('organization_id', scope.organizationId).eq('user_id', scope.userId);
  const [leads, enriched, contacted, researched] = await Promise.all([
    own('leads', 'id,email,linkedin_url').order('created_at', { ascending: false }).limit(SUMMARY_LIMIT),
    own('enriched_leads', 'id,email,linkedin_url,saved_lead_id:data->>sourceSavedLeadId').order('created_at', { ascending: false }).limit(SUMMARY_LIMIT),
    own('contacted_leads', 'lead_id,email,replied_at').limit(SUMMARY_LIMIT * 2),
    own('lead_research_jobs', 'lead_id').eq('status', 'completed').limit(SUMMARY_LIMIT * 2),
  ]);
  if (leads.error || contacted.error || researched.error) throw new Error('No se pudieron resumir tus contactos guardados.');
  const savedRows = (leads.data || []) as unknown as Array<Record<string, unknown>>;
  const enrichedRows = enriched.error ? [] : ((enriched.data || []) as unknown as EnrichedContactRecord[]);
  const merged = mergeOwnContacts(savedRows, enrichedRows);
  return coworkLeadsSummary({
    leads: merged.rows.map(row => ({ id: String(row.id), email: (row.email as string | null) ?? null, linkedin_url: (row.linkedin_url as string | null) ?? null })),
    contacted: (contacted.data || []) as unknown as CoworkLeadsSummaryInput['contacted'],
    researched: (researched.data || []) as unknown as CoworkLeadsSummaryInput['researched'],
  }, {
    truncated: savedRows.length >= SUMMARY_LIMIT || enrichedRows.length >= SUMMARY_LIMIT,
    sources: { saved: merged.saved, porEscribir: enriched.error ? null : merged.enriched },
  });
}
