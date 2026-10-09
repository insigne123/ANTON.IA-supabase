import { z } from 'zod';
export const coworkQueuedMessageSchema = z.object({ text: z.string().min(1).max(20000), requestId: z.string().uuid(),
  parentRunId: z.string().uuid().nullable().optional(), state: z.enum(['queued', 'sending', 'failed']).optional() }).strict();
export type CoworkQueuedMessage = z.infer<typeof coworkQueuedMessageSchema>;
export function coworkQueueKey(scope: { userId?: string | null; organizationId?: string | null; rootId?: string | null }) {
  const ids = [scope.organizationId, scope.userId, scope.rootId];
  return ids.every(id => z.string().uuid().safeParse(id).success) ? `antonia:cowork:queue:${ids.join(':')}` : null;
}
export function readCoworkQueue(storage: Pick<Storage, 'getItem'> | null, key: string | null): CoworkQueuedMessage | null {
  if (!key || !storage) return null;
  try { const parsed = coworkQueuedMessageSchema.safeParse(JSON.parse(storage.getItem(key) || 'null')); return parsed.success ? parsed.data : null; }
  catch { return null; }
}
