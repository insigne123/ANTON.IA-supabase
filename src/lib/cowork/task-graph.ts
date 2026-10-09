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
export function coworkTaskReadyNode(graph: CoworkTaskNode[], kind: CoworkTaskStepKind) {
  return graph.find(node => node.kind === kind && ['pending', 'running'].includes(node.state)
    && node.dependsOn.every(id => graph.some(dep => dep.id === id && dep.state === 'succeeded')));
}
export function coworkTaskReadyEffect(graph: CoworkTaskNode[] | undefined, kind: string) {
  return graph && effects[kind] ? coworkTaskReadyNode(graph, effects[kind]) : undefined;
}
