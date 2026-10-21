// The report's second reading (claim-verification.ts) as an agent: a small Claude reviews each documented claim against its quotes and may read
// a whole fragment when a quote alone does not decide. It is a step of the research job's ledger like any other, and it never stops the report:
// if it cannot run (no time, no budget, an uncertain earlier step, a provider error) the report goes out as it was written.
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { AuthError } from '@/lib/server/auth-utils';
import { claimVerdictSchema, CLAIM_REVIEW_SYSTEM, applyClaimVerdicts, reportClaims, unsupportedClaims, type ReportClaim } from '@/lib/commercial-opportunities/claim-verification';
import type { DocumentChunk, OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import { opportunityModel } from '@/lib/commercial-opportunities/model-policy';
import { defineTool, type ModelClient } from '@/lib/agent-harness/index';
import { runOpportunityAgent } from './workspace-agent';
import type { OpportunityJob } from './workspace-ai';

/** On when the agents are (OPPORTUNITIES_RUNTIME=harness) and the product asked for the second reading (OPPORTUNITIES_REPORT_VERIFY=on). */
export function opportunityVerifyEnabled(env: Record<string, string | undefined> = process.env) {
  if (String(env.OPPORTUNITIES_RUNTIME || '').trim().toLowerCase() !== 'harness' || String(env.OPPORTUNITIES_REPORT_VERIFY || '').trim().toLowerCase() !== 'on') return false;
  if (!String(env.ANTHROPIC_API_KEY || '').trim()) return false;
  try { return opportunityModel('specialist', env).startsWith('claude-'); } catch { return false; }
}

type Verifiable = Pick<OpportunityReport, 'sections' | 'requirements' | 'milestones' | 'risks'>;

/** A line for the report's warnings when the reading downgraded something. */
export const verifiedWarning = (count: number) => (count === 1
  ? 'Una afirmación del informe no quedó respaldada por su cita y pasó a «por confirmar».'
  : `${count} afirmaciones del informe no quedaron respaldadas por su cita y pasaron a «por confirmar».`);

export async function verifyReportClaims<R extends Verifiable>(client: SupabaseClient, job: OpportunityJob, report: R, chunks: DocumentChunk[],
  options: { timeoutMs: number; base?: ModelClient }): Promise<{ report: R; downgraded: number; checked: number }> {
  const claims = reportClaims(report);
  if (!claims.length) return { report, downgraded: 0, checked: 0 };
  const byId = new Map(chunks.map(chunk => [chunk.id, chunk]));
  const digest = createHash('sha256').update(JSON.stringify(claims)).digest('hex').slice(0, 24);
  try {
    const { data } = await runOpportunityAgent(client, job, {
      step: `verify:${digest}`, role: 'specialist', category: 'research', schema: claimVerdictSchema, system: CLAIM_REVIEW_SYSTEM, base: options.base,
      prompt: JSON.stringify({ afirmaciones: claims.map(({ id, text, quotes }) => ({ id, afirmacion: text.slice(0, 600), citas: quotes.map(quote => ({ chunkId: quote.chunkId, texto: quote.quote.slice(0, 600) })) })) }),
      tools: [defineTool({
        name: 'leer_fragmento', kind: 'read', tags: ['fragmento', 'cita', 'contexto'],
        description: 'Lee un fragmento completo del expediente por su chunkId, para ver el contexto de una cita.',
        schema: z.object({ chunkId: z.string().min(1).max(100) }),
        run: async ({ chunkId }) => {
          const chunk = byId.get(chunkId);
          return chunk ? { status: 'ok', output: { chunkId, ubicacion: chunk.locator, texto: chunk.content } } : { status: 'error', message: 'Ese fragmento no está en el expediente.' };
        },
      })],
      validate: answer => {
        const missing = claims.filter(claim => !answer.results.some(result => result.id === claim.id)).map(claim => claim.id);
        return missing.length ? `Faltan afirmaciones por revisar: ${missing.slice(0, 20).join(', ')}. Entrega un resultado por cada una.` : null;
      },
      effort: 'low', maxRounds: 4, maxToolCalls: 6, timeoutMs: options.timeoutMs,
    });
    const verified = applyClaimVerdicts(report, unsupportedClaims(data, claims));
    return { ...verified, checked: claims.length };
  } catch (error) {
    // The reading is a courtesy to the reader: whatever stops it (time, budget, an earlier uncertain step, the provider) leaves the report as written.
    if (error instanceof AuthError) return { report, downgraded: 0, checked: 0 };
    throw error;
  }
}

export type { ReportClaim };
