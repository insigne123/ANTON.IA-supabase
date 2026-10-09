import { z } from 'zod';
import type { CoworkEvent, CoworkRun } from './contracts';

const runSchema = z.object({ id: z.string().uuid(), root_run_id: z.string().uuid().nullable().optional(),
  parent_run_id: z.string().uuid().nullable().optional(), message: z.string().max(20000), mode: z.enum(['approval', 'autonomous']),
  status: z.enum(['queued', 'running', 'waiting_workers', 'waiting_approval', 'completed', 'failed', 'cancelled']), created_at: z.string(),
  automatic: z.boolean().optional(), automaticReason: z.literal('research').optional() });
const eventSchema = z.object({ sequence: z.number().int(), kind: z.string().max(100), payload: z.record(z.unknown()), created_at: z.string() });
const turnSchema = z.object({ run: runSchema, events: z.array(eventSchema).max(200) });
export type CoworkHistoryTurnView = { run: CoworkRun; events: CoworkEvent[] };

/** An older page is the ancestry of the oldest visible turn. Never splice a sibling thread/version into the conversation. */
export function coworkEarlierPage(anchor: CoworkHistoryTurnView, raw: unknown) {
  const page = z.object({ run: runSchema, ancestors: z.array(turnSchema).max(8), olderTurnsOmitted: z.boolean() }).parse(raw);
  if (page.run.id !== anchor.run.id || page.run.parent_run_id !== anchor.run.parent_run_id) throw new Error('La conversación cambió al recuperar sus mensajes anteriores.');
  const expectedRoot = anchor.run.root_run_id;
  const chain = [...page.ancestors.map(turn => turn.run), page.run];
  if (new Set(chain.map(run => run.id)).size !== chain.length) throw new Error('La página de mensajes contiene una referencia repetida.');
  for (let index = 0; index < chain.length; index++) {
    const run = chain[index];
    if (expectedRoot && run.root_run_id && expectedRoot !== run.root_run_id) throw new Error('Los mensajes pertenecen a otra conversación.');
    if (index && run.parent_run_id !== chain[index - 1].id) throw new Error('Los mensajes no pertenecen a la misma versión del hilo.');
  }
  if (!page.ancestors.length && page.olderTurnsOmitted) throw new Error('No se pudieron recuperar los mensajes anteriores.');
  return { turns: page.ancestors as CoworkHistoryTurnView[], more: page.olderTurnsOmitted };
}

/** Only retain loaded older context when it ends at the exact incoming branch's first parent. */
export function coworkJoinHistory(older: CoworkHistoryTurnView[], recent: CoworkHistoryTurnView[]): CoworkHistoryTurnView[] {
  if (!older.length || !recent.length) return recent;
  const indices = new Map(older.map((turn, index) => [turn.run.id, index]));
  const overlap = indices.get(recent[0].run.id);
  if (overlap !== undefined && older[overlap].run.parent_run_id !== recent[0].run.parent_run_id) return recent;
  const parent = recent[0].run.parent_run_id ? indices.get(recent[0].run.parent_run_id) : undefined;
  const end = overlap ?? (parent === undefined ? undefined : parent + 1);
  if (end === undefined) return recent;
  return [...older.slice(0, end), ...recent];
}
