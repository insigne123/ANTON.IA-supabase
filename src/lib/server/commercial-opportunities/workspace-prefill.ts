import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@/lib/server/auth-utils';
import { opportunityLocalClock } from '@/lib/commercial-opportunities/workspace';
import { prefillAnswerSchema, prefillFields, prefillPrompt } from '@/lib/commercial-opportunities/prefill';
import { opportunityGenerate, type OpportunityJob } from './workspace-ai';

/** «Cargar oportunidad» from a document (prefill.ts): the model proposes the form's fields; nothing is saved here. */
export async function runOpportunityPrefill(client: SupabaseClient, job: OpportunityJob) {
  const text = String(job.payload.text || '');
  if (text.trim().length < 40) throw new AuthError('No encontramos texto en el documento. Escribe los datos.', 422);
  const answer = await opportunityGenerate(client, job, { step: `prefill:${createHash('sha256').update(text).digest('hex').slice(0, 32)}`, category: 'evaluation', role: 'extract',
    schema: prefillAnswerSchema, output: 2000, prompt: prefillPrompt({ name: String(job.payload.name || 'documento').slice(0, 200), text, today: opportunityLocalClock().day }) });
  return prefillFields(answer);
}
