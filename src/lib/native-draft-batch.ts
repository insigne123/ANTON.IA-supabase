export const MAX_NATIVE_DRAFT_BATCH_SIZE = 20;

export type NativeDraftBatchTarget = {
  leadId: string;
  researchSnapshotId: string;
};

export type NativeDraftBatchResult<T> =
  | { status: 'drafted'; target: NativeDraftBatchTarget; draft: T }
  | { status: 'failed'; target: NativeDraftBatchTarget; error: string };

export async function createNativeDraftBatch<T>(input: {
  targets: NativeDraftBatchTarget[];
  createDraft: (target: NativeDraftBatchTarget) => Promise<T>;
  concurrency?: number;
  onProgress?: (completed: number, total: number) => void;
}): Promise<Array<NativeDraftBatchResult<T>>> {
  const targets = input.targets.slice(0, MAX_NATIVE_DRAFT_BATCH_SIZE);
  const results = new Array<NativeDraftBatchResult<T>>(targets.length);
  const concurrency = Math.max(1, Math.min(input.concurrency || 3, targets.length || 1));
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (cursor < targets.length) {
      const index = cursor;
      cursor += 1;
      const target = targets[index];
      try {
        results[index] = { status: 'drafted', target, draft: await input.createDraft(target) };
      } catch (error) {
        results[index] = {
          status: 'failed',
          target,
          error: error instanceof Error ? error.message : 'No se pudo preparar el borrador.',
        };
      } finally {
        completed += 1;
        input.onProgress?.(completed, targets.length);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}
