import type { CoworkTaskPlan, CoworkTaskStepKind } from './task-plan';
export type CoworkTaskDeliveryEvent = { runId: string; kind: string; payload: Record<string, unknown> };
export type CoworkTaskNode = { id: string; kind: CoworkTaskStepKind; label: string; dependsOn: string[];
  targets: string[]; resultRefs: string[]; state: 'pending' | 'blocked' | 'running' | 'succeeded' | 'partial' | 'failed' };
const effects: Record<string, CoworkTaskStepKind> = { save_contact: 'prepare', enrich_contact: 'prepare', enrich_batch: 'prepare',
  start_research: 'prepare', lead_prepare_batch: 'prepare', campaign_create: 'campaign', search: 'search' };

/** Reconstruct the approved graph from durable facts. Approval/admission never counts as delivery.
 * The source plan remains unchanged; stable step IDs and result refs survive every continuation. */
export function coworkTaskGraph(startRunId: string, plan: CoworkTaskPlan, events: CoworkTaskDeliveryEvent[]): CoworkTaskNode[] {
  const nodes: CoworkTaskNode[] = plan.steps.map((step, index) => ({ id: `${startRunId}:step:${index + 1}`, kind: step.kind, label: step.label,
    dependsOn: index ? [`${startRunId}:step:${index}`] : [], targets: [], resultRefs: [], state: index ? 'blocked' : 'pending' }));
  const assigned = new Map<string, CoworkTaskNode>();
  const researchNeeded = new Map<string, Set<string>>();
  const researchDone = new Map<string, Set<string>>();
  const unlock = () => nodes.forEach(node => { if (node.state === 'blocked' && node.dependsOn.every(id => nodes.some(dep => dep.id === id && dep.state === 'succeeded'))) node.state = 'pending'; });
  const find = (kind: CoworkTaskStepKind, runId: string, stepId?: unknown) => (assigned.get(runId)?.kind === kind ? assigned.get(runId) : undefined)
    || (typeof stepId === 'string' ? nodes.find(node => node.id === stepId && node.kind === kind) : nodes.find(node => node.kind === kind && ['pending', 'running'].includes(node.state)));
  for (const event of events) {
    const payload = event.payload || {}, result = payload.result as Record<string, unknown> | undefined;
    const effectKind = String(payload.kind || '');
    if (event.kind === 'task.step' && effects[effectKind]) {
      const node = find(effects[effectKind], event.runId, payload.stepId);
      if (node) { node.state = 'running'; assigned.set(event.runId, node); if (Array.isArray(payload.targets)) node.targets = payload.targets.filter((target): target is string => typeof target === 'string'); }
    } else if (event.kind === 'effect.completed' && effects[effectKind]) {
      // A campaign carries its own emails: created, it delivers the write step it waited on.
      if (effectKind === 'campaign_create') { campaignWriting(nodes).forEach(node => { node.state = 'succeeded'; node.resultRefs.push(`${event.runId}:campaign`); }); unlock(); }
      const node = find(effects[effectKind], event.runId);
      if (!node) continue;
      node.resultRefs.push(`${event.runId}:effect:${effectKind}`);
      if (effectKind === 'campaign_create') {
        const id = result?.campaignId;
        node.state = typeof id === 'string' && ['draft', 'paused', 'approved_paused'].includes(String(result?.status)) ? 'succeeded' : 'partial';
        if (typeof id === 'string') node.resultRefs.push(`campaign:${id}`);
      } else if (effectKind === 'lead_prepare_batch') {
        const items = Array.isArray(result?.items) ? result.items as Array<{ id?: string; status?: string; research?: string }> : [];
        const eligible = items.filter(item => item.status !== 'removed');
        node.targets = eligible.flatMap(item => item.id ? [item.id] : []);
        researchNeeded.set(node.id, new Set(eligible.filter(item => item.research === 'queued' || item.research === 'completed').flatMap(item => item.id ? [item.id] : [])));
        researchDone.set(node.id, new Set(eligible.filter(item => item.research === 'completed').flatMap(item => item.id ? [item.id] : [])));
        node.state = !eligible.length ? 'partial' : eligible.some(item => item.status !== 'ready') ? 'partial'
          : eligible.some(item => item.research === 'queued') ? 'running' : 'succeeded';
      } else if (effectKind === 'start_research') {
        node.state = result?.status === 'completed' ? 'succeeded' : 'running';
        if (typeof result?.reportId === 'string') node.resultRefs.push(`research:${result.reportId}`);
      } else {
        // A lookup/save is an intermediate preparation operation, not proof that the whole preparation is complete.
        node.state = 'running';
        if (typeof result?.leadId === 'string') node.targets.push(result.leadId);
      }
    } else if (event.kind === 'tool.completed' && payload.action === 'research.get_existing') {
      const target = typeof payload.input === 'string' ? payload.input : null;
        const research = result?.research as { status?: string } | undefined;
      const node = nodes.find(node => node.kind === 'prepare' && node.state === 'running' && target && node.targets.includes(target));
      if (node && target && result?.availability === 'available') {
        if (research?.status === 'completed') {
          const done = researchDone.get(node.id) || new Set<string>(); done.add(target); researchDone.set(node.id, done);
          const needed = researchNeeded.get(node.id) || new Set(node.targets);
          if ([...needed].every(id => done.has(id))) node.state = 'succeeded';
          node.resultRefs.push(`${event.runId}:research:${target}`);
        } else if (research?.status && !['queued', 'running', 'pending'].includes(research.status)) node.state = 'partial';
      }
    } else if (event.kind === 'tool.completed' && payload.action === 'prospecting.search') {
      const node = find('search', event.runId);
      if (node && Array.isArray(result?.items)) { node.state = 'succeeded'; node.targets = result.items.flatMap(item => typeof item?.id === 'string' ? [item.id] : []);
        node.resultRefs.push(`${event.runId}:contacts`); }
    } else if ((event.kind === 'run.completed' && Array.isArray(payload.blocks)) || (event.kind === 'tool.completed' && payload.action === 'assistant.written' && Array.isArray(result?.blocks))) {
      const blocks = (event.kind === 'run.completed' ? payload.blocks : result!.blocks) as Array<{ type: string }>;
      const drafts = blocks.filter(block => block?.type === 'email_draft' || block?.type === 'sequence');
      const node = find('write', event.runId);
      if (node && drafts.length) { node.state = 'succeeded'; assigned.set(event.runId, node); node.resultRefs.push(...blocks.flatMap((block, index) =>
        block?.type === 'email_draft' || block?.type === 'sequence' ? [`${event.runId}:block:${index}`] : [])); }
    } else if (event.kind === 'effect.failed') {
      const node = assigned.get(event.runId); if (node) node.state = 'failed';
    }
    unlock();
  }
  for (const node of nodes) { node.targets = [...new Set(node.targets)]; node.resultRefs = [...new Set(node.resultRefs)]; }
  return nodes;
}
/** The write steps a campaign delivers with its own emails: not done yet, right before a campaign step, and with everything before them done. */
function campaignWriting(graph: CoworkTaskNode[]) {
  return graph.filter(node => node.kind === 'write' && node.state !== 'succeeded'
    && graph.some(next => next.kind === 'campaign' && next.dependsOn.includes(node.id))
    && node.dependsOn.every(id => graph.some(dep => dep.id === id && dep.state === 'succeeded')));
}

export function coworkTaskReadyNode(graph: CoworkTaskNode[], kind: CoworkTaskStepKind) {
  // A campaign proposed with its emails is ready when its write step is all it waits on.
  const delivered = kind === 'campaign' ? new Set(campaignWriting(graph).map(node => node.id)) : new Set<string>();
  return graph.find(node => node.kind === kind && ['pending', 'running', ...(delivered.size ? ['blocked'] : [])].includes(node.state)
    && node.dependsOn.every(id => delivered.has(id) || graph.some(dep => dep.id === id && dep.state === 'succeeded')));
}
export function coworkTaskReadyEffect(graph: CoworkTaskNode[] | undefined, kind: string) {
  return graph && effects[kind] ? coworkTaskReadyNode(graph, effects[kind]) : undefined;
}

/** Where a step of a task stands as the conversation shows it: done, the one it goes on with, still to come, or with something to look at. */
export type CoworkTaskProgressState = 'done' | 'current' | 'pending' | 'attention';
export type CoworkTaskProgress = { goal: string; steps: Array<{ label: string; state: CoworkTaskProgressState }> };
const PROGRESS_STATES: readonly CoworkTaskProgressState[] = ['done', 'current', 'pending', 'attention'];

/** The task after a turn (the «task.progress» event): its goal and each step, with the first one not done as the current one. */
export function coworkTaskProgress(goal: string, graph: CoworkTaskNode[]): CoworkTaskProgress {
  const current = graph.find(node => node.state !== 'succeeded');
  return { goal, steps: graph.map(node => ({ label: node.label, state: node.state === 'succeeded' ? 'done'
    : node.state === 'partial' || node.state === 'failed' ? 'attention' : node === current ? 'current' : 'pending' })) };
}

/** Structural read of a stored «task.progress» for the UI; anything else reads as none. */
export function coworkStoredTaskProgress(value: unknown): CoworkTaskProgress | null {
  if (!value || typeof value !== 'object') return null;
  const { goal, steps } = value as { goal?: unknown; steps?: unknown };
  if (typeof goal !== 'string' || !goal.trim() || !Array.isArray(steps) || steps.length < 2 || steps.length > 6) return null;
  const kept = steps.filter((step): step is { label: string; state: CoworkTaskProgressState } => Boolean(step) && typeof step.label === 'string'
    && step.label.trim().length > 0 && PROGRESS_STATES.includes(step.state));
  return kept.length === steps.length ? { goal: goal.slice(0, 300), steps: kept.map(step => ({ label: step.label.slice(0, 160), state: step.state })) } : null;
}
