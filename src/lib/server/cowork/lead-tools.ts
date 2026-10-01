import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';
import { normalizeLockEmail, teamLockNotice } from '@/lib/team-lock';
import { readTeamLocks } from '@/lib/server/team-locks';

// Email is searchable too: people often look a contact up by the address they know.
const SEARCH_FIELDS = ['name', 'title', 'company', 'email', 'location', 'city', 'country'] as const;

/** What Cowork sees of a saved contact's LinkedIn: the canonical profile address or nothing. A stored value that is not a profile
 * (a company page, a typo) is never passed on, so nobody is proposed for an invitation that cannot be queued, and a malformed one
 * cannot make the whole result unreadable for the exports and batches that validate it. */
function withProfile<Row extends { linkedin_url?: unknown }>(row: Row): Omit<Row, 'linkedin_url'> & { linkedin_url: string | null } {
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

/** Conservative first scope: only records owned by this user in this org. */
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
  let terms: string[] = [];
  if (action === 'leads.get') {
    query = query.eq('id', z.string().uuid().parse(value)).limit(1);
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
      const ors = terms.flatMap(term => SEARCH_FIELDS.map(field => `${field}.ilike.%${term}%`));
      query = query.or(ors.join(','));
    }
    query = query.limit(60);
  }
  const { data, error } = await query;
  if (error) throw new Error('No se pudieron consultar los contactos guardados.');
  if (action === 'leads.get' || !data) {
    const rows = await withTeamLocks(client, scope, (data || []).map(withProfile));
    return { items: rows, returned: rows.length, limit: action === 'leads.get' ? 1 : 20, scope: 'own_saved_contacts', truncated: action === 'leads.search' && rows.length === 20 };
  }
  const ranked = data.map(row => {
    const haystack = SEARCH_FIELDS.map(field => String((row as Record<string, unknown>)[field] || '')).join(' ').toLocaleLowerCase('es');
    const matched = terms.filter(term => haystack.includes(term.toLocaleLowerCase('es'))).length;
    return { row, matched };
  }).sort((left, right) => right.matched - left.matched);
  const best = ranked[0]?.matched || 0;
  const items = await withTeamLocks(client, scope, ranked.slice(0, 20).map(entry => withProfile(entry.row)));
  return {
    items, returned: items.length, limit: 20, scope: 'own_saved_contacts',
    truncated: ranked.length > 20,
    partial: items.length > 0 && best < terms.length,
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

/** How many of the person's saved contacts belong to a segment: exact counts, not the 20 that «leads.search» returns. A contact
 * belongs when any phrase appears in its title, company or industry. No phrases counts all of them. Only ids leave the database:
 * three head-only counts, so even a book of thousands costs three small queries. */
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
  const [total, withEmail, withProfile] = await Promise.all([
    base(),
    base().not('email', 'is', null).neq('email', ''),
    base().ilike('linkedin_url', '%linkedin.com/in/%'),
  ]);
  if (total.error || withEmail.error || withProfile.error) throw new Error('No se pudieron contar los contactos guardados.');
  const count = (result: { count: number | null }) => Number(result.count || 0);
  return {
    scope: 'own_saved_contacts', phrases, exact: true,
    total: count(total), withEmail: count(withEmail), withoutEmail: count(total) - count(withEmail), withLinkedinProfile: count(withProfile),
    matchedIn: [...COUNT_FIELDS],
    limitation: 'Cuenta por texto en cargo, empresa y sector de tus contactos guardados; un cargo escrito de otra forma no entra. Los conteos son exactos, pero «quiénes son» se ve con leads.search.',
  };
}
