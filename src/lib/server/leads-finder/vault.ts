import { decryptStoredToken, encryptStoredToken } from '@/lib/server/token-crypto';
import { LEADS_FINDER_PROVIDER, type LeadsFinderContact, type LeadsFinderLead } from './client';

/**
 * The vault of the Leads Finder search (Plan 11, PR 6c, table from PR 6b): what Apify already brought and the search does
 * not show yet. Each person found is kept encrypted (token-crypto, «enc:v1.») for 30 days: the public lead as Apify
 * described it and the contact (email, phone, LinkedIn). «Enriquecer» reads it from here instead of asking again, and
 * deletes it once the contact is revealed. Only the server touches it; the browser never receives a row.
 */
export const LEADS_FINDER_VAULT_DAYS = 30;
const VAULT_TABLE = 'lead_search_vault';
const ID_RE = /^lf_[0-9a-f]{24}$/;
const MAX_SEALED = 8_000;
const DAY = 24 * 60 * 60 * 1000;

export type VaultEntry = { lead: LeadsFinderLead; contact: LeadsFinderContact };
type VaultRow = { provider_lead_id: string; contact_encrypted: string; expires_at: string };
type VaultClient = { from(table: string): any };

export const isLeadsFinderId = (value: unknown): value is string => typeof value === 'string' && ID_RE.test(value);

export class LeadsFinderVaultError extends Error {
  constructor(readonly code: 'LEADS_FINDER_VAULT_UNAVAILABLE') { super(code); this.name = 'LeadsFinderVaultError'; }
}

function seal(entry: VaultEntry) {
  const sealed = encryptStoredToken(JSON.stringify({ v: 1, lead: entry.lead, contact: entry.contact }));
  return sealed.startsWith('enc:v1.') && sealed.length <= MAX_SEALED ? sealed : null;
}

function open(sealed: string): VaultEntry | null {
  const plain = sealed.startsWith('enc:v1.') ? decryptStoredToken(sealed) : null;
  if (!plain) return null;
  try {
    const parsed = JSON.parse(plain) as { v?: unknown; lead?: VaultEntry['lead']; contact?: VaultEntry['contact'] };
    return parsed?.v === 1 && parsed.lead && parsed.contact ? { lead: parsed.lead, contact: parsed.contact } : null;
  } catch {
    return null;
  }
}

/**
 * Keeps the people of one search, replacing what the organization had for the same person (a new search renews the 30
 * days) and clearing its expired rows. Returns how many were stored; a write that fails is an error, because a result
 * that cannot be enriched later must not be shown.
 */
export async function storeInVault(client: VaultClient, input: { organizationId: string; userId: string; entries: VaultEntry[]; now?: number }) {
  const now = input.now ?? Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + LEADS_FINDER_VAULT_DAYS * DAY).toISOString();
  const rows = input.entries.flatMap(entry => {
    if (!isLeadsFinderId(entry.lead?.id)) return [];
    const sealed = seal(entry);
    return sealed ? [{
      organization_id: input.organizationId, provider: LEADS_FINDER_PROVIDER, provider_lead_id: entry.lead.id,
      searched_by: input.userId, contact_encrypted: sealed, created_at: createdAt, expires_at: expiresAt,
    }] : [];
  });
  await client.from(VAULT_TABLE).delete()
    .eq('organization_id', input.organizationId).eq('provider', LEADS_FINDER_PROVIDER).lt('expires_at', createdAt)
    .then(() => undefined, () => undefined);
  if (rows.length === 0) return 0;
  const { error } = await client.from(VAULT_TABLE).upsert(rows, { onConflict: 'organization_id,provider,provider_lead_id' });
  if (error) throw new LeadsFinderVaultError('LEADS_FINDER_VAULT_UNAVAILABLE');
  return rows.length;
}

/** The people still in the vault for these ids (not expired), by id. Ids that are missing or expired are left out. */
export async function readFromVault(client: VaultClient, input: { organizationId: string; ids: string[]; now?: number }) {
  const ids = [...new Set(input.ids.filter(isLeadsFinderId))];
  const found = new Map<string, VaultEntry>();
  if (ids.length === 0) return found;
  const { data, error } = await client.from(VAULT_TABLE)
    .select('provider_lead_id, contact_encrypted, expires_at')
    .eq('organization_id', input.organizationId).eq('provider', LEADS_FINDER_PROVIDER).in('provider_lead_id', ids);
  if (error) throw new LeadsFinderVaultError('LEADS_FINDER_VAULT_UNAVAILABLE');
  const now = input.now ?? Date.now();
  for (const row of (data || []) as VaultRow[]) {
    if (!isLeadsFinderId(row.provider_lead_id) || !(Date.parse(row.expires_at) > now)) continue;
    const entry = open(String(row.contact_encrypted || ''));
    if (entry && entry.lead.id === row.provider_lead_id) found.set(row.provider_lead_id, entry);
  }
  return found;
}

/** Once revealed, the contact lives in the enriched lead: the vault forgets it. Best effort, it expires anyway. */
export async function forgetInVault(client: VaultClient, input: { organizationId: string; ids: string[] }) {
  const ids = [...new Set(input.ids.filter(isLeadsFinderId))];
  if (ids.length === 0) return;
  await client.from(VAULT_TABLE).delete()
    .eq('organization_id', input.organizationId).eq('provider', LEADS_FINDER_PROVIDER).in('provider_lead_id', ids)
    .then(() => undefined, () => undefined);
}
