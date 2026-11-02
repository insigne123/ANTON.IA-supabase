import { classifyReplies } from '@/lib/admin/value';
import { countsAsContacted, isCallOutcome, reachedPerson } from '@/lib/contact-calls';
import { EMPTY_FUNNEL, addFunnels, type TeamFunnel, type WorkFunnel } from '@/lib/team-funnel';

/**
 * The reads of «El trabajo, paso a paso» (src/lib/team-funnel.ts), with the service client and an explicit organization
 * and people: the same counts as each person's «Tu semana» (server/weekly-report.ts), for a period and a team, plus the
 * calls and WhatsApps with a result (contact_calls).
 */
type Client = any;

export class TeamFunnelError extends Error {
  constructor(message: string, readonly status = 503) { super(message); }
}

const MISSING = new Set(['42P01', 'PGRST205']);
const MAX_PAGES = 20;
const text = (value: unknown) => String(value ?? '').trim();
const lower = (value: unknown) => text(value).toLowerCase();

/** Every page of a query, up to 20 000 rows; an optional table that does not exist yet answers nothing. */
async function pages(build: () => any, optional = false) {
  const rows: any[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await build().range(page * 1000, page * 1000 + 999);
    if (result.error) {
      if (optional && MISSING.has(String(result.error.code || ''))) return rows;
      throw new TeamFunnelError('No pudimos leer el trabajo del equipo.');
    }
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) return rows;
  }
  return rows;
}

type Counts = Omit<WorkFunnel, 'contacted' | 'conversations'> & { contacted: Set<string>; conversations: Set<string> };

/**
 * The period's steps for each of the people, everyone listed even with nothing done (so an administrator sees who did not
 * start), the busiest first. A person reached by email and by phone counts once when the call kept their email.
 */
export async function readTeamFunnel(client: Client, input: { organizationId: string; from: string; to: string; userIds: string[] }): Promise<TeamFunnel> {
  const ids = [...new Set(input.userIds.map(text).filter(Boolean))];
  if (!ids.length) return { total: { ...EMPTY_FUNNEL }, people: [] };
  const scoped = (table: string, columns: string, column: string) => client.from(table).select(columns)
    .eq('organization_id', input.organizationId).in('user_id', ids).gte(column, input.from).lt(column, input.to);
  const [saved, withEmail, researched, drafts, sent, replies, calls] = await Promise.all([
    pages(() => scoped('leads', 'id,user_id', 'created_at').order('id')),
    pages(() => scoped('enriched_leads', 'id,user_id', 'created_at').not('email', 'is', null).neq('email', '').order('id')),
    pages(() => scoped('lead_research_jobs', 'id,user_id', 'completed_at').in('status', ['completed', 'partial']).order('id')),
    pages(() => scoped('messaging_drafts', 'id,user_id', 'created_at').order('id')),
    // Only the recipient's address leaves the dispatch: its metadata also keeps the message.
    pages(() => scoped('outbound_dispatches', 'id,user_id,recipient:metadata->recipient->>email', 'completed_at').eq('status', 'sent').eq('channel', 'email').order('id')),
    pages(() => scoped('contacted_leads', 'id,user_id,email,reply_intent', 'replied_at').order('id')),
    // «Llamar» y «WhatsApp» (U1): before its migration the table is missing, and only the emails count.
    pages(() => scoped('contact_calls', 'id,user_id,lead_id,provider_person_id,contact_email,outcome', 'outcome_at').not('outcome', 'is', null).order('id'), true),
  ]);

  const counts = new Map<string, Counts>(ids.map(id => [id, { saved: 0, withEmail: 0, researched: 0, drafts: 0, contacted: new Set(), conversations: new Set() }]));
  const of = (row: any) => counts.get(text(row.user_id));
  for (const row of saved) { const person = of(row); if (person) person.saved += 1; }
  for (const row of withEmail) { const person = of(row); if (person) person.withEmail += 1; }
  for (const row of researched) { const person = of(row); if (person) person.researched += 1; }
  for (const row of drafts) { const person = of(row); if (person) person.drafts += 1; }
  // The people written to, once each by address (as «Tu semana» counts them).
  for (const row of sent) {
    const address = lower(row.recipient);
    if (address) of(row)?.contacted.add(`email:${address}`);
  }
  // A person who answered: not an auto-reply nor a bounce.
  for (const row of replies) {
    if (!classifyReplies([{ reply_intent: row.reply_intent }]).real) continue;
    of(row)?.conversations.add(lower(row.email) ? `email:${lower(row.email)}` : `reply:${text(row.id)}`);
  }
  for (const row of calls) {
    if (!isCallOutcome(row.outcome)) continue;
    const person = of(row);
    if (!person) continue;
    const key = lower(row.contact_email) ? `email:${lower(row.contact_email)}`
      : text(row.lead_id) ? `lead:${text(row.lead_id)}`
        : text(row.provider_person_id) ? `person:${text(row.provider_person_id)}` : `call:${text(row.id)}`;
    if (countsAsContacted(row.outcome)) person.contacted.add(key);
    if (reachedPerson(row.outcome)) person.conversations.add(key);
  }

  const people = ids.map(userId => {
    const found = counts.get(userId)!;
    return { userId, funnel: { ...found, contacted: found.contacted.size, conversations: found.conversations.size } };
  }).sort((a, b) => b.funnel.contacted - a.funnel.contacted || b.funnel.saved - a.funnel.saved || a.userId.localeCompare(b.userId));
  return { total: people.reduce((sum, person) => addFunnels(sum, person.funnel), { ...EMPTY_FUNNEL }), people };
}
