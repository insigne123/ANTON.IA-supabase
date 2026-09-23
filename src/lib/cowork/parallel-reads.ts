import { z } from 'zod';
import { COWORK_DOMAIN_FIXED_READS, COWORK_DOMAIN_ENTITY_READS } from './domain-reads';

const TEXT_ACTIONS = ['leads.search', 'crm.search', 'contacted.search', 'deliverability.check'];
const UUID_ACTIONS = ['leads.get', 'research.get_existing', 'crm.get_lead', 'contacted.timeline', 'contacted.account', 'replies.meeting_chain', 'draft.get',
  'campaigns.batch_report', 'campaigns.next_touch', 'campaigns.retry_review', 'campaigns.company_plan', ...COWORK_DOMAIN_ENTITY_READS];
const FIXED_ACTIONS = ['metrics.overview', 'metrics.rates', 'metrics.diagnose', 'metrics.channels', 'metrics.incidents', 'deliverability.bounces', 'deliverability.sender', 'app.context', 'campaigns.list', 'files.list', 'saved_searches.list', 'profile.get',
  'linkedin.network', 'linkedin.inbox', 'linkedin.quota', 'linkedin.followups', 'linkedin.jobs', 'replies.attention', 'replies.stalled', ...COWORK_DOMAIN_FIXED_READS];

export const coworkReadTaskSchema = z.object({
  action: z.enum(['leads.search', 'leads.get', 'research.get_existing',
    'crm.search', 'crm.get_lead', 'contacted.search', 'contacted.timeline', 'contacted.account', 'replies.meeting_chain', 'replies.attention', 'replies.stalled', 'metrics.overview', 'metrics.rates', 'metrics.diagnose', 'metrics.channels', 'metrics.incidents', 'deliverability.check', 'deliverability.bounces', 'deliverability.sender', 'app.context', 'draft.get', 'campaigns.list', 'files.list', 'saved_searches.list', 'profile.get',
    'campaigns.batch_report', 'campaigns.next_touch', 'campaigns.retry_review', 'campaigns.company_plan',
    'linkedin.network', 'linkedin.inbox', 'linkedin.quota', 'linkedin.followups', 'linkedin.jobs', ...COWORK_DOMAIN_FIXED_READS, ...COWORK_DOMAIN_ENTITY_READS]),
  input: z.string().max(120),
}).strict().superRefine((task, context) => {
  if (TEXT_ACTIONS.includes(task.action)) return;
  if (FIXED_ACTIONS.includes(task.action)) {
    if (task.input !== '') context.addIssue({ code: 'custom', path: ['input'], message: 'This read takes no input' });
    return;
  }
  if (UUID_ACTIONS.includes(task.action) && !z.string().uuid().safeParse(task.input).success) {
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
