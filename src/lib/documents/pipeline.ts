// The whole circuit for one document: spec → layout → inspection → the fixes the layout can make → PDF (and Word) → previews. What needs
// judgement goes to the reviewer (vision.ts) and, through the agent harness, back to whoever wrote the document (tool.ts).
import { layoutSvgs } from './render-svg';
import { createPdfMeasurer, pdfSafeSpec, writePdf } from './render-pdf';
import { renderDocx } from './render-docx';
import { improveLayout, type DocumentIssue } from './inspect';
import type { Layout } from './layout';
import type { DocumentSpec } from './spec';

export type DocumentFormat = 'pdf' | 'docx';

export type ProducedDocument = {
  pdf: Uint8Array | null;
  docx: Uint8Array | null;
  layout: Layout;
  pages: number;
  issues: DocumentIssue[];
  /** One SVG per page, for previews and for the reviewer when no PDF rasterizer is at hand. */
  svgs: string[];
  /** Characters the PDF could not draw and replaced (the Word keeps them). */
  lost: number;
  attempts: number;
};

export async function produceDocument(spec: DocumentSpec, options: { formats?: DocumentFormat[]; date?: string } = {}): Promise<ProducedDocument> {
  const formats = options.formats ?? ['pdf'];
  const safe = pdfSafeSpec(spec);
  const { pdf, measure } = await createPdfMeasurer();
  const improved = improveLayout(safe.spec, measure, { date: options.date });
  const issues = [...improved.issues];
  if (safe.lost > 0) {
    issues.push({ severity: 'warn', kind: 'unsupported-glyph', page: 0,
      message: `${safe.lost} ${safe.lost === 1 ? 'carácter no se puede dibujar' : 'caracteres no se pueden dibujar'} en el PDF y se reemplazaron por «?»; el Word los conserva.` });
  }
  return {
    pdf: formats.includes('pdf') ? writePdf(pdf, improved.layout) : null,
    docx: formats.includes('docx') ? await renderDocx(spec, { date: options.date }) : null,
    layout: improved.layout, pages: improved.layout.pages.length, issues, svgs: layoutSvgs(improved.layout), lost: safe.lost, attempts: improved.attempts,
  };
}

export const blocking = (issues: DocumentIssue[]) => issues.filter(issue => issue.severity === 'error');
