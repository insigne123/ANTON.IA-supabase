// The reviewer that looks: the pages of a document as images, read by a model that sees what a person sees (text cut off, overlaps, a table
// nobody can read, a page that feels empty, a hierarchy that does not guide the eye) and says where and how to fix it. The deterministic inspector
// (inspect.ts) finds what geometry can find; this finds what only eyes do. The pages come from a PDF rasterizer when the machine has one
// (pdftoppm), else from the SVG previews through sharp. With neither, the review is skipped and says so: a review never blocks a document.
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { runStructured } from '@/lib/agent-harness/structured';
import type { ContentBlock, ModelClient } from '@/lib/agent-harness/types';

const run = promisify(execFile);

export const documentReviewSchema = z.object({
  verdict: z.enum(['pass', 'fix']),
  issues: z.array(z.object({
    page: z.number().int().min(1).max(80),
    problem: z.string().min(3).max(300).describe('Qué se ve mal, concreto'),
    fix: z.string().min(3).max(300).describe('Cómo corregirlo en el documento (acortar, dividir, mover, cambiar de bloque)'),
  })).max(10),
});
export type DocumentReview = z.infer<typeof documentReviewSchema>;

export const DOCUMENT_REVIEWER_SYSTEM = [
  'Eres el revisor de un documento impreso (informe, propuesta, resumen). Recibes sus páginas como imágenes y el título.',
  'Dices si se puede entregar. Marca «fix» solo por lo que una persona notaría al abrirlo:',
  '- texto cortado, encimado o fuera de los márgenes;',
  '- una tabla ilegible (columnas apretadas, texto diminuto, cifras sin alinear) o que se parte de forma confusa;',
  '- un título solo al final de una página, una última página casi vacía, grandes huecos sin motivo;',
  '- jerarquía que no guía el ojo (todo parece del mismo peso) o un recuadro que no se entiende;',
  '- faltas de ortografía, textos a medio escribir ([completar], {{x}}) o cifras sin unidad.',
  'No marques «fix» por gustos. Cada problema dice la página, qué se ve mal y cómo arreglarlo editando el contenido (acortar un párrafo, dividir una tabla, pasar una lista a tabla). Si está bien, «pass» con la lista vacía.',
].join('\n');

/** The pages as PNG, from a PDF rasterizer when there is one, else from the SVG previews; null when neither is available. */
export async function rasterizePages(input: { pdf?: Uint8Array | null; svgs?: string[]; dpi?: number; maxPages?: number }): Promise<Uint8Array[] | null> {
  const maxPages = input.maxPages ?? 8;
  if (input.pdf) {
    const directory = await mkdtemp(path.join(tmpdir(), 'doc-review-'));
    try {
      await writeFile(path.join(directory, 'in.pdf'), input.pdf);
      await run('pdftoppm', ['-r', String(input.dpi ?? 72), '-png', '-l', String(maxPages), path.join(directory, 'in.pdf'), path.join(directory, 'page')], { timeout: 30_000 });
      const names = (await readdir(directory)).filter(name => name.endsWith('.png')).sort();
      if (names.length) return await Promise.all(names.map(async name => new Uint8Array(await readFile(path.join(directory, name)))));
    } catch { /* no pdftoppm here: the previews are next */ } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  if (input.svgs?.length) {
    try {
      const sharp = (await import('sharp')).default;
      return await Promise.all(input.svgs.slice(0, maxPages).map(async svg => new Uint8Array(await sharp(Buffer.from(svg), { density: input.dpi ?? 72 }).png().toBuffer())));
    } catch { return null; }
  }
  return null;
}

export type VisionResult = { status: 'reviewed'; review: DocumentReview } | { status: 'skipped'; reason: string };

export async function reviewDocumentPages(input: { model: ModelClient; title: string; pages: Uint8Array[] | null; signal: AbortSignal }): Promise<VisionResult> {
  if (!input.pages?.length) return { status: 'skipped', reason: 'Este entorno no puede convertir el documento en imágenes.' };
  const images: ContentBlock[] = input.pages.map(page => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(page).toString('base64') } }));
  const { data } = await runStructured({
    model: input.model, system: DOCUMENT_REVIEWER_SYSTEM, schema: documentReviewSchema, signal: input.signal, effort: 'low', limits: { maxRounds: 2, maxTokens: 2_000 },
    prompt: [...images, { type: 'text', text: `Título: ${input.title}\nPáginas: ${input.pages.length}. Revisa el documento.` }],
  });
  return { status: 'reviewed', review: data };
}
