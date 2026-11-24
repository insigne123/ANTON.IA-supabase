import type { NativeResearchLeadStatus } from '@/lib/native-research-contracts';

/**
 * Reading the research of a list of leads without bringing every report each time.
 *
 * A page reloads its list often (each change of a lead, each return from a dialog) and the reports have not changed. Before,
 * every reload brought all of them again: for someone with 230 researched leads, 36 MB each time, 64 times in 14 minutes,
 * and the database stopped answering for every customer (24 Nov 2026). Now the tab says what it holds and gets back only
 * what is new.
 */

/** Leads asked per request, and requests at once: a first load of 230 reports comes in five answers, not in one of 20 MB. */
const LEADS_PER_REQUEST = 50;
const REQUESTS_AT_ONCE = 2;
/** The statuses a stored report comes with (as the server: RESEARCH_STATUSES_WITH_REPORT). */
const STATUSES_WITH_REPORT = new Set(['completed', 'partial', 'insufficient_data']);

export type ResearchStatusMemory = Map<string, NativeResearchLeadStatus>;

/** What this tab holds, by lead. Shared by the pages that list research, so going from one to the other reads nothing again. */
const tabMemory: ResearchStatusMemory = new Map();

/** The versions held for these leads, to send as `known`. */
export function knownResearchVersions(leadIds: string[], memory: ResearchStatusMemory = tabMemory): Record<string, string> {
  const known: Record<string, string> = {};
  for (const leadId of leadIds) {
    const version = memory.get(leadId)?.version;
    if (version) known[leadId] = version;
  }
  return known;
}

/**
 * Puts the statuses the tab holds where the server answered `unchanged` and remembers the ones that came. `missing` are the
 * leads answered `unchanged` that the tab does not hold after all: they have to be asked again in full.
 */
export function mergeResearchStatuses(
  items: NativeResearchLeadStatus[],
  memory: ResearchStatusMemory = tabMemory,
): { items: NativeResearchLeadStatus[]; missing: string[] } {
  const merged: NativeResearchLeadStatus[] = [];
  const missing: string[] = [];
  for (const item of items) {
    if (!item.unchanged) {
      memory.set(item.leadId, item);
      merged.push(item);
      continue;
    }
    const held = memory.get(item.leadId);
    if (held && held.version === item.version) merged.push(held);
    else missing.push(item.leadId);
  }
  return { items: merged, missing };
}

async function requestStatuses(
  leadIds: string[],
  known: Record<string, string>,
  fetcher: typeof fetch,
): Promise<NativeResearchLeadStatus[]> {
  const response = await fetcher('/api/native-research/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.keys(known).length > 0 ? { leadIds, known } : { leadIds }),
  });
  if (!response.ok) throw new Error('NATIVE_RESEARCH_LEAD_STATUS_FAILED');
  const payload = await response.json().catch(() => null);
  return Array.isArray(payload?.items) ? payload.items as NativeResearchLeadStatus[] : [];
}

/** The latest research of each of these leads, with its report. Throws NATIVE_RESEARCH_LEAD_STATUS_FAILED. */
export async function fetchNativeResearchLeadStatuses(
  leadIds: string[],
  options: { fetcher?: typeof fetch; memory?: ResearchStatusMemory } = {},
): Promise<NativeResearchLeadStatus[]> {
  const fetcher = options.fetcher || fetch;
  const memory = options.memory || tabMemory;
  const ids = Array.from(new Set(leadIds.map((id) => String(id || '').trim()).filter(Boolean)));
  const chunks = Array.from(
    { length: Math.ceil(ids.length / LEADS_PER_REQUEST) },
    (_, index) => ids.slice(index * LEADS_PER_REQUEST, (index + 1) * LEADS_PER_REQUEST),
  );
  const answers: NativeResearchLeadStatus[][] = new Array(chunks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(REQUESTS_AT_ONCE, chunks.length) }, async () => {
    while (next < chunks.length) {
      const index = next;
      next += 1;
      const chunk = chunks[index];
      const first = mergeResearchStatuses(await requestStatuses(chunk, knownResearchVersions(chunk, memory), fetcher), memory);
      const again = first.missing.length > 0
        ? mergeResearchStatuses(await requestStatuses(first.missing, {}, fetcher), memory).items
        : [];
      answers[index] = [...first.items, ...again];
    }
  }));
  return answers.flat();
}

/**
 * For the poll of a running batch: puts back the reports the page holds where the answer says `result_unchanged`, and
 * remembers the ones that came. `held` goes by job id and belongs to one run; its keys are what the next poll sends as `have`.
 */
export function restoreHeldRunResults(payload: unknown, held: Map<string, unknown>): unknown {
  const root = payload as any;
  const run = root?.run ?? root;
  if (!run || !Array.isArray(run.items)) return payload;
  const items = run.items.map((item: any) => {
    const job = item?.job;
    const jobId = String(job?.id || '');
    if (!job || !jobId) return item;
    if (job.result_unchanged === true) {
      return held.has(jobId) ? { ...item, job: { ...job, result_payload: held.get(jobId) } } : item;
    }
    if (job.result_payload && STATUSES_WITH_REPORT.has(String(job.status || '').toLowerCase())) held.set(jobId, job.result_payload);
    else held.delete(jobId);
    return item;
  });
  return root?.run ? { ...root, run: { ...run, items } } : { ...run, items };
}
