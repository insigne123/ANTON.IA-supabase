// «Cambios desde el informe del 22 de octubre» (OPP-20): what a new version of the report says that the one before did not. «Actualizar
// informe» replaces the one shown; without this the team had to read it all again to find what moved. A few lines, the decision first,
// and only what can be told apart for sure: documents read, dates, requirements, questions and serious risks. Pure.
import type { OpportunityReport } from './expedient';
import { parseReportDate } from './report-marks';
import { buyerQuestions, humanDate, reportDecision, reportKeyDates } from './report-view';

type Version = { created_at: string; report: OpportunityReport };
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('es');
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const listEs = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}` : items[0] ?? '');
/** «Anexo 4.docx» y «Aclaraciones.pdf», or the first two and how many more. */
const named = (items: string[], max = 2) => {
  const shown = items.slice(0, max).map(item => `«${clip(item.replace(/\s+/g, ' ').trim(), 80)}»`);
  return items.length > max ? `${shown.join(', ')} y ${items.length - max} más` : listEs(shown);
};
const count = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('#', String(n)));

/** What changed between two versions of the report, five lines at most; none when nothing that matters moved. */
export function reportChanges(previous: Version, latest: Version): { since: string; lines: string[] } {
  const before = previous.report, after = latest.report;
  const lines: string[] = [];
  const was = reportDecision(before).label, now = reportDecision(after).label;
  if (was !== now) lines.push(`La recomendación cambió: de «${was}» a «${now}».`);

  const documents = new Map((before.coverage || []).map(doc => [doc.id || fold(doc.name), doc]));
  const fresh = (after.coverage || []).filter(doc => !documents.has(doc.id || fold(doc.name)));
  if (fresh.length) lines.push(`${count(fresh.length, 'Leyó un documento nuevo', 'Leyó # documentos nuevos')}: ${named(fresh.map(doc => doc.name))}.`);
  const finished = (after.coverage || []).filter(doc => doc.status === 'read' && documents.get(doc.id || fold(doc.name))?.status === 'partial');
  if (finished.length) lines.push(`Terminó de leer ${named(finished.map(doc => doc.name))}.`);

  // A date moved when both versions name one and they are other days or hours: the same date written another way is not news.
  const datesBefore = reportKeyDates(before), datesAfter = reportKeyDates(after);
  const at = (text: string | null) => (text ? parseReportDate(text)?.at.getTime() ?? null : null);
  const moved = (from: string | null, to: string | null) => at(from) !== null && at(to) !== null && at(from) !== at(to);
  if (moved(datesBefore.closes, datesAfter.closes)) lines.push(`El cierre cambió: ahora ${datesAfter.closes} (antes ${datesBefore.closes}).`);
  if (moved(datesBefore.questions, datesAfter.questions)) lines.push(`Las consultas cierran ahora ${datesAfter.questions} (antes ${datesBefore.questions}).`);

  const requirements = new Set(before.requirements.map(item => fold(item.title)));
  const added = after.requirements.filter(item => !requirements.has(fold(item.title)));
  if (added.length) lines.push(`${count(added.length, 'Un requisito nuevo', '# requisitos nuevos')}: ${named(added.map(item => item.title))}.`);

  const questions = new Set(buyerQuestions(before).map(fold));
  const asked = buyerQuestions(after).filter(question => !questions.has(fold(question)));
  if (asked.length) lines.push(`${count(asked.length, 'Una pregunta nueva', '# preguntas nuevas')} para el comprador.`);

  const risks = new Set(before.risks.map(item => fold(item.title)));
  const serious = after.risks.filter(item => item.impact === 'high' && !risks.has(fold(item.title)));
  if (serious.length) lines.push(`${count(serious.length, 'Un riesgo nuevo de impacto alto', '# riesgos nuevos de impacto alto')}: ${named(serious.map(item => item.title), 1)}.`);

  return { since: humanDate(previous.created_at) ?? '', lines: lines.slice(0, 5) };
}
