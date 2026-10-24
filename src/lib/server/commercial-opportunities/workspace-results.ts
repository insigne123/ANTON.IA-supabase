import type { SupabaseClient } from '@supabase/supabase-js';
import { isFinalResult, resultLine, wonByUs, type StoredResult } from '@/lib/commercial-opportunities/close-outcome';
import type { TenderResult } from '@/lib/commercial-opportunities/tenders';
import { getLicitacionResult, isMercadoPublicoBusy } from './mercado-publico';
import { resolveTicketForOrganization } from './tickets';
import { loadTenderProfile } from './tender-profile-read';
import { addOpportunityActivity, opportunityDb } from './workspace-store';
import { notifyPeople } from './workspace-decisions';
import type { OpportunityJob } from './workspace-ai';

/** A tender is asked again once a day at most, and the turn stops asking with time left in the route. */
const CHECK_EVERY_MS = 20 * 3_600_000;
const TURN_MS = 150_000;
/** Two requests with the same ticket at once get code 10500: one at a time, with a pause. */
const PAUSE_MS = 1200;
type Row = Record<string, any>;
type Dependencies = { result?: typeof getLicitacionResult; wait?: (ms: number) => Promise<void>; now?: () => number };

/**
 * After «Presentada», what happened (OPP-29): once a day, each tender the team presented is asked to Mercado Público. Its state and
 * award are kept with the opportunity (data.result); when it is decided (awarded, void or revoked) the activity says so and whoever
 * worked it and the administrators hear it in «Novedades», once. Nothing moves to won or lost by itself: an administrator records it,
 * with the reasons (CloseReasonDialog), from what is shown.
 */
export async function runResultChecks(client: SupabaseClient, job: OpportunityJob, dependencies: Dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const wait = dependencies.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const org = job.organization_id;
  const work = (opportunityDb(await client.from('opportunity_work').select('opportunity_id,responsible_id').eq('organization_id', org).eq('state', 'submitted').limit(200)) || []) as Row[];
  if (!work.length) return { checked: 0, decided: 0 };
  const items = (opportunityDb(await client.from('commercial_opportunities').select('id,title,data').eq('organization_id', org).eq('kind', 'tender')
    .in('id', work.map(row => row.opportunity_id))) || []) as Row[];
  const due = items.filter(item => {
    const result = item.data?.result as StoredResult | undefined;
    return typeof item.data?.observed?.code === 'string' && !isFinalResult(result?.status) && !(Date.parse(result?.checkedAt || '') > now() - CHECK_EVERY_MS);
  });
  if (!due.length) return { checked: 0, decided: 0 };
  const ticket = await resolveTicketForOrganization(client, { organizationId: org, creatorId: job.requested_by });
  if (!ticket) return { checked: 0, decided: 0, ticket: false };
  // The company's RUT, from its tender profile, tells whether a winner is the company itself.
  const rut = (await loadTenderProfile(client, org).catch(() => null))?.rut ?? null;
  const started = now();
  let checked = 0, decided = 0;
  for (const item of due) {
    if (now() - started > TURN_MS) break;
    let result: TenderResult | null;
    try {
      result = await (dependencies.result ?? getLicitacionResult)(item.data.observed.code, { fetch: globalThis.fetch, ticket: ticket.ticket });
    } catch (error) {
      // A busy ticket is asked tomorrow; a spent quota or a refused ticket stops the turn.
      if (isMercadoPublicoBusy(error)) { await wait(PAUSE_MS * 3); continue; }
      break;
    }
    await wait(PAUSE_MS);
    if (!result) continue;
    checked++;
    const before = item.data?.result as StoredResult | undefined;
    // Told before it is kept, and once by its key: a failure leaves it to tomorrow's check, which tells it once more at most.
    if (isFinalResult(result.status) && before?.status !== result.status) {
      try { await announceResult(client, job, item, work.find(row => row.opportunity_id === item.id)?.responsible_id ?? null, result); }
      catch { continue; }
      decided++;
    }
    const stored: StoredResult = { ...result, checkedAt: new Date(now()).toISOString(), ours: wonByUs(result, rut) };
    opportunityDb(await client.from('commercial_opportunities').update({ data: { ...item.data, result: stored } }).eq('organization_id', org).eq('id', item.id));
  }
  return { checked, decided };
}

/** The decided result in the activity, and in «Novedades» of whoever worked the tender and of the administrators, who record it. */
async function announceResult(client: SupabaseClient, job: OpportunityJob, item: Row, responsible: string | null, result: TenderResult) {
  const scope = { organizationId: job.organization_id, userId: job.requested_by };
  const key = `result:${item.id}:${result.status}`;
  const winner = result.winners[0]?.name ?? null;
  await addOpportunityActivity(client, scope, item.id, 'auto_result', `Mercado Público: ${resultLine(result)}`,
    { status: result.status, ...(winner ? { winner } : {}), ...(result.total !== null ? { amount: result.total } : {}) }, key);
  const [participants, admins] = await Promise.all([
    client.from('opportunity_participants').select('user_id').eq('organization_id', job.organization_id).eq('opportunity_id', item.id).limit(100)
      .then(found => (opportunityDb(found) || []) as Row[]),
    client.from('organization_members').select('user_id').eq('organization_id', job.organization_id).in('role', ['owner', 'admin']).limit(200)
      .then(found => (opportunityDb(found) || []) as Row[]),
  ]);
  const headline = result.status === 'adjudicada' ? 'Adjudicada' : result.status === 'desierta' ? 'Declarada desierta' : 'Revocada';
  const title = String(item.title || 'Licitación').replace(/\s+/g, ' ').trim().slice(0, 300);
  // Nobody acted: the one who asked for the search hears it too.
  await notifyPeople(client, { ...scope, userId: '' }, item.id, [responsible, ...participants.map(row => String(row.user_id)), ...admins.map(row => String(row.user_id))],
    `${headline}: ${title}`, key);
}
