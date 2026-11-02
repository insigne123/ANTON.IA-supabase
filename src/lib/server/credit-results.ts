import { classifyReplies } from '@/lib/admin/value';
import { countsAsContacted, isCallOutcome, reachedPerson } from '@/lib/contact-calls';
import { EMPTY_OUTCOMES, WAITING_AFTER_DAYS, addOutcomes, type CreditOutcomes, type CreditResults, type CreditResultsPerson } from '@/lib/credit-results';

/**
 * The reads of «Qué se obtuvo con los créditos» (src/lib/credit-results.ts), with the service client and an explicit
 * organization: the Apollo callbacks say who paid for whom, the saved and searched contacts give their emails and saved
 * ids, and the emails sent, the replies and the calls say what happened next.
 */
type Client = any;

export class CreditResultsError extends Error {
  constructor(message: string, readonly status = 503) { super(message); }
}

const MISSING = new Set(['42P01', 'PGRST205']);
const CHUNK = 200;
const MAX_PAGES = 20;
const text = (value: unknown) => String(value ?? '').trim();
const lower = (value: unknown) => text(value).toLowerCase();

async function pages(build: () => any) {
  const rows: any[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await build().range(page * 1000, page * 1000 + 999);
    if (result.error) throw new CreditResultsError('No pudimos leer los créditos usados.');
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) return rows;
  }
  return rows;
}

/** Rows whose column is in the values, a chunk at a time; a missing table answers nothing. */
async function inChunks(values: string[], query: (chunk: string[]) => any) {
  const rows: any[] = [];
  const unique = [...new Set(values.filter(Boolean))];
  for (let start = 0; start < unique.length; start += CHUNK) {
    const result = await query(unique.slice(start, start + CHUNK));
    if (result.error) {
      if (MISSING.has(String(result.error.code || ''))) return rows;
      throw new CreditResultsError('No pudimos leer qué pasó con los contactos.');
    }
    rows.push(...(result.data || []));
  }
  return rows;
}

type Person = {
  key: string;
  payer: string;
  paidAt: number;
  phone: boolean;
  enrichedIds: Set<string>;
  searchIds: Set<string>;
  providerId: string | null;
  emails: Set<string>;
  contacted: boolean;
  conversation: boolean;
  meeting: boolean;
};

/**
 * What the credits of the range got, by whoever paid. `userIds` narrows it to some people (a team or one person). The
 * outcomes are read up to now, however long after the payment they came.
 */
export async function readCreditResults(client: Client, input: {
  organizationId: string;
  from: string;
  to: string;
  userIds?: string[] | null;
  now?: Date;
}): Promise<CreditResults> {
  const now = input.now ?? new Date();
  const callbacks = await pages(() => {
    let query = client.from('apollo_enrichment_callbacks')
      .select('id,user_id,target_table,target_lead_id,apollo_person_id,reveal_email,reveal_phone,terminal_state,created_at')
      .eq('organization_id', input.organizationId).gte('created_at', input.from).lt('created_at', input.to);
    if (input.userIds) query = query.in('user_id', input.userIds);
    return query.order('id');
  });

  const credits = new Map<string, number>();
  const people = new Map<string, Person>();
  for (const row of callbacks) {
    const state = text(row.terminal_state);
    if (state && state !== 'succeeded') continue;
    const payer = text(row.user_id);
    const cost = (row.reveal_email ? 1 : 0) + (row.reveal_phone ? 8 : 0);
    credits.set(payer, (credits.get(payer) || 0) + cost);
    const table = text(row.target_table);
    const target = text(row.target_lead_id);
    const providerId = text(row.apollo_person_id) || null;
    const key = providerId || `${table}:${target}`;
    const paidAt = Date.parse(String(row.created_at));
    let person = people.get(key);
    if (!person) {
      person = { key, payer, paidAt, phone: false, enrichedIds: new Set(), searchIds: new Set(), providerId, emails: new Set(), contacted: false, conversation: false, meeting: false };
      people.set(key, person);
    }
    if (paidAt < person.paidAt) { person.paidAt = paidAt; person.payer = payer; }
    if (row.reveal_phone) person.phone = true;
    if (table === 'enriched_leads' && target) person.enrichedIds.add(target);
    if (table === 'people_search_leads' && target) person.searchIds.add(target);
  }

  const all = [...people.values()];
  const byProvider = new Map(all.filter(person => person.providerId).map(person => [person.providerId as string, person]));
  const byEnriched = new Map<string, Person>();
  const remember = (person: Person, id: string, email: unknown) => {
    if (id) { person.enrichedIds.add(id); byEnriched.set(id, person); }
    const address = lower(email);
    if (address && address.includes('@')) person.emails.add(address);
  };
  for (const person of all) for (const id of person.enrichedIds) byEnriched.set(id, person);

  // Who they are: the saved contact and the search result keep the email; a saved copy of a searched person is found
  // by the provider's person id.
  const enrichedTargets = await inChunks(all.flatMap(person => [...person.enrichedIds]), chunk =>
    client.from('enriched_leads').select('id,email,source_provider_id').eq('organization_id', input.organizationId).in('id', chunk));
  for (const row of enrichedTargets) { const person = byEnriched.get(text(row.id)); if (person) remember(person, text(row.id), row.email); }
  const searchTargets = await inChunks(all.flatMap(person => [...person.searchIds]), chunk =>
    client.from('people_search_leads').select('id,email,source_provider_id').eq('organization_id', input.organizationId).in('id', chunk));
  const bySearch = new Map<string, Person>();
  for (const person of all) for (const id of person.searchIds) bySearch.set(id, person);
  for (const row of searchTargets) {
    const person = bySearch.get(text(row.id));
    const address = lower(row.email);
    if (person && address.includes('@')) person.emails.add(address);
  }
  const savedCopies = await inChunks([...byProvider.keys()], chunk =>
    client.from('enriched_leads').select('id,email,source_provider_id').eq('organization_id', input.organizationId).in('source_provider_id', chunk));
  for (const row of savedCopies) { const person = byProvider.get(text(row.source_provider_id)); if (person) remember(person, text(row.id), row.email); }

  // What happened next: emails sent and their replies, and calls or WhatsApps with a result.
  const byEmail = new Map<string, Person>();
  for (const person of all) for (const address of person.emails) byEmail.set(address, person);
  const sent = await inChunks([...byEmail.keys()], chunk =>
    client.from('contacted_leads').select('email,sent_at,replied_at,reply_intent').eq('organization_id', input.organizationId).in('email', chunk));
  for (const row of sent) {
    const person = byEmail.get(lower(row.email));
    if (!person) continue;
    if (row.sent_at) person.contacted = true;
    if (row.replied_at) {
      const reply = classifyReplies([{ reply_intent: row.reply_intent }]);
      if (reply.real) { person.contacted = true; person.conversation = true; }
      if (reply.meeting) person.meeting = true;
    }
  }
  const markCall = (person: Person | undefined, outcome: unknown) => {
    if (!person || !isCallOutcome(outcome)) return;
    if (countsAsContacted(outcome)) person.contacted = true;
    if (reachedPerson(outcome)) person.conversation = true;
    if (outcome === 'meeting') person.meeting = true;
  };
  const callsByLead = await inChunks([...byEnriched.keys()], chunk =>
    client.from('contact_calls').select('lead_id,outcome').eq('organization_id', input.organizationId).not('outcome', 'is', null).in('lead_id', chunk));
  for (const row of callsByLead) markCall(byEnriched.get(text(row.lead_id)), row.outcome);
  const callsByProvider = await inChunks([...byProvider.keys()], chunk =>
    client.from('contact_calls').select('provider_person_id,outcome').eq('organization_id', input.organizationId).not('outcome', 'is', null).in('provider_person_id', chunk));
  for (const row of callsByProvider) markCall(byProvider.get(text(row.provider_person_id)), row.outcome);

  const waitingSince = now.getTime() - WAITING_AFTER_DAYS * 86_400_000;
  const perPerson = new Map<string, CreditOutcomes>();
  for (const [userId, used] of credits) perPerson.set(userId, { ...EMPTY_OUTCOMES, credits: used });
  for (const person of all) {
    const current = perPerson.get(person.payer) || { ...EMPTY_OUTCOMES };
    perPerson.set(person.payer, addOutcomes(current, {
      credits: 0,
      paid: 1,
      withPhone: person.phone ? 1 : 0,
      contacted: person.contacted ? 1 : 0,
      conversations: person.conversation ? 1 : 0,
      meetings: person.meeting ? 1 : 0,
      waiting: !person.contacted && person.paidAt <= waitingSince ? 1 : 0,
    }));
  }
  const rows: CreditResultsPerson[] = [...perPerson.entries()]
    .map(([userId, outcomes]) => ({ userId, ...outcomes }))
    .sort((a, b) => b.credits - a.credits || b.paid - a.paid || a.userId.localeCompare(b.userId));
  return { totals: rows.reduce((sum, row) => addOutcomes(sum, row), { ...EMPTY_OUTCOMES }), people: rows };
}
