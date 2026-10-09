import { z } from 'zod';
import type { CoworkEvent } from './contracts';
const fileSchema = z.object({ name: z.string().min(1).max(120).refine(name => !name.startsWith('.') && !/[\\/\0]/.test(name)),
  size: z.number().int().min(0).max(10485760).nullish(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional() });
export type CoworkPublishedFile = z.infer<typeof fileSchema> & { at: string };
/** New executor outputs are published atomically by cowork_finish_effect, not by uploads or pre-finish events. */
export function coworkPublishedFiles(events: CoworkEvent[]): CoworkPublishedFile[] {
  const files = new Map<string, CoworkPublishedFile>();
  for (const event of events) {
    const payload = event.payload || {};
    const result = payload.result as { files?: unknown } | undefined;
    const candidates = event.kind === 'effect.completed' && payload.kind === 'code_execute' && Array.isArray(result?.files) ? result.files
      : event.kind === 'artifact.created' && !(payload.kind === 'code' && typeof payload.key === 'string' && Number.isInteger(payload.version)) && !payload.codeHash ? [payload] : [];
    for (const candidate of candidates) {
      const parsed = fileSchema.safeParse(candidate);
      if (parsed.success) files.set(parsed.data.name, { ...parsed.data, at: event.created_at });
    }
  }
  return [...files.values()];
}
