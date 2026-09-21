import { prepareCoworkSpecialists, runCoworkSpecialists, specialistResultSchema, type SpecialistTask } from '@/lib/cowork/specialists';
import type { CoworkObservation } from '@/lib/cowork/agent-loop';
import type { CoworkGatewayDependencies, CoworkScope } from '@/lib/cowork/capabilities';
import { coworkOperationHash } from './operations';

export async function reviewCoworkEvidence(options: {
  scope: CoworkScope;
  tasks: SpecialistTask[];
  observations: CoworkObservation[];
  store: Pick<CoworkGatewayDependencies, 'withOperation'>;
  authorize: () => Promise<void>;
  signal: AbortSignal;
  generate: (task: SpecialistTask, evidence: Array<{ index: number; observation: unknown }>) => Promise<unknown>;
}) {
  const { scope, tasks, observations, store, authorize, signal } = options;
  await authorize(); signal.throwIfAborted();
  // Validate budgets before any reservation; persist only assigned evidence.
  const requested = prepareCoworkSpecialists(tasks, observations);
  // One immutable plan per run, irrespective of the coordinator retry's input.
  const pinned = await store.withOperation(scope, {
    id: `specialist-plan:${scope.runId}`, capability: 'specialists.plan', version: 1, input: {},
  }, async () => requested);
  if (coworkOperationHash(pinned) !== coworkOperationHash(requested)) {
    throw new Error('El plan de especialistas cambió. Continúa en un nuevo turno.');
  }
  return runCoworkSpecialists(tasks, observations, {
    signal, authorize,
    invoke: (task, evidence) => store.withOperation(scope, {
      id: `specialist:${scope.runId}:${task.role}`, capability: `specialists.${task.role}`, version: 1,
      input: { task, evidence },
    }, async () => {
      await authorize(); signal.throwIfAborted();
      const result = specialistResultSchema.parse(await options.generate(task, evidence));
      await authorize(); signal.throwIfAborted();
      if (result.findings.some(finding => finding.evidence.some(index => !task.evidence.includes(index)))) {
        throw new Error('Specialist cited unavailable evidence');
      }
      return result;
    }),
  });
}
