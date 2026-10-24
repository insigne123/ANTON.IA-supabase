// «Prepara tu empresa» (OPP-05): what a workspace needs once to work tenders well, in a few steps the administrator sees until they are
// done. In production a month after it started: no document of the company, no competitor followed, no ticket of its own and nobody
// assigned, so the AI could not say «te falta el certificado X» and the search depended on the shared ticket. Pure: the server gives
// the facts, the page shows the steps.
import { COMPANY_DOCUMENT_KINDS, type CompanyDocumentKind } from './company-documents';

/** What almost every set of bases asks for: the five the step counts. */
export const ESSENTIAL_DOCUMENTS: CompanyDocumentKind[] = ['f30', 'f30_1', 'vigencia', 'poder', 'estados_financieros'];
/** What the server knows; null when it could not be read, and then that step is left out rather than asked for again. */
export type CompanySetupFacts = { documentKinds: string[]; competitors: number | null; assigned: boolean | null; ticket: 'own' | 'shared' | null };
export type SetupStepId = 'documents' | 'ticket' | 'assign' | 'competitors';
export type SetupStep = { id: SetupStepId; title: string; detail: string; done: boolean };

const listEs = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}` : items[0] || '');

/** The steps in the order they pay off: documents first (every report reads them), then the ticket, the first assignment and the competitors. */
export function companySetupSteps(facts: CompanySetupFacts): SetupStep[] {
  const have = ESSENTIAL_DOCUMENTS.filter(kind => facts.documentKinds.includes(kind));
  const missing = ESSENTIAL_DOCUMENTS.filter(kind => !have.includes(kind)).map(kind => COMPANY_DOCUMENT_KINDS[kind].label);
  const steps: Array<SetupStep | null> = [
    { id: 'documents', title: 'Sube los documentos que piden casi todas las bases', done: !missing.length,
      detail: missing.length ? `${have.length} de ${ESSENTIAL_DOCUMENTS.length}. Falta: ${listEs(missing)}.` : 'Están los cinco: te avisamos antes de que venzan.' },
    facts.ticket === null ? null : { id: 'ticket', title: 'Conecta el ticket de Mercado Público de tu empresa', done: facts.ticket === 'own',
      detail: facts.ticket === 'own' ? 'La búsqueda usa el ticket de tu empresa.' : 'Con el ticket compartido, la búsqueda depende de una cuota que usan todos.' },
    facts.assigned === null ? null : { id: 'assign', title: 'Asigna tu primera oportunidad', done: facts.assigned,
      detail: facts.assigned ? 'Tu equipo ya trabaja oportunidades.' : 'Quien la recibe la ve en «Mi trabajo» y le avisamos por correo.' },
    facts.competitors === null ? null : { id: 'competitors', title: 'Sigue a tus competidores', done: facts.competitors > 0,
      detail: facts.competitors > 0 ? `Sigues a ${facts.competitors === 1 ? '1 empresa' : `${facts.competitors} empresas`}.` : 'En «Mercado público», para ver qué ganan y a qué precio.' },
  ];
  return steps.filter((step): step is SetupStep => step !== null);
}
