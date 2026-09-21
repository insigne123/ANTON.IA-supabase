import { z } from 'zod';
import { coworkReadTaskSchema, executeCoworkParallelReads, type CoworkReadTask } from './parallel-reads';

const taskId = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
export const coworkReadPlanSchema = z.array(z.object({
  id: taskId,
  dependsOn: z.array(taskId).max(2),
  read: coworkReadTaskSchema,
}).strict()).min(1).max(3).superRefine((tasks, context) => {
  const ids = new Set(tasks.map(task => task.id));
  if (ids.size !== tasks.length) context.addIssue({ code: 'custom', message: 'Duplicate task id' });
  if (new Set(tasks.map(task => JSON.stringify(task.read))).size !== tasks.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate planned read' });
  }
  for (const task of tasks) {
    if (new Set(task.dependsOn).size !== task.dependsOn.length
      || task.dependsOn.some(id => !ids.has(id) || id === task.id)) {
      context.addIssue({ code: 'custom', message: 'Invalid dependency' });
    }
  }
  const completed = new Set<string>();
  for (let pass = 0; pass < tasks.length; pass++) {
    for (const task of tasks) {
      if (task.dependsOn.every(id => completed.has(id))) completed.add(task.id);
    }
  }
  if (completed.size !== tasks.length) context.addIssue({ code: 'custom', message: 'Cyclic or unavailable dependency' });
});

export type CoworkReadPlan = z.infer<typeof coworkReadPlanSchema>;

/** Read-only dependency scheduling on the existing durable gateway. All inputs
 * are explicit: dependency outputs never become executable instructions. Each
 * wave settles before dependent tasks start; completed observations remain in
 * the ledger even when another task fails. This is not an LLM specialist pool. */
export async function executeCoworkReadPlan<T>(plan: CoworkReadPlan, options: {
  signal: AbortSignal;
  authorize: () => Promise<void>;
  execute: (read: CoworkReadTask) => Promise<T>;
  record: (task: CoworkReadPlan[number], result: T) => Promise<void>;
}) {
  const tasks = coworkReadPlanSchema.parse(plan);
  const completed = new Map<string, T>();
  while (completed.size < tasks.length) {
    options.signal.throwIfAborted();
    const ready = tasks.filter(task => !completed.has(task.id) && task.dependsOn.every(id => completed.has(id)));
    if (!ready.length) throw new Error('Read plan cannot advance');
    const results = await executeCoworkParallelReads(ready.map(task => task.read), {
      signal: options.signal,
      authorize: options.authorize,
      execute: options.execute,
      record: (read, result) => {
        const task = ready.find(task => task.read.action === read.action && task.read.input === read.input)!;
        return options.record(task, result);
      },
    });
    ready.forEach((task, index) => completed.set(task.id, results[index]));
  }
  return tasks.map(task => ({ task, result: completed.get(task.id)! }));
}
