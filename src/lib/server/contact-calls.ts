import { syncLeadAutopilotToCrm } from '@/lib/server/crm-autopilot';
import {
  PENDING_CALL_MAX_AGE_MS, countsAsContacted, dialable, isCallChannel, isCallId, isCallOutcome, needsCall,
  type CallChannel, type CallOutcome, type LastCall,
} from '@/lib/contact-calls';

/**
 * The reads and writes of «Llamar» y «WhatsApp» (src/lib/contact-calls.ts), with the service client and an explicit
 * organization and person: contact_calls has no client policies.
 */
type Client = any;
export type CallScope = { organizationId: string; userId: string };

export class ContactCallError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** The table may not exist yet in an old database: readers then answer as if nobody had called. */
const MISSING = new Set(['42P01', 'PGRST205']);
const missing = (error: any) => Boolean(error && MISSING.has(String(error.code || '')));
const text = (value: unknown, max: number) => {
  const out = String(value ?? '').trim().slice(0, max);
  return out || null;
};

export type StartCallInput = {
  id: string;
  channel: CallChannel;
  leadId?: string | null;
  providerPersonId?: string | null;
  name?: string | null;
  company?: string | null;
  email?: string | null;
};

type LeadSnapshot = { id: string; full_name: string | null; company_name: string | null; email: string | null };

/** The saved contact the call is about: by its id, or by the provider's person id when it starts from a search result. */
async function findLead(client: Client, organizationId: string, leadId: string | null, providerId: string | null): Promise<LeadSnapshot | null> {
  if (leadId) {
    const found = await client.from('enriched_leads').select('id,full_name,company_name,email')
      .eq('id', leadId).eq('organization_id', organizationId).maybeSingle();
    if (found.error) throw new ContactCallError('No pudimos registrar la llamada.', 503);
    if (found.data) return found.data as LeadSnapshot;
  }
  if (providerId) {
    const found = await client.from('enriched_leads').select('id,full_name,company_name,email')
      .eq('organization_id', organizationId).eq('source_provider_id', providerId)
      .order('created_at', { ascending: false }).limit(1);
    if (found.error) throw new ContactCallError('No pudimos registrar la llamada.', 503);
    return (found.data?.[0] as LeadSnapshot | undefined) || null;
  }
  return null;
}

/**
 * Records a call or WhatsApp the person just started. The page mints the id, so a retried request writes it once; the
 * contact's name, company and email come from the saved contact when there is one, never from the request alone.
 */
export async function startContactCall(client: Client, scope: CallScope, input: StartCallInput, now: Date = new Date()) {
  if (!isCallId(input.id)) throw new ContactCallError('La llamada no tiene un identificador válido.', 400);
  if (!isCallChannel(input.channel)) throw new ContactCallError('Elige llamar o escribir por WhatsApp.', 400);
  const providerId = text(input.providerPersonId, 120);
  const lead = await findLead(client, scope.organizationId, text(input.leadId, 120), providerId);
  const at = now.toISOString();
  const row = {
    id: input.id,
    organization_id: scope.organizationId,
    user_id: scope.userId,
    lead_id: lead?.id ?? null,
    provider_person_id: providerId,
    contact_name: text(lead?.full_name ?? input.name, 200),
    contact_company: text(lead?.company_name ?? input.company, 200),
    contact_email: text(lead?.email ?? input.email, 320)?.toLowerCase() ?? null,
    channel: input.channel,
    started_at: at,
    created_at: at,
    updated_at: at,
  };
  const saved = await client.from('contact_calls').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
  if (saved.error) {
    throw new ContactCallError(missing(saved.error) ? 'Registrar llamadas aún no está disponible.' : 'No pudimos registrar la llamada.', 503);
  }
  return { id: input.id, leadId: row.lead_id };
}

type OutcomeDeps = { syncCrm?: typeof syncLeadAutopilotToCrm };

/**
 * The result of one of the person's own calls. «Agendó reunión» on a saved contact leaves it in the pipeline with the
 * meeting suggested, as a recorded call does (touch-calls.ts): events never move the stage by themselves.
 */
export async function recordCallOutcome(
  client: Client,
  scope: CallScope,
  id: string,
  input: { outcome: CallOutcome; note?: string | null },
  deps: OutcomeDeps = {},
  now: Date = new Date(),
) {
  if (!isCallId(id)) throw new ContactCallError('No encontramos esa llamada.', 404);
  if (!isCallOutcome(input.outcome)) throw new ContactCallError('Elige cómo te fue.', 400);
  const at = now.toISOString();
  const updated = await client.from('contact_calls')
    .update({ outcome: input.outcome, note: text(input.note, 1000), outcome_at: at, updated_at: at })
    .eq('id', id).eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .select('id,lead_id,channel');
  if (updated.error) throw new ContactCallError('No pudimos guardar el resultado.', 503);
  // PostgREST answers the updated rows: none means it is not this person's call.
  const row = Array.isArray(updated.data) ? updated.data[0] : updated.data;
  if (!row) throw new ContactCallError('No encontramos esa llamada.', 404);
  let pipeline = false;
  const leadId = text(row.lead_id, 120);
  if (input.outcome === 'meeting' && leadId) {
    pipeline = await (deps.syncCrm ?? syncLeadAutopilotToCrm)(client, {
      organizationId: scope.organizationId,
      leadId,
      stage: 'meeting',
      lastAutopilotEvent: 'call_meeting',
      nextAction: 'Preparar la reunión',
      nextActionType: 'meeting',
    }).then(() => true, () => false);
  }
  return { id, outcome: input.outcome, pipeline };
}

export type PendingCallRow = { id: string; channel: CallChannel; name: string; company: string | null; leadId: string | null; startedAt: string };

/** The person's calls of the last three days still without a result, newest first: «Hoy» asks for them. */
export async function readPendingCalls(client: Client, scope: CallScope, now: Date = new Date()): Promise<PendingCallRow[]> {
  const since = new Date(now.getTime() - PENDING_CALL_MAX_AGE_MS).toISOString();
  const result = await client.from('contact_calls').select('id,channel,contact_name,contact_company,lead_id,started_at')
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).is('outcome', null)
    .gte('started_at', since).order('started_at', { ascending: false }).limit(10);
  if (result.error) {
    if (missing(result.error)) return [];
    throw new ContactCallError('No pudimos leer tus llamadas.', 503);
  }
  return (result.data || []).map((row: any) => ({
    id: String(row.id),
    channel: isCallChannel(row.channel) ? row.channel : 'call',
    name: String(row.contact_name || ''),
    company: row.contact_company ? String(row.contact_company) : null,
    leadId: row.lead_id ? String(row.lead_id) : null,
    startedAt: String(row.started_at),
  }));
}

/** The last call of each contact in the organization, whoever made it: «Por escribir» shows it and «Por llamar» uses it. */
export async function readLastCalls(client: Client, organizationId: string, leadIds: string[]): Promise<Map<string, LastCall>> {
  const ids = [...new Set(leadIds.map(id => String(id || '').trim()).filter(Boolean))];
  const last = new Map<string, LastCall>();
  for (let start = 0; start < ids.length; start += 200) {
    const result = await client.from('contact_calls').select('lead_id,channel,outcome,started_at,outcome_at')
      .eq('organization_id', organizationId).in('lead_id', ids.slice(start, start + 200))
      .order('started_at', { ascending: false }).limit(1000);
    if (result.error) {
      if (missing(result.error)) return last;
      throw new ContactCallError('No pudimos leer las llamadas.', 503);
    }
    for (const row of result.data || []) {
      const leadId = String(row.lead_id || '');
      if (!leadId || last.has(leadId)) continue;
      last.set(leadId, {
        outcome: isCallOutcome(row.outcome) ? row.outcome : null,
        channel: isCallChannel(row.channel) ? row.channel : 'call',
        at: String(row.outcome_at || row.started_at),
      });
    }
  }
  return last;
}

const hasPhone = (row: { primary_phone?: unknown; phone_numbers?: unknown }) => {
  if (dialable(String(row.primary_phone || ''))) return true;
  const numbers = Array.isArray(row.phone_numbers) ? row.phone_numbers : [];
  return numbers.some((entry: any) => dialable(String(entry?.sanitized_number || entry?.raw_number || entry?.number || '')));
};

const SCAN_LIMIT = 1000;

/** For «Hoy»: the calls still without a result, and how many of the person's contacts have a mobile and wait for a call. */
export async function readCallsToday(client: Client, scope: CallScope, now: Date = new Date()) {
  const [pending, leads] = await Promise.all([
    readPendingCalls(client, scope, now),
    client.from('enriched_leads').select('id,primary_phone,phone_numbers')
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).limit(SCAN_LIMIT),
  ]);
  if (leads.error) throw new ContactCallError('No pudimos leer tus contactos.', 503);
  const withPhone: string[] = (leads.data || []).filter(hasPhone).map((row: any) => String(row.id));
  const last = await readLastCalls(client, scope.organizationId, withPhone);
  const toCall = withPhone.filter(id => needsCall(true, last.get(id))).length;
  return { pending, toCall, partial: (leads.data || []).length >= SCAN_LIMIT };
}

/**
 * For the morning alert (src/lib/daily-alerts.ts): the person's contacts with a mobile still to call, by the rule of «Por llamar»,
 * how many of them were saved since the last alert and the names of the newest two.
 */
export async function readPeopleToCall(client: Client, scope: CallScope, since: string) {
  const leads = await client.from('enriched_leads').select('id,full_name,primary_phone,phone_numbers,created_at')
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).order('created_at', { ascending: false }).limit(SCAN_LIMIT);
  if (leads.error) throw new ContactCallError('No pudimos leer tus contactos.', 503);
  const withPhone = ((leads.data || []) as any[]).filter(hasPhone);
  const last = await readLastCalls(client, scope.organizationId, withPhone.map(row => String(row.id)));
  const people = withPhone.filter(row => needsCall(true, last.get(String(row.id))))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const sinceTime = Date.parse(since);
  return {
    count: people.length,
    fresh: people.filter(row => Date.parse(String(row.created_at || '')) >= sinceTime).length,
    names: people.slice(0, 2).map(row => String(row.full_name || '').trim() || 'un contacto'),
  };
}

/**
 * People contacted by phone or WhatsApp in the range, for the week's goal: one key per person (their email when the
 * contact had one, so a person written to and called counts once), every result but a wrong number.
 */
export type CallContactRow = { userId: string; key: string; channel: CallChannel; outcome: CallOutcome };

export async function readCallContacts(client: Client, organizationId: string, range: { from: string; to: string }, userId?: string): Promise<CallContactRow[]> {
  let query = client.from('contact_calls').select('id,user_id,lead_id,contact_email,outcome,channel')
    .eq('organization_id', organizationId).not('outcome', 'is', null)
    .gte('outcome_at', range.from).lt('outcome_at', range.to);
  if (userId) query = query.eq('user_id', userId);
  const result = await query.limit(5000);
  if (result.error) return [];
  return (result.data || []).flatMap((row: any): CallContactRow[] => {
    if (!isCallOutcome(row.outcome) || !countsAsContacted(row.outcome)) return [];
    const email = String(row.contact_email || '').trim().toLowerCase();
    const key = email || (row.lead_id ? `lead:${row.lead_id}` : `call:${row.id}`);
    return [{ userId: String(row.user_id), key, channel: isCallChannel(row.channel) ? row.channel : 'call', outcome: row.outcome as CallOutcome }];
  });
}
