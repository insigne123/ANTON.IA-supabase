import { z } from 'zod';
import { coworkLeadsSummary, type CoworkLeadsSummaryInput } from '@/lib/cowork/leads-summary';
import type { SupabaseClient } from '@supabase/supabase-js';
import { linkedinProfilesMatch, normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';
import { normalizeLockEmail, teamLockNotice } from '@/lib/team-lock';
import { readTeamLocks } from '@/lib/server/team-locks';
import { ENRICHED_CONTACT_COLUMNS, mergeOwnContacts, type EnrichedContactRecord } from './own-contacts';

/** The most rows «Ver todos» brings to the panel and to the export (Plan 13): beyond it, the list is cut and says so. */
export const COWORK_FULL_LIST_MAX = 500;

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
      return notice ? { ...row, teamLock: notice.text, teamLockBlocks: notice.blocks } : row;
    });
  } catch {
    return rows;
  }
}

function searchTerms(raw: string) {
  return raw.replace(/[^\p{L}\p{N}\s@.-]/gu, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').filter(term => term.length >= 2).slice(0, 6);
}

/** Match a whole personal path, including stored tracking queries. URL words
 * never become text filters over names, companies or email addresses. */
function profileFilter(profile: string) {
  const path = new URL(profile).pathname;
  const paths = [...new Set([path, decodeURIComponent(path)])];
  const quoted = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return paths.flatMap(value => {
    const literal = value.replace(/[%_\\]/g, '\\$&');
    return ['', '/', '?*', '/?*'].map(ending => `linkedin_url.ilike.${quoted(`*linkedin.com${literal}${ending}`)}`);
  }).join(',');
}

/**
 * Only records owned by this user in this org: the saved contacts and «Por escribir» (Plan 6, PR-A). A person of «Por escribir»
 * that is also saved shows once, as the saved contact, with the email and LinkedIn the email search found. Each item says its
 * source: «saved» or «enriched» (in «Por escribir», already with an email).
 */
/**
 * «con correo» in a search keeps only the contacts with an email (Plan 15), alone or with other words («con correo recursos
 * humanos»). The 20 most recent of 256 contacts may hold one or two of the 21 with an email, and a campaign only goes to the
 * people Cowork saw: «una campaña para mis contactos con correo» left most of them out.
 */
export const COWORK_WITH_EMAIL_QUERY = /(?:^|\s)con\s+(?:correo|email|e-mail|mail)(?=\s|$)/i;
/** As many as a campaign Cowork proposes can take (campaign.create, 25 observed emails). */
export const COWORK_WITH_EMAIL_MAX = 25;

export async function queryCoworkLeads(
  client: SupabaseClient,
  scope: { userId: string; organizationId: string },
  action: 'leads.search' | 'leads.get',
  value: string,
  /** How many rows a search returns: 20 for Cowork's turn, up to COWORK_FULL_LIST_MAX for «Ver todos» (Plan 13). */
  options: { max?: number } = {},
) {
  const withEmail = action === 'leads.search' && COWORK_WITH_EMAIL_QUERY.test(String(value || ''));
  const max = Math.min(COWORK_FULL_LIST_MAX, Math.max(1, Math.floor(options.max ?? (withEmail ? COWORK_WITH_EMAIL_MAX : 20))));
  const fetchLimit = Math.max(60, max);
  let query = client.from('leads')
    .select('id,name,title,company,email,status,industry,linkedin_url,location,city,country,created_at')
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .order('created_at', { ascending: false });
  let enriched = client.from('enriched_leads').select(ENRICHED_CONTACT_COLUMNS)
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .order('created_at', { ascending: false });
  let terms: string[] = [];
  let profile = '';
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
    const raw = z.string().max(500).parse(value).replace(COWORK_WITH_EMAIL_QUERY, ' ').trim();
    profile = normalizeLinkedinProfileUrl(raw);
    if (!profile) z.string().max(120).parse(raw);
    if (/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*linkedin\.com(?:\/|$)/i.test(raw) && !profile) {
      throw new Error('Usa una URL de perfil personal de LinkedIn (/in/).');
    }
    terms = profile ? [] : searchTerms(raw);
    if (!profile && raw.trim() && terms.length === 0) throw new Error('Invalid search term');
    if (profile) {
      query = query.or(profileFilter(profile));
      enriched = enriched.or(profileFilter(profile));
    }
    if (terms.length > 0) {
      query = query.or(terms.flatMap(term => SEARCH_FIELDS.map(field => `${field}.ilike.%${term}%`)).join(','));
      enriched = enriched.or(terms.flatMap(term => ENRICHED_SEARCH_FIELDS.map(field => `${field}.ilike.%${term}%`)).join(','));
    }
    if (withEmail) {
      query = query.not('email', 'is', null).neq('email', '');
      enriched = enriched.not('email', 'is', null);
    }
    query = query.limit(fetchLimit);
    enriched = enriched.limit(fetchLimit);
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
  if (profile) {
    const matches = merged.rows.filter(row => linkedinProfilesMatch(typeof row.linkedin_url === 'string' ? row.linkedin_url : null, profile));
    const items = await withTeamLocks(client, scope, matches.slice(0, max).map(withProfile));
    return { items, returned: items.length, limit: max, scope: 'own_saved_contacts', sources,
      truncated: matches.length > max, partial: false, terms: 0, match: 'linkedin_url', profileUrl: profile,
      sourcesComplete: !porEscribir.error,
      ...(porEscribir.error ? { notice: 'No se pudo consultar «Por escribir»; no puedo confirmar que este perfil no esté guardado.' }
        : !items.length ? { profileLookup: { action: 'prospecting.propose_search', searchCriteria: {
          linkedinUrl: profile, titles: [], industries: [], locations: [], limit: 1,
        } } } : {}) };
  }
  // Ties keep the most recent first across both lists: ISO timestamps compare as text, like the database orders them.
  const created = (row: Record<string, unknown>) => String(row.created_at || '');
  const ranked = merged.rows.map(row => {
    const haystack = SEARCH_FIELDS.map(field => String((row as Record<string, unknown>)[field] || '')).join(' ').toLocaleLowerCase('es');
    const matched = terms.filter(term => haystack.includes(term.toLocaleLowerCase('es'))).length;
    return { row, matched };
  }).sort((left, right) => right.matched - left.matched || created(right.row).localeCompare(created(left.row)));
  const best = ranked[0]?.matched || 0;
  const items = await withTeamLocks(client, scope, ranked.slice(0, max).map(entry => withProfile(entry.row)));
  // Either list cut at the fetch limit may hold more matches than the ones ranked here.
  const cut = (data || []).length >= fetchLimit || (!porEscribir.error && (porEscribir.data || []).length >= fetchLimit);
  return {
    items, returned: items.length, limit: max, scope: 'own_saved_contacts', sources,
    truncated: ranked.length > max || cut,
    partial: terms.length > 0 && items.length > 0 && best < terms.length,
    terms: terms.length,
    withEmailOnly: withEmail || undefined,
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
