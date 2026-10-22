// «Sello Empresa Mujer» in a report: whether the bases give points, a tie-break or a preference to companies led by women, and what
// the company's «Ficha para licitaciones» says about it. Pure: the report page and the tests share it.
import type { OpportunityReport } from './expedient';
import type { FemaleLedSeal } from './tender-profile';

// How the bases name it: the seal itself, «empresas lideradas por mujeres», or a gender criterion (ChileCompra's Directiva 20 suggests
// points or the tie-break for them).
const GENDER_CRITERION = /sello\s+(?:de\s+)?(?:empresa\s+)?mujer|empresas?\s+(?:lideradas?|dirigidas?|administradas?|de|con\s+liderazgo\s+de)\s+(?:por\s+)?mujeres|(?:enfoque|perspectiva|criterio|equidad|igualdad|brecha)\s+(?:de\s+)?g[eé]nero|mujeres\s+(?:emprendedoras|empresarias)|(?:emprendedora|empresaria)s?\s+mujeres?/i;

export type GenderCriterion = { where: string; sentence: string };
type ReportText = Pick<OpportunityReport, 'executive' | 'reasons' | 'sections' | 'requirements'>;

/** The first passage of a report where the bases value a company led by women, or null when they do not. */
export function genderCriterion(report: ReportText): GenderCriterion | null {
  const passages: Array<{ where: string; text: string }> = [
    ...report.sections.flatMap(section => [...section.paragraphs, ...section.facts.map(fact => fact.text)].map(text => ({ where: section.title, text }))),
    ...report.requirements.flatMap(requirement => [requirement.title, requirement.action].map(text => ({ where: 'Requisitos para postular', text }))),
    ...report.reasons.map(text => ({ where: 'Por qué', text })),
    { where: 'Resumen', text: report.executive },
  ];
  for (const { where, text } of passages) {
    const sentence = text.split(/(?<=[.;:])\s+|\n+/).find(part => GENDER_CRITERION.test(part));
    if (sentence) return { where, sentence: sentence.replace(/\s+/g, ' ').trim().slice(0, 280) };
  }
  return null;
}

export type SealNote = { tone: 'good' | 'ask' | 'neutral'; title: string; body: string };
/**
 * What the report says about the seal, only when the bases value it: a company that has it sees that it adds points; one that can ask
 * for it, that it must do so before the deadline; one that does not know, what to answer in its profile. Without that criterion, nothing.
 */
export function sealNote(criterion: GenderCriterion | null, seal: FemaleLedSeal | null): SealNote | null {
  if (!criterion) return null;
  const quote = `Las bases lo dicen en «${criterion.where}»: «${criterion.sentence}»`;
  if (!seal || seal.status === 'no_se') return { tone: 'ask', title: 'Esta licitación podría darte puntaje por ser una empresa liderada por mujeres',
    body: `${quote}. Para saber si lo sumas, responde en tu «Ficha para licitaciones» cuántos de tus representantes legales son mujeres, si la gerencia general la ejerce una mujer y qué parte de la propiedad es de mujeres.` };
  if (seal.status === 'si') return { tone: 'good', title: 'Sumas puntaje con el Sello Empresa Mujer',
    body: `${quote}. Según tu ficha: ${seal.because}. El sello lo asigna ChileCompra: antes del cierre, revisa que figure en tu perfil de proveedor.` };
  if (seal.status === 'solicitar') return { tone: 'ask', title: 'Puedes sumar puntaje, pero antes hay que pedir el Sello Empresa Mujer',
    body: `${quote}. Según tu ficha, ${seal.because}. Pídelo antes del cierre: no se suma solo.` };
  return { tone: 'neutral', title: 'Esta licitación da puntaje a empresas lideradas por mujeres, y tu ficha no cumple',
    body: `${quote}. Según tu ficha, ${seal.because}, así que ese puntaje no lo sumas.` };
}
