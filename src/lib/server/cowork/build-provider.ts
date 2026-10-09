import { z } from 'zod';

const fileSchema = z.object({ name: z.string().max(120), size: z.number().int().min(0).max(10485760),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), contentBase64: z.string().max(14 * 1024 * 1024) });
export const buildJobSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/), generation: z.string().uuid(), attempt: z.number().int().positive(),
  status: z.enum(['queued', 'running', 'cancel_requested', 'cancelled', 'interrupted', 'outcome_unknown', 'completed', 'failed', 'timeout']),
  result: z.object({ status: z.enum(['completed', 'failed', 'timeout', 'cancelled']), exitCode: z.number().int(),
    stdout: z.string().max(65536), stderr: z.string().max(65536), durationMs: z.number().nonnegative(), files: z.array(fileSchema).max(16) }).nullable(),
}).superRefine((job, context) => {
  if (job.status === 'completed' && !job.result) context.addIssue({ code: 'custom', message: 'Completed job has no durable result' });
  if (job.result && ['completed', 'failed', 'timeout', 'cancelled'].includes(job.status) && job.status !== job.result.status) {
    context.addIssue({ code: 'custom', message: 'Job and result states differ' });
  }
});
export type BuildJob = z.infer<typeof buildJobSchema>;
export type BuildRequest = { idempotencyKey: string; language: 'python' | 'node'; code: string; files: Array<{ name: string; contentBase64: string }> };
export interface BuildProvider {
  capabilities(): Promise<{ asynchronous: true; durableJobs: true; cancellation: true; maxConcurrency: number; maxTimeoutMs: number }>;
  admit(request: BuildRequest): Promise<BuildJob>;
  inspect(id: string): Promise<BuildJob | null>;
  cancel(id: string): Promise<BuildJob | null>;
}
export class CoworkBuildPending extends Error {
  constructor(readonly job: BuildJob) { super('El trabajo sigue ejecutándose; se consultará el mismo trabajo sin repetirlo.'); }
}
export class CoworkBuildUnavailable extends Error {}
export class CoworkBuildOutcomeUnknown extends Error {}
export function coworkBuildIdentity(runId: string) { return `cowork-code-${runId}`; }

/** The executor is private and owned by the control plane. Short transport deadlines do not cancel its durable jobs. */
export function createExecutorBuildProvider(url: string, secret: string, transport: typeof fetch = fetch): BuildProvider {
  if (!/^https:\/\//.test(url) || !secret) throw new Error('Build provider not configured');
  const base = url.replace(/\/+$/, '');
  async function request(path: string, body?: unknown) {
    let response;
    try { response = await transport(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: {
      authorization: `Bearer ${secret}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000), redirect: 'error' }); }
    catch { throw new CoworkBuildUnavailable('No se pudo confirmar el estado del trabajo cloud. Se consultará la misma identidad.'); }
    if (response.status === 404) return null;
    if (response.status === 409) throw new CoworkBuildOutcomeUnknown('El ejecutor no admitió esta consulta por conflicto. Revisa el trabajo conservado antes de preparar otra ejecución.');
    if (response.status >= 500 || response.status === 429) throw new CoworkBuildUnavailable('No se pudo consultar el trabajo cloud. Conservamos su identidad para reintentar la consulta.');
    if (!response.ok) throw new Error('El ejecutor rechazó la consulta del trabajo.');
    return response.json();
  }
  const path = (id: string) => { if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('Invalid build identity'); return `/v2/jobs/${id}`; };
  return {
    async capabilities() {
      return z.object({ asynchronous: z.literal(true), durableJobs: z.literal(true), cancellation: z.literal(true),
        maxConcurrency: z.number().int().positive().max(1), maxTimeoutMs: z.number().int().positive().max(600000) }).parse(await request('/v2/capabilities'));
    },
    async admit(body) { return buildJobSchema.parse(await request('/v2/jobs', body)); },
    async inspect(id) { const data = await request(path(id)); return data ? buildJobSchema.parse(data) : null; },
    async cancel(id) { const data = await request(`${path(id)}/cancel`, {}); return data ? buildJobSchema.parse(data) : null; },
  };
}
