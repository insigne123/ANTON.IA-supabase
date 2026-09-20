import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Fase 3: bounded code proposal the model may submit for human review.
 * Tighter than the executor protocol (12 KB code): the executor caps are the
 * outer safety net, this schema keeps reviews readable. Input files must have
 * been observed via files.list in this execution or its history. */
const fileNameSchema = z.string().trim().min(1).max(120)
  .refine(name => name === name.trim() && !name.includes('/') && !name.includes('\\') && !name.includes('\0') && !name.startsWith('.'), {
    message: 'Nombre de archivo inválido.',
  })
  .refine(name => {
    const dot = name.lastIndexOf('.');
    return dot > 0 && ['csv', 'json', 'md', 'txt', 'xlsx'].includes(name.slice(dot + 1).toLowerCase());
  }, { message: 'Extensión no permitida (csv, json, md, txt, xlsx).' });

export const coworkCodeProposalSchema = z.object({
  language: z.enum(['python', 'node']),
  code: z.string().min(1).max(12288),
  inputFiles: z.array(fileNameSchema).max(8).default([]),
}).strict().superRefine((value, context) => {
  if (/\0/.test(value.code)) {
    context.addIssue({ code: 'custom', path: ['code'], message: 'El código contiene bytes nulos.' });
  }
  if (new Set(value.inputFiles.map(name => name.toLowerCase())).size !== value.inputFiles.length) {
    context.addIssue({ code: 'custom', path: ['inputFiles'], message: 'Hay archivos duplicados.' });
  }
});
export type CoworkCodeProposal = z.infer<typeof coworkCodeProposalSchema>;

/** Stable fingerprint pinned in the effect target (`code:<hash>`). Execution
 * refuses anything else, even if the staged row changed since review. */
export function hashCoworkCodeProposal(proposal: CoworkCodeProposal) {
  const hash = createHash('sha256');
  hash.update(proposal.language);
  hash.update('\0');
  hash.update(proposal.code);
  hash.update('\0');
  for (const name of [...proposal.inputFiles].sort()) {
    hash.update(name.toLowerCase());
    hash.update('\0');
  }
  return hash.digest('hex');
}
