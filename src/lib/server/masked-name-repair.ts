import { isMaskedName, textNamesPerson } from '@/lib/lead-name';
import { applyEnrichedIdentity, identityFromProvider, providerFullName } from '@/lib/server/lead-identity';

/**
 * The «Por escribir» contacts that still show a hidden surname (Plan 6, PR-F). Since #89 the email lookup keeps the real
 * name, but the contacts enriched before it kept «Rafael Du***n», and so did their saved row. This asks the provider again
 * for each one, by its person id or its LinkedIn, and applies the real name with the lookup's rules: only gaps, never what
 * someone typed (docs/contactos-identidad.md). A dry run by default; nothing is ever sent to anyone.
 */

export type MaskedContact = {
  id: string;
  userId: string;
  organizationId: string;
  maskedName: string;
  /** The provider's person id, only when the contact came from that provider. */
  providerId: string | null;
  linkedinUrl: string | null;
  /** The saved contact the email lookup came from, which gets the real name too. */
  savedLeadId: string | null;
};

export type MaskedLookup = { providerId: string | null; linkedinUrl: string | null };

/** The provider's answer for one person: its record when it found them, and the credits it charged. */
export type MaskedNameMatch = (lookup: MaskedLookup) => Promise<{ found: boolean; person?: Record<string, unknown> | null; credits?: number | null }>;

export type MaskedRepairStatus =
  /** Dry run: it would be asked by its id or its LinkedIn. */
  | 'would_query'
  /** No provider id and no LinkedIn: there is nothing to ask the provider for. */
  | 'no_lookup'
  /** Over --limit. */
  | 'skipped'
  | 'fixed'
  /** The provider answered, but nothing changed: the name was edited meanwhile, or the provider still hides it. */
  | 'unchanged'
  | 'not_found'
  /** The provider returned someone else: another id, or a name that does not fit the visible ends. Nothing is written. */
  | 'mismatch'
  | 'error';

export type MaskedRepairRow = { id: string; maskedName: string; lookup: 'id' | 'linkedin' | null; status: MaskedRepairStatus; detail?: string };

export type MaskedRepairReport = {
  apply: boolean;
  before: number;
  lookups: { byId: number; byLinkedin: number; none: number };
  rows: MaskedRepairRow[];
  credits: number;
  /** Contacts still showing a hidden surname after --apply; null on a dry run. */
  after: number | null;
};

type Client = { from: (table: string) => any };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 500;

function text(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** A row of enriched_leads as a contact to repair, or null when its name is complete. */
export function maskedContactOf(row: Record<string, unknown>): MaskedContact | null {
  const maskedName = text(row.full_name);
  if (!isMaskedName(maskedName)) return null;
  const data = record(row.data);
  const provider = text(row.source_provider || data.sourceProvider).toLowerCase();
  // Another provider's id (FullEnrich) means nothing to this one.
  const providerId = [data.apolloId, ...(provider === 'apollo' ? [row.source_provider_id, data.sourceProviderId] : [])]
    .map(text).find(Boolean) || null;
  const savedLeadId = text(data.sourceSavedLeadId);
  return {
    id: text(row.id),
    userId: text(row.user_id),
    organizationId: text(row.organization_id),
    maskedName,
    providerId,
    linkedinUrl: text(row.linkedin_url) || null,
    savedLeadId: UUID.test(savedLeadId) ? savedLeadId : null,
  };
}

/** How the provider can be asked for this person: by its id first, then by its LinkedIn. */
export function lookupOf(contact: MaskedContact): 'id' | 'linkedin' | null {
  if (contact.providerId) return 'id';
  if (contact.linkedinUrl) return 'linkedin';
  return null;
}

/**
 * Whether the provider's person is the one behind the hidden name: the same first name, and a surname with the same visible
 * ends («Durán» for «Du***n»). A two-word surname is hidden whole («Du***o» for «Durán Soto»), so it is compared joined too.
 */
export function fitsMaskedName(person: Record<string, unknown>, maskedName: string) {
  const full = providerFullName(identityFromProvider(person));
  if (!full) return false;
  const first = text(person.first_name);
  const last = text(person.last_name).replace(/\s+/g, '');
  return [full, first && last ? `${first} ${last}` : ''].some(name => Boolean(name) && textNamesPerson(name, maskedName));
}

/** Every contact of «Por escribir» that still shows a hidden surname, across organizations (maintenance, service role). */
export async function readMaskedContacts(client: Client): Promise<MaskedContact[]> {
  const found: MaskedContact[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from('enriched_leads')
      .select('id,user_id,organization_id,full_name,linkedin_url,source_provider,source_provider_id,data')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`No se pudo leer «Por escribir»: ${text(error.message) || 'error desconocido'}`);
    const rows = (data || []) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const contact = maskedContactOf(row);
      if (contact) found.push(contact);
    }
    if (rows.length < PAGE) return found;
  }
}

function errorCode(error: unknown) {
  const value = record(error);
  return text(value.code) || text(value.message) || 'error desconocido';
}

export async function repairMaskedNames(input: {
  client: Client;
  /** Asks the provider; required with apply. */
  match?: MaskedNameMatch;
  apply: boolean;
  /** At most this many provider calls. */
  limit?: number;
  /** Pause between provider calls, to stay under its rate limit. */
  pauseMs?: number;
}): Promise<MaskedRepairReport> {
  if (input.apply && !input.match) throw new Error('Para aplicar hace falta el proveedor.');
  const contacts = await readMaskedContacts(input.client);
  const report: MaskedRepairReport = {
    apply: input.apply,
    before: contacts.length,
    lookups: { byId: 0, byLinkedin: 0, none: 0 },
    rows: [],
    credits: 0,
    after: null,
  };
  const limit = input.limit ?? Number.POSITIVE_INFINITY;
  let asked = 0;
  let stopped: string | null = null;
  for (const contact of contacts) {
    const lookup = lookupOf(contact);
    if (lookup === 'id') report.lookups.byId += 1;
    else if (lookup === 'linkedin') report.lookups.byLinkedin += 1;
    else report.lookups.none += 1;
    const row: MaskedRepairRow = { id: contact.id, maskedName: contact.maskedName, lookup, status: 'would_query' };
    report.rows.push(row);
    if (!lookup) { row.status = 'no_lookup'; continue; }
    if (!input.apply) continue;
    if (stopped || asked >= limit) { row.status = 'skipped'; if (stopped) row.detail = stopped; continue; }
    if (asked > 0 && input.pauseMs) await new Promise(resolve => setTimeout(resolve, input.pauseMs));
    asked += 1;
    try {
      const result = await input.match!({ providerId: contact.providerId, linkedinUrl: contact.linkedinUrl });
      report.credits += Number(result.credits) || 0;
      const person = record(result.person);
      if (!result.found || !Object.keys(person).length) { row.status = 'not_found'; continue; }
      const returnedId = text(person.apollo_id || person.source_provider_id);
      if (contact.providerId && returnedId && returnedId !== contact.providerId) {
        row.status = 'mismatch';
        row.detail = 'El proveedor devolvió a otra persona (otro id).';
        continue;
      }
      if (!fitsMaskedName(person, contact.maskedName)) {
        row.status = 'mismatch';
        row.detail = providerFullName(identityFromProvider(person))
          ? 'El nombre que devolvió no calza con el visible.'
          : 'El proveedor sigue ocultando el apellido.';
        continue;
      }
      const changed = await applyEnrichedIdentity(input.client, {
        userId: contact.userId,
        organizationId: contact.organizationId,
        enrichedLeadId: contact.id,
        savedLeadId: contact.savedLeadId,
        providerId: contact.providerId || returnedId || null,
        identity: identityFromProvider(person),
      });
      row.status = changed.enrichedLead.includes('full_name') ? 'fixed' : 'unchanged';
      const also = [
        changed.enrichedLead.filter(field => field !== 'full_name').map(field => field === 'linkedin_url' ? 'LinkedIn' : 'cargo'),
        changed.savedLead.length ? ['contacto guardado'] : [],
      ].flat();
      if (also.length) row.detail = `También: ${[...new Set(also)].join(', ')}.`;
    } catch (error) {
      const code = errorCode(error);
      row.status = code === 'APOLLO_PERSON_IDENTITY_MISMATCH' ? 'mismatch' : 'error';
      row.detail = code === 'APOLLO_PERSON_IDENTITY_MISMATCH' ? 'El LinkedIn que devolvió es de otra persona.' : code;
      // Without credits every next call fails the same way.
      if (code === 'APOLLO_CREDITS_EXHAUSTED') stopped = 'El proveedor se quedó sin créditos.';
    }
  }
  if (input.apply) report.after = (await readMaskedContacts(input.client)).length;
  return report;
}
