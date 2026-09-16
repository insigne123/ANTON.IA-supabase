import { z } from 'zod';

export const coworkReadTaskSchema = z.object({
  action: z.enum(['leads.search', 'leads.get', 'research.get_existing']),
  input: z.string().max(120),
}).strict().superRefine((task, context) => {
  if (task.action !== 'leads.search' && !z.string().uuid().safeParse(task.input).success) {
    context.addIssue({ code: 'custom', path: ['input'], message: 'A saved contact UUID is required' });
  }
});
export type CoworkReadTask = z.infer<typeof coworkReadTaskSchema>;

/** Bounded fan-out only for independent reads; no write or provider operation accepted. */
export async function executeCoworkParallelReads<T>(tasks: CoworkReadTask[], options: {
  signal: AbortSignal;
  authorize: () => Promise<void>;
  execute: (task: CoworkReadTask) => Promise<T>;
  record: (task: CoworkReadTask, result: T) => Promise<void>;
}) {
  const validated = z.array(coworkReadTaskSchema).min(1).max(3).parse(tasks);
  const unique = new Set(validated.map(task => JSON.stringify(task)));
  if (unique.size !== validated.length) throw new Error('Duplicate parallel read');
  const results = new Array<T>(validated.length);
  let index = 0;
  let failure: unknown;
  let failed = false;
  async function consume() {
    while (!failed && index < validated.length) {
      const position = index++;
      try {
        options.signal.throwIfAborted();
        await options.authorize();
        options.signal.throwIfAborted();
        if (failed) return;
        const result = await options.execute(validated[position]);
        options.signal.throwIfAborted();
        await options.authorize();
        options.signal.throwIfAborted();
        await options.record(validated[position], result);
        results[position] = result;
      } catch (error) { if (!failed) failure = error; failed = true; }
    }
  }
  // Await every active reader before returning or failing, avoiding orphan promises.
  await Promise.all(Array.from({ length: Math.min(2, validated.length) }, consume));
  if (failed) throw failure;
  return results;
}
