import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeLockEmail } from '@/lib/team-lock';

/**
 * Contacts of «Por escribir» for Cowork (Plan 6, PR-A). Most of them have no saved row: an email search from Buscar files the
 * person straight into enriched_leads, with the LinkedIn the provider gave. Cowork only read saved contacts, so it said
 * «no tiene LinkedIn» of people the app shows with one. Both kinds read and act the same way; ids are uuids in both tables.
 */
export const ENRICHED_CONTACT_COLUMNS = 'id,full_name,title,company_name,organization_name,email,organization_industry,linkedin_url,city,country,created_at,saved_lead_id:data->>sourceSavedLeadId';

export type EnrichedContactRecord = {
  id: string;
  full_name?: string | null;
  title?: string | null;
  company_name?: string | null;
  organization_name?: string | null;
  email?: string | null;
  organization_industry?: string | null;
  linkedin_url?: string | null;
  city?: string | null;
  country?: string | null;
  created_at?: string | null;
  saved_lead_id?: string | null;
};

/** A contact of «Por escribir» in the shape of a saved one. */
export function enrichedAsContact(row: EnrichedContactRecord) {
  return {
    id: String(row.id),
    name: row.full_name ?? null,
    title: row.title ?? null,
    company: row.company_name || row.organization_name || null,
    email: row.email ?? null,
    status: null,
    industry: row.organization_industry ?? null,
    linkedin_url: row.linkedin_url ?? null,
    location: null,
    city: row.city ?? null,
    country: row.country ?? null,
    created_at: row.created_at ?? null,
  };
}

type SavedContact = Record<string, unknown> & { id?: unknown; email?: unknown; linkedin_url?: unknown };

/** One person of the merged list: the saved row as it was read, or a «Por escribir» row in the same shape. */
export type MergedContact = { [key: string]: unknown; id?: unknown; email?: unknown; linkedin_url?: unknown; created_at?: unknown; source: 'saved' | 'enriched' };

/**
 * Saved contacts and «Por escribir» as one list, each person once. A «Por escribir» row of a saved person (linked by the saved id
 * the email search kept, or by the same email) completes that saved contact's email and LinkedIn instead of repeating it; the rest
 * join the list as source «enriched».
 */
export function mergeOwnContacts(saved: SavedContact[], enriched: EnrichedContactRecord[]): { rows: MergedContact[]; saved: number; enriched: number } {
  const savedRows: MergedContact[] = saved.map(row => ({ ...row, source: 'saved' as const }));
  const byId = new Map(savedRows.map(row => [String(row.id), row]));
  const byEmail = new Map<string, MergedContact>();
  for (const row of savedRows) {
    const email = normalizeLockEmail(row.email);
    if (email) byEmail.set(email, row);
  }
  const extra: MergedContact[] = [];
  for (const record of enriched) {
    const email = normalizeLockEmail(record.email);
    const linked = (record.saved_lead_id ? byId.get(String(record.saved_lead_id)) : undefined)
      || (email ? byEmail.get(email) : undefined)
      || byId.get(String(record.id));
    if (linked) {
      if (!linked.linkedin_url && record.linkedin_url) linked.linkedin_url = record.linkedin_url;
      if (!linked.email && record.email) linked.email = record.email;
      continue;
    }
    extra.push({ ...enrichedAsContact(record), source: 'enriched' });
  }
  return { rows: [...savedRows, ...extra], saved: savedRows.length, enriched: extra.length };
}

export type OwnContactRow = { id: string; name: string | null; email: string | null; title: string | null; company: string | null; linkedin_url: string | null };

/** The organization's contacts with these ids, saved first and then «Por escribir». Throws when a table cannot be read. */
export async function loadOrganizationContacts(client: SupabaseClient, organizationId: string, ids: string[]): Promise<Map<string, OwnContactRow>> {
  const found = new Map<string, OwnContactRow>();
  if (!ids.length) return found;
  const saved = await client.from('leads').select('id,name,email,title,company,linkedin_url')
    .eq('organization_id', organizationId).in('id', ids);
  if (saved.error) throw new Error('No se pudo leer el contacto.');
  for (const row of (saved.data || []) as OwnContactRow[]) found.set(String(row.id), row);
  const missing = ids.filter(id => !found.has(id));
  if (!missing.length) return found;
  const enriched = await client.from('enriched_leads').select(ENRICHED_CONTACT_COLUMNS)
    .eq('organization_id', organizationId).in('id', missing);
  if (enriched.error) throw new Error('No se pudo leer el contacto.');
  for (const record of (enriched.data || []) as unknown as EnrichedContactRecord[]) {
    const row = enrichedAsContact(record);
    found.set(row.id, { id: row.id, name: row.name, email: row.email, title: row.title, company: row.company, linkedin_url: row.linkedin_url });
  }
  return found;
}

/** Whether this id is one of the person's own contacts, saved or in «Por escribir». */
export async function ownsContact(client: SupabaseClient, scope: { userId: string; organizationId: string }, id: string) {
  for (const table of ['leads', 'enriched_leads']) {
    const row = await client.from(table).select('id').eq('id', id)
      .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (row.error) return false;
    if (row.data) return true;
  }
  return false;
}
