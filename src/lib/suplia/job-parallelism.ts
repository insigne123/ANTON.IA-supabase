type SupliaParallelStepLike = {
  id: string;
  step_order?: number | null;
  step_key?: string | null;
  title?: string | null;
  status?: string | null;
  can_run_in_parallel?: boolean | null;
  depends_on_step_ids?: string[] | null;
  scheduled_for?: string | null;
};

export function supliaDependenciesCompleted(step: SupliaParallelStepLike, steps: SupliaParallelStepLike[]) {
  const dependencies = Array.isArray(step.depends_on_step_ids) ? step.depends_on_step_ids : [];
  if (dependencies.length === 0) return true;
  const completed = new Set(steps.filter((item) => item.status === 'completed').map((item) => item.id));
  return dependencies.every((dependencyId) => completed.has(dependencyId));
}

export function isSupliaStepRunnable(step: SupliaParallelStepLike, steps: SupliaParallelStepLike[], nowMs = Date.now()) {
  if (step.status !== 'queued') return false;
  if (!supliaDependenciesCompleted(step, steps)) return false;
  const scheduledForMs = step.scheduled_for ? new Date(step.scheduled_for).getTime() : 0;
  return !scheduledForMs || scheduledForMs <= nowMs;
}

export function pickSupliaRunnableStepBatch(steps: SupliaParallelStepLike[], nowMs = Date.now(), maxParallel = 3) {
  const runnable = steps
    .filter((step) => isSupliaStepRunnable(step, steps, nowMs))
    .sort((a, b) => Number(a.step_order || 0) - Number(b.step_order || 0));

  if (runnable.length === 0) return [];

  const first = runnable[0];
  if (!first.can_run_in_parallel) return [first];

  return runnable.filter((step) => step.can_run_in_parallel).slice(0, Math.max(1, maxParallel));
}

export function getSupliaParallelBatchLabel(steps: Array<Pick<SupliaParallelStepLike, 'title'>>) {
  if (steps.length <= 1) return String(steps[0]?.title || 'Ejecutando');
  return `Ejecutando ${steps.length} steps en paralelo`;
}
