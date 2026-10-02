import { z } from 'zod';

/**
 * The full research reports Cowork hands over (Plan 7). The model only names whose reports go (answer.reports) and the app
 * writes the document from the reports read in this turn with research.get_existing, as they were written. On 2 Oct the
 * research notice asked the model to copy two reports of about 1,800 words each into document, and the turn ran out of
 * time (30 s and 6,000 output tokens for the decision): «El asistente tardó demasiado en responder».
 */

export const COWORK_REPORTS_TITLE = 'Informes de la investigación';
/** What the document can hold (its schema allows 40,000 characters): a report that does not fit is named, not cut. */
const DOCUMENT_MAX = 38_000;

export const coworkReportRequestSchema = z.object({
  leadId: z.string().uuid(),
  /** «Nombre · Empresa», the heading of the person's report. */
  title: z.string().trim().min(1).max(160),
}).strict();
export type CoworkReportRequest = z.infer<typeof coworkReportRequestSchema>;

type Section = { key?: unknown; title?: unknown; text?: unknown };
type Report = { sections?: Section[]; caveats?: unknown[]; truncated?: unknown };

/** The written reports this turn read, by contact: only research.get_existing results that came with one. */
function observedReports(observations: Array<{ action: string; result: unknown }>) {
  const reports = new Map<string, Report>();
  for (const observation of observations) {
    if (observation.action !== 'research.get_existing') continue;
    const result = observation.result as { leadId?: unknown; report?: Report | null } | null;
    if (typeof result?.leadId === 'string' && Array.isArray(result.report?.sections) && result.report.sections.length) {
      reports.set(result.leadId, result.report);
    }
  }
  return reports;
}

function reportMarkdown(title: string, report: Report) {
  const sections = (report.sections || []).flatMap(section => {
    const heading = typeof section.title === 'string' && section.title.trim() ? section.title.trim() : null;
    const text = typeof section.text === 'string' ? section.text.trim() : '';
    return heading && text ? [`### ${heading}\n\n${text}`] : [];
  });
  const caveats = (report.caveats || []).filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return [
    `## ${title}`,
    ...sections,
    ...(caveats.length ? [`**Lo que no se pudo confirmar:** ${caveats.join(' ')}`] : []),
    ...(report.truncated === true ? ['_Este informe se acortó para la conversación: el completo está en la ficha de investigación de la persona._'] : []),
  ].join('\n\n');
}

/**
 * The document with each requested report, in the order asked; the people whose report was not read in this turn, or does
 * not fit, are listed apart so the reply can say so. Null when none of them was read.
 */
export function coworkReportsDocument(requests: CoworkReportRequest[], observations: Array<{ action: string; result: unknown }>, max = DOCUMENT_MAX) {
  const reports = observedReports(observations);
  const blocks: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  let length = 0;
  for (const request of requests) {
    if (seen.has(request.leadId)) continue;
    seen.add(request.leadId);
    const report = reports.get(request.leadId);
    if (!report) { missing.push(request.title); continue; }
    const block = reportMarkdown(request.title, report);
    if (length + block.length > max) { missing.push(request.title); continue; }
    blocks.push(block);
    length += block.length + 2;
  }
  if (!blocks.length) return null;
  const note = missing.length ? [`_No van aquí: ${missing.join(', ')}. Pídemelos aparte._`] : [];
  return { content: [...blocks, ...note].join('\n\n'), included: blocks.length, missing };
}

/**
 * The answer with its reports attached: the document the app writes replaces the request. A document the model wrote too
 * goes first. Without any report read, the answer stays as the model wrote it.
 */
export function withCoworkReports<Answer extends { reply: string; document: { title: string; content: string } | null; reports?: CoworkReportRequest[] | null }>(
  answer: Answer,
  observations: Array<{ action: string; result: unknown }>,
): Omit<Answer, 'reports'> {
  const { reports, ...rest } = answer;
  if (!reports?.length) return rest;
  const own = rest.document?.content || '';
  const composed = coworkReportsDocument(reports, observations, Math.min(DOCUMENT_MAX, 39_000 - own.length));
  if (!composed) return rest;
  const content = [own, composed.content].filter(Boolean).join('\n\n');
  return { ...rest, document: { title: rest.document?.title || COWORK_REPORTS_TITLE, content } };
}
