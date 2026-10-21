// The tool that lets an agent produce a document: it writes the content (blocks), the harness lays it out, inspects it, reads the pages as images
// when a reviewer is given, and gives back what is wrong so the agent fixes the content and calls it again. The loop of generate → render →
// inspect → correct is the agent's own, with the document engine as its eyes; after two corrections the document is delivered with what is left
// said plainly, so a stubborn warning never blocks the person from getting their file.
import { z } from 'zod';
import { defineTool } from '@/lib/agent-harness/tools';
import type { AgentTool, ModelClient } from '@/lib/agent-harness/types';
import { blocking, produceDocument, type DocumentFormat } from './pipeline';
import { documentInputSchema, specFromInput } from './spec';
import { rasterizePages, reviewDocumentPages } from './vision';

export type StoredDocument = { name: string; format: DocumentFormat; bytes: number; id?: string; url?: string };

export const DOCUMENT_ATTEMPTS = 'document.attempts';
const MAX_CORRECTIONS = 2;

const filenameOf = (title: string, extension: string) => {
  const slug = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  return `${slug || 'documento'}.${extension}`;
};

export function documentTool(options: {
  /** Keeps a produced file where the person can download it. */
  store: (file: { filename: string; mime: string; bytes: Uint8Array }) => Promise<{ id?: string; url?: string }>;
  /** A model that reads images: with it, the pages are reviewed as a person would. */
  reviewer?: ModelClient;
  theme?: 'antonia' | 'cowork';
  brand?: string;
  date?: () => string;
}): AgentTool {
  const mime: Record<DocumentFormat, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  return defineTool({
    name: 'crear_documento',
    description: 'Crea un documento diseñado (PDF y, si lo pides, Word) con portada opcional, títulos, listas, tablas, recuadros, cifras clave y gráficos de barras. Tú escribes el contenido por bloques; el sistema lo diagrama, lo revisa y te dice qué corregir. Úsala para informes, propuestas y resúmenes que la persona va a descargar o compartir.',
    schema: documentInputSchema.extend({ formatos: z.array(z.enum(['pdf', 'docx'])).min(1).max(2).optional().describe('pdf por defecto; docx si necesita editarlo') }),
    kind: 'effect',
    run: async ({ formatos, ...input }, context) => {
      const formats = formatos ?? ['pdf'];
      const spec = specFromInput(input, { theme: options.theme, brand: options.brand });
      const produced = await produceDocument(spec, { formats, date: options.date?.() });
      const attempts = ((context.state.get(DOCUMENT_ATTEMPTS) as number | undefined) ?? 0) + 1;
      context.state.set(DOCUMENT_ATTEMPTS, attempts);
      const problems = produced.issues.map(issue => `- ${issue.page ? `Página ${issue.page}: ` : ''}${issue.message}`);

      const errors = blocking(produced.issues);
      if (errors.length && attempts <= MAX_CORRECTIONS) {
        return { status: 'error', message: `El documento tiene problemas de diseño que cambian cómo se lee:\n${problems.join('\n')}\nCorrige el contenido (acorta, divide o reorganiza) y vuelve a llamar crear_documento con el documento completo.` };
      }

      let seen: string[] = [];
      if (options.reviewer) {
        const pages = await rasterizePages({ pdf: produced.pdf, svgs: produced.svgs });
        const result = await reviewDocumentPages({ model: options.reviewer, title: spec.title, pages, signal: context.signal }).catch(() => null);
        if (result?.status === 'reviewed' && result.review.verdict === 'fix' && attempts <= MAX_CORRECTIONS) {
          return { status: 'error', message: `Al revisar las páginas como las vería una persona:\n${result.review.issues.map(issue => `- Página ${issue.page}: ${issue.problem} → ${issue.fix}`).join('\n')}\nCorrige el contenido y vuelve a llamar crear_documento con el documento completo.` };
        }
        if (result?.status === 'reviewed' && result.review.verdict === 'fix') seen = result.review.issues.map(issue => `Página ${issue.page}: ${issue.problem}`);
      }

      const files: StoredDocument[] = [];
      for (const format of formats) {
        const bytes = format === 'pdf' ? produced.pdf : produced.docx;
        if (!bytes) continue;
        const filename = filenameOf(spec.title, format);
        const stored = await options.store({ filename, mime: mime[format], bytes });
        files.push({ name: filename, format, bytes: bytes.byteLength, ...stored });
      }
      const left = [...problems, ...seen.map(line => `- ${line}`)];
      return { status: 'ok', output: { files, pages: produced.pages, issues: produced.issues.length },
        text: `Documento creado: ${files.map(file => file.name).join(', ')} (${produced.pages} página${produced.pages === 1 ? '' : 's'}). La persona lo descarga desde la respuesta.${left.length ? `\nQuedó sin resolver (no impide entregarlo): \n${left.join('\n')}` : ''}` };
    },
  });
}
