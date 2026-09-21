import { z } from 'zod';

export const coworkRequestSchema = z.object({
  requestId: z.string().uuid(),
  message: z.string().trim().min(1).max(20000),
  mode: z.enum(['approval', 'autonomous']).default('approval'),
  parentRunId: z.string().uuid().nullable().optional(),
}).strict();

export type CoworkRunStatus = 'queued' | 'running' | 'waiting_approval' | 'waiting_workers' | 'completed' | 'failed' | 'cancelled';

export type CoworkRun = {
  id: string;
  message: string;
  mode: 'approval' | 'autonomous';
  status: CoworkRunStatus;
  created_at: string;
};

export type CoworkEvent = {
  sequence: number;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export const coworkDocumentSchema = z.object({
  reply: z.string().min(1).max(20000),
  document: z.object({ title: z.string().min(1).max(160), content: z.string().min(1).max(40000) }).nullable(),
}).strict();

const transitions: Record<CoworkRunStatus, readonly CoworkRunStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['waiting_approval', 'waiting_workers', 'completed', 'failed', 'cancelled'],
  waiting_workers: ['queued', 'cancelled'],
  waiting_approval: ['queued', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionCoworkRun(from: CoworkRunStatus, to: CoworkRunStatus) {
  return transitions[from].includes(to);
}
