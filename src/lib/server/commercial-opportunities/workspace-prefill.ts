import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@/lib/server/auth-utils';
import { opportunityLocalClock } from '@/lib/commercial-opportunities/workspace';
import { PREFILL_SCANNED, prefillAnswerSchema, prefillFields, prefillPrompt } from '@/lib/commercial-opportunities/prefill';
import type { ClaudeAttachment } from '@/ai/anthropic-json';
import { opportunityGenerate, type OpportunityJob } from './workspace-ai';

/**
 * «Cargar oportunidad» from a document (prefill.ts): the model proposes the form's fields; nothing is saved here. A scanned
 * document or a photo has no text: the model reads the file itself, which only the request that received it holds.
 */
export async function runOpportunityPrefill(client: SupabaseClient, job: OpportunityJob, attachments?: ClaudeAttachment[]) {
  const text = String(job.payload.text || '');
  if (job.payload.scanned && !attachments?.length) throw new AuthError('Vuelve a subir el documento para que la IA lo lea.', 409);
  if (!job.payload.scanned && text.trim().length < 40) throw new AuthError('No encontramos texto en el documento. Escribe los datos.', 422);
  const read = job.payload.scanned ? String(job.payload.sha || '') : createHash('sha256').update(text).digest('hex');
  const answer = await opportunityGenerate(client, job, { step: `prefill:${read.slice(0, 32)}`, category: 'evaluation', role: 'extract',
    schema: prefillAnswerSchema, output: 2000, prompt: prefillPrompt({ name: String(job.payload.name || 'documento').slice(0, 200), text: job.payload.scanned ? PREFILL_SCANNED : text, today: opportunityLocalClock().day }),
    ...(job.payload.scanned ? { attachments, attachmentTokens: Number(job.payload.attachmentTokens) || 0 } : {}) });
  return prefillFields(answer);
}
