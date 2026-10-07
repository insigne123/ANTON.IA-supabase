import type { SupabaseClient } from '@supabase/supabase-js';
import { hasConfirmedEmail, isOpportunitiesUserAllowed, type OpportunitiesIdentity } from '@/lib/commercial-opportunities/access';
import { opportunitiesGrantedUserIds } from './grants';
import { decryptStoredToken, encryptStoredToken } from '@/lib/server/token-crypto';
import { MERCADO_PUBLICO_BASE } from './mercado-publico';

/**
 * The Mercado Público ticket of each person (Plan 10). Licitaciones and Compra Ágil read the public API with a free personal
 * ticket, kept encrypted (token-crypto, enc:v1) in commercial_opportunity_tickets, which only the server reads. The global
 * MERCADO_PUBLICO_TICKET of Secret Manager is left for the confirmed accounts in MERCADO_PUBLICO_SHARED_TICKET_EMAILS.
 * A ticket never goes back to the browser, nor into a message or a log: the page only gets its last four characters.
 */
export type TicketStatus = { connected: boolean; hint: string | null; verifiedAt: string | null; lastError: string | null; shared: boolean };
export type TicketSource = 'own' | 'shared';
export type TicketUser = OpportunitiesIdentity & { id: string };
/** MERCADO_PUBLICO_TICKET, MERCADO_PUBLICO_SHARED_TICKET_EMAILS and OPPORTUNITIES_ALLOWED_EMAILS; process.env by default. */
type TicketEnv = Record<string, string | undefined>;
type TicketRow = { user_id: string; ticket_encrypted: string; ticket_hint: string | null; verified_at: string | null; last_error: string | null };

const TABLE = 'commercial_opportunity_tickets';
const COLUMNS = 'user_id,ticket_encrypted,ticket_hint,verified_at,last_error';
const TICKET = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
export const TICKET_REJECTED = 'Mercado Público rechazó este ticket. Reemplázalo por uno vigente.';
export const TICKET_UNREADABLE = 'No pudimos leer tu ticket guardado. Vuelve a pegarlo.';
export const NO_ORGANIZATION_TICKET = 'Nadie de la organización ha conectado su ticket de Mercado Público.';

function fail(what: string, error: { code?: string; message?: string } | null): never {
  // The code only: these queries never carry the ticket, but the log stays minimal anyway.
  console.error(`[commercial-opportunities] ticket ${what} failed:`, error?.code || 'unknown');
  throw new Error(`No se pudo ${what} el ticket de Mercado Público.`);
}

/** A Mercado Público ticket is a GUID: 36 characters with hyphens. Spaces are dropped and letters go upper case. */
export function normalizeTicket(value: unknown) {
  const ticket = typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : '';
  return TICKET.test(ticket) ? ticket : null;
}
export const ticketHint = (ticket: string) => ticket.replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase();

/** The global ticket, only for the confirmed accounts on MERCADO_PUBLICO_SHARED_TICKET_EMAILS. */
export function sharedTicketFor(user: OpportunitiesIdentity | null | undefined, env: TicketEnv = process.env) {
  const ticket = env.MERCADO_PUBLICO_TICKET?.trim();
  return ticket && isOpportunitiesUserAllowed(user, env.MERCADO_PUBLICO_SHARED_TICKET_EMAILS) ? ticket : undefined;
}

async function readRow(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from(TABLE).select(COLUMNS).eq('user_id', userId).maybeSingle();
  if (error) fail('leer', error);
  return (data as TicketRow | null) ?? null;
}

/** The ticket a person searches with: their own; else the shared one when they are on its list; else none. */
export async function resolveTicketForUser(client: SupabaseClient, user: TicketUser, env: TicketEnv = process.env) {
  const row = await readRow(client, user.id);
  const own = row ? decryptStoredToken(row.ticket_encrypted) : null;
  const shared = own ? undefined : sharedTicketFor(user, env);
  const status: TicketStatus = {
    connected: Boolean(own), hint: row?.ticket_hint ?? null, verifiedAt: row?.verified_at ?? null,
    lastError: row && !own ? TICKET_UNREADABLE : row?.last_error ?? null, shared: Boolean(shared),
  };
  const source: TicketSource | null = own ? 'own' : shared ? 'shared' : null;
  return { ticket: own || shared, source, status };
}

/**
 * The ticket of an organization's daily search: the own ticket of whoever created «Qué buscamos»; else the most recently
 * verified own ticket of another member who may open «Oportunidades»; else the shared ticket, only when the creator is on
 * its list. A ticket Mercado Público already rejected is skipped. Null when nobody has one.
 */
export async function resolveTicketForOrganization(client: SupabaseClient, input: { organizationId: string; creatorId: string; env?: TicketEnv }) {
  const env = input.env ?? process.env;
  const members = await client.from('organization_members').select('user_id').eq('organization_id', input.organizationId);
  if (members.error) fail('buscar', members.error);
  const memberIds = [...new Set(((members.data || []) as Array<{ user_id: string }>).map(member => member.user_id).filter(Boolean))];
  const userOf = async (userId: string) => {
    const { data, error } = await client.auth.admin.getUserById(userId);
    return error ? null : data?.user ?? null;
  };
  if (memberIds.length) {
    // The members an admin let in (Plan 15) count as those of the list.
    const granted = await opportunitiesGrantedUserIds(client, input.organizationId);
    const tickets = await client.from(TABLE).select(COLUMNS).in('user_id', memberIds);
    if (tickets.error) fail('buscar', tickets.error);
    const candidates = ((tickets.data || []) as TicketRow[])
      .filter(row => !row.last_error)
      .sort((a, b) => Number(b.user_id === input.creatorId) - Number(a.user_id === input.creatorId)
        || Date.parse(b.verified_at || '') - Date.parse(a.verified_at || '') || 0);
    for (const row of candidates) {
      const ticket = decryptStoredToken(row.ticket_encrypted);
      const owner = ticket ? await userOf(row.user_id) : null;
      if (ticket && (isOpportunitiesUserAllowed(owner, env.OPPORTUNITIES_ALLOWED_EMAILS) || (granted.has(row.user_id) && hasConfirmedEmail(owner)))) {
        return { ticket, userId: row.user_id, source: 'own' as const };
      }
    }
  }
  const shared = sharedTicketFor(await userOf(input.creatorId), env);
  return shared ? { ticket: shared, userId: input.creatorId, source: 'shared' as const } : null;
}

export type TicketCheck = 'valid' | 'busy' | 'invalid' | 'unavailable';
/** A well-formed tender code that does not exist: a working ticket gets an empty listing (94 bytes), the lightest request. */
const PROBE_CODE = '1000-1-L126';
/**
 * Whether a ticket works, before saving it. Measured on 5 Oct 2026: an unknown ticket answers HTTP 203 with code 203
 * («Ticket no válido»), and a ticket busy with another request answers 429 with code 10500, which only a real ticket gets.
 */
export async function checkMercadoPublicoTicket(ticket: string, dependencies: { fetch: typeof fetch } = { fetch: globalThis.fetch }): Promise<TicketCheck> {
  try {
    const response = await dependencies.fetch(`${MERCADO_PUBLICO_BASE}?${new URLSearchParams({ codigo: PROBE_CODE, ticket })}`, {
      headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json().catch(() => null) as { Listado?: unknown; Codigo?: number | string } | null;
    const code = Number(body?.Codigo);
    if (code === 10500 || response.status === 429) return 'busy';
    if (response.status === 401 || response.status === 403 || code === 203) return 'invalid';
    return response.ok && Array.isArray(body?.Listado) ? 'valid' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export async function saveTicket(client: SupabaseClient, userId: string, ticket: string, now = new Date().toISOString()) {
  const { error } = await client.from(TABLE).upsert({
    user_id: userId, ticket_encrypted: encryptStoredToken(ticket), ticket_hint: ticketHint(ticket), verified_at: now, last_error: null, updated_at: now,
  }, { onConflict: 'user_id' });
  if (error) fail('guardar', error);
}

export async function deleteTicket(client: SupabaseClient, userId: string) {
  const { error } = await client.from(TABLE).delete().eq('user_id', userId);
  if (error) fail('quitar', error);
}

/** Whether a tender search ended with Mercado Público or Compra Ágil refusing the ticket. */
export const ticketWasRejected = (result: { sources: Array<{ error: string | null }> }) =>
  result.sources.some(source => /rechazó el ticket/i.test(source.error || ''));

/** A ticket Mercado Público refused: the page asks to replace it and the daily search stops using it. */
export async function markTicketRejected(client: SupabaseClient, userId: string, now = new Date().toISOString()) {
  const { error } = await client.from(TABLE).update({ last_error: TICKET_REJECTED, updated_at: now }).eq('user_id', userId);
  if (error) fail('marcar', error);
}
