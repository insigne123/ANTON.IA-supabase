import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { AuthError } from '@/lib/server/auth-utils';
import { discardBody, discardLabel, discardReasonSchema, discardSchema } from '@/lib/commercial-opportunities/list-stages';
import { WORK_STATE_LABELS } from '@/lib/commercial-opportunities/pipeline';
import type { WorkScope } from '@/lib/commercial-opportunities/workspace';
import { assertOpportunityAdmin } from './workspace-access';
import { assignOpportunity, opportunityDb } from './workspace-store';

type Row = Record<string, any>;
/** How many opportunities one action of the list takes at once. */
export const BULK_MAX = 50;
const ids = z.array(z.string().uuid()).min(1).max(BULK_MAX).transform(list => [...new Set(list)]);
/**
 * What the administrator does to the opportunities picked in the list: put them aside with the reason («No es para nosotros»), give them
 * the same team, or move the ones in play to another stage. Won and lost are not on offer here: each one asks for its own reason.
 */
export const bulkSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('discard'), ids, reason: discardReasonSchema, note: z.string().trim().max(300).default('') }).strict(),
  z.object({ op: z.literal('assign'), ids, teamId: z.string().uuid().nullable().default(null), participantIds: z.array(z.string().uuid()).max(50).transform(list => [...new Set(list)]),
    responsibleId: z.string().uuid().nullable().default(null), objective: z.string().trim().max(2000).default(''), dueAt: z.string().datetime({ offset: true }).nullable().default(null) }).strict(),
  z.object({ op: z.literal('state'), ids, state: z.enum(['working', 'submitted', 'archived', 'unassigned']) }).strict(),
]);
export type BulkInput = z.infer<typeof bulkSchema>;

async function readWork(client: SupabaseClient, scope: WorkScope, list: string[]) {
  const rows = (opportunityDb(await client.from('opportunity_work').select('opportunity_id,state,revision').eq('organization_id', scope.organizationId).in('opportunity_id', list)) || []) as Row[];
  return new Map(rows.map(row => [String(row.opportunity_id), { state: String(row.state), revision: Number(row.revision) || 0 }]));
}
async function knownIds(client: SupabaseClient, scope: WorkScope, list: string[]) {
  const rows = (opportunityDb(await client.from('commercial_opportunities').select('id').eq('organization_id', scope.organizationId).in('id', list)) || []) as Row[];
  return rows.map(row => String(row.id));
}
async function addActivity(client: SupabaseClient, scope: WorkScope, lines: Array<{ id: string; kind: string; body: string; data: Record<string, unknown>; key: string }>) {
  if (!lines.length) return;
  opportunityDb(await client.from('opportunity_activity').upsert(lines.map(line => ({ organization_id: scope.organizationId, opportunity_id: line.id, actor_id: scope.userId,
    kind: line.kind, body: line.body, data: line.data, event_key: line.key })), { onConflict: 'organization_id,event_key', ignoreDuplicates: true }));
}

/**
 * «No es para nosotros»: the opportunities nobody works yet go to «Archivadas» with the reason in a word and, if the person wants, a
 * line. The work record keeps them there (a new search updates the opportunity, never its work), and the reason stays in the activity,
 * where the next evaluations read what the team puts aside (workspace-sources.ts). One that a team already works is left alone: its
 * stage moves from the pipeline, with its own reason when it closes.
 */
export async function discardOpportunities(client: SupabaseClient, scope: WorkScope, list: string[], input: { reason: string; note?: string }) {
  assertOpportunityAdmin(scope);
  const parsed = discardSchema.parse({ reason: input.reason, note: input.note ?? '' });
  const known = await knownIds(client, scope, [...new Set(list)].slice(0, BULK_MAX));
  if (!known.length) throw new AuthError('No encontramos esas oportunidades.', 404);
  const work = await readWork(client, scope, known);
  const now = new Date().toISOString();
  const done: Array<{ id: string; revision: number }> = [];
  const fresh = known.filter(id => !work.has(id));
  if (fresh.length) {
    // Inserted only where there is still no record: an assignment that got there first keeps its team.
    const inserted = (opportunityDb(await client.from('opportunity_work').upsert(fresh.map(id => ({ organization_id: scope.organizationId, opportunity_id: id, state: 'archived', revision: 1, updated_at: now })),
      { onConflict: 'opportunity_id', ignoreDuplicates: true }).select('opportunity_id')) || []) as Row[];
    done.push(...inserted.map(row => ({ id: String(row.opportunity_id), revision: 1 })));
  }
  for (const id of known.filter(id => work.get(id)?.state === 'unassigned')) {
    const { revision } = work.get(id)!;
    const saved = opportunityDb(await client.from('opportunity_work').update({ state: 'archived', revision: revision + 1, updated_at: now })
      .eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('revision', revision).eq('state', 'unassigned').select('opportunity_id').maybeSingle());
    if (saved) done.push({ id, revision: revision + 1 });
  }
  const body = discardBody(parsed.reason, parsed.note);
  await addActivity(client, scope, done.map(({ id, revision }) => ({ id, kind: 'discarded', body, data: { reason: parsed.reason, label: discardLabel(parsed.reason), ...(parsed.note ? { note: parsed.note } : {}), to: 'archived' },
    key: `discard:${id}:${revision}` })));
  return { done: done.map(item => item.id), skipped: known.length - done.length };
}

/**
 * The stage of several opportunities in play at once: into preparation, presented, archived, or back to the ones nobody works
 * («Reabrir», for what was put aside by mistake). Each one with its own revision check and its line in the activity; one that changed
 * meanwhile is left as it is and counted as skipped.
 */
export async function moveOpportunities(client: SupabaseClient, scope: WorkScope, list: string[], to: 'working' | 'submitted' | 'archived' | 'unassigned') {
  assertOpportunityAdmin(scope);
  const known = await knownIds(client, scope, [...new Set(list)].slice(0, BULK_MAX));
  const work = await readWork(client, scope, known);
  const now = new Date().toISOString();
  const done: Array<{ id: string; from: string; revision: number }> = [];
  for (const id of known) {
    const current = work.get(id);
    // What nobody works yet is assigned, or put aside with its reason (discardOpportunities), not moved; nor is anything moved to where it is.
    // Reopening is for what was put aside: a team's work does not lose its stage while keeping its team.
    if (!current || current.state === 'unassigned' || current.state === to || (to === 'unassigned' && current.state !== 'archived')) continue;
    const saved = opportunityDb(await client.from('opportunity_work').update({ state: to, revision: current.revision + 1, updated_at: now })
      .eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('revision', current.revision).select('revision').maybeSingle());
    if (saved) done.push({ id, from: current.state, revision: current.revision + 1 });
  }
  await addActivity(client, scope, done.map(({ id, from, revision }) => ({ id, kind: 'state',
    body: to === 'unassigned' ? 'Reabierta: vuelve a las que nadie trabaja todavía.' : `Estado: ${WORK_STATE_LABELS[to].toLowerCase()}`, data: { from, to }, key: `bulk-state:${id}:${revision}` })));
  return { done: done.map(item => item.id), skipped: known.length - done.length };
}

/**
 * The same team for several opportunities: each assignment is the one of the opportunity page (opportunity_assign, with its revision and
 * its notices); one that fails (it changed meanwhile, or it was put aside) is skipped and the others go on.
 */
export async function assignOpportunities(client: SupabaseClient, scope: WorkScope, list: string[], input: { teamId: string | null; participantIds: string[]; responsibleId: string | null; objective: string; dueAt: string | null }) {
  assertOpportunityAdmin(scope);
  if (!input.participantIds.length && !input.teamId) throw new AuthError('Elige a quién asignarlas.', 400);
  if (input.responsibleId && !input.participantIds.includes(input.responsibleId)) throw new AuthError('Incluye al responsable en el equipo de trabajo.', 400);
  const known = await knownIds(client, scope, [...new Set(list)].slice(0, BULK_MAX));
  const work = await readWork(client, scope, known);
  const done: string[] = [];
  for (const id of known) {
    const current = work.get(id);
    // What was closed or put aside is reopened first: assigning it would leave it closed with a team.
    if (current && ['won', 'lost', 'archived'].includes(current.state)) continue;
    try {
      await assignOpportunity(client, scope, id, { expectedRevision: current?.revision ?? 0, teamId: input.teamId, participantIds: input.participantIds,
        responsibleId: input.responsibleId, objective: input.objective, dueAt: input.dueAt });
      done.push(id);
    } catch { /* it changed meanwhile: skipped, and the others go on */ }
  }
  return { done, skipped: known.length - done.length };
}
