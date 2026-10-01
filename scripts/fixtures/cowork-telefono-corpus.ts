// Revealing the phone of a saved contact (lead.enrich_phone, COWORK_PHONE_REVEAL_ENABLED): the one Cowork action with a price per person (ten
// credits), asked in the ways a person asks for a phone. The contacts are made up (the app is for any company). A phone is never invented:
// the provider delivers it later, so the reply may not carry a number, and several people are never one approval.
import { CORPUS_COMMON_CHECKS, corpusRead, corpusShown, type CorpusCase, type CorpusTurnResult } from './cowork-conversation-corpus';

export const PHONE_LEADS = {
  paula: '00000000-0000-4000-8000-000000000081',
  hugo: '00000000-0000-4000-8000-000000000082',
  sara: '00000000-0000-4000-8000-000000000083',
};
const lead = (id: string, name: string, title: string, company: string, slug: string) => ({
  id, name, title, company, email: `${slug}@${company.toLowerCase().replace(/[^a-z]+/g, '')}.cl`, status: 'saved', industry: 'Transporte',
  linkedin_url: `https://www.linkedin.com/in/${slug}`, location: 'Santiago', city: 'Santiago', country: 'Chile', created_at: '2026-09-20T15:00:00Z' });
const PEOPLE = [
  lead(PHONE_LEADS.paula, 'Paula Ríos', 'Gerenta de personas', 'Transportes del Sur', 'paula-rios'),
  lead(PHONE_LEADS.hugo, 'Hugo Mena', 'Jefe de operaciones', 'Transportes del Sur', 'hugo-mena'),
  lead(PHONE_LEADS.sara, 'Sara Lira', 'Directora comercial', 'Transportes del Sur', 'sara-lira'),
];

const world = (people: typeof PEOPLE): NonNullable<CorpusCase['world']> => ({
  read: (action, query) => action === 'leads.search' ? { items: people, returned: people.length, limit: 20, scope: 'own_saved_contacts', truncated: false, partial: false }
    : corpusRead(action, query),
  savedEmails: [],
});

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const shown = (result: CorpusTurnResult) => normalize(corpusShown(result));
const says = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.every(pattern => pattern.test(shown(result))) });
const saysAny = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.some(pattern => pattern.test(shown(result))) });
const avoids = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.every(pattern => !pattern.test(shown(result))) });
const reads = (label: string, action: string) => ({ label, test: (result: CorpusTurnResult) => result.actions.includes(action) });
const proposesFor = (id: string) => ({ label: 'propone pedir el teléfono de esa persona, con su tarjeta', test: (result: CorpusTurnResult) => result.proposal?.kind === 'enrich_phone' && result.proposal.targetId === id });
const noProposal = { label: 'no propone nada', test: (result: CorpusTurnResult) => !result.proposal && !result.search };
/** A phone number (Chilean mobile, with or without the country code or spaces) never appears: the provider has not answered. */
const noPhoneNumber = avoids('no escribe ningún número de teléfono', /(\+?56\s?9[\s\d]{8,12}|\b9\s?\d{4}\s?\d{4}\b|\b\d{9}\b)/);
const saysTheCost = says('dice que cuesta 10 créditos', /\b(10|diez)\b[^.]{0,30}credito|credito[^.]{0,30}\b(10|diez)\b/);

export const TELEFONO_CORPUS: CorpusCase[] = [
  { id: 'telefono-una-persona', title: 'Pedir el teléfono de una persona guardada', request: 'Necesito el teléfono de Paula Ríos, de Transportes del Sur',
    origin: 'Brecha 5 del banco AXIS (F1): revelar un teléfono estaba apagado en Cowork. Ahora lo propone con su tarjeta, el costo primero y sin inventar un número.',
    phoneReveal: true, world: world(PEOPLE),
    checks: [...CORPUS_COMMON_CHECKS,
      reads('busca a la persona entre los contactos guardados', 'leads.search'),
      proposesFor(PHONE_LEADS.paula),
      saysTheCost,
      noPhoneNumber,
      avoids('no promete que ya lo tiene ni que habrá uno', /(ya (tengo|tienes) (su|el) (telefono|numero)|su telefono es|seguro (que )?(habra|tiene))/)] },
  { id: 'telefono-varias-personas', title: 'Pedir el teléfono de varias personas', request: 'Dame el teléfono de las tres personas de Transportes del Sur',
    origin: 'Un teléfono cuesta 10 créditos por persona y se aprueba de a uno: con varias, Cowork propone la primera por su nombre y dice que cada una lleva su aprobación, sin teléfonos en lote.',
    phoneReveal: true, world: world(PEOPLE),
    checks: [...CORPUS_COMMON_CHECKS,
      reads('busca a las personas entre los contactos guardados', 'leads.search'),
      { label: 'propone una sola persona, no un lote', test: (result: CorpusTurnResult) => result.proposal?.kind === 'enrich_phone' && Object.values(PHONE_LEADS).includes(result.proposal.targetId as string) },
      saysTheCost,
      says('dice que cada una lleva su propia aprobación', /(cada (una|persona|telefono)|de a (una|uno)|una por una|uno por uno|por separado|individual)/),
      avoids('no suma un total que no pidió', /\b30\b[^.]{0,20}credito|credito[^.]{0,20}\b30\b/),
      noPhoneNumber] },
  { id: 'telefono-sin-flag', title: 'Pedir un teléfono sin que revelar teléfonos esté disponible', request: 'Necesito el teléfono de Paula Ríos, de Transportes del Sur',
    origin: 'Con el flag apagado (como está hoy) Cowork no propone: dice que no puede revelar teléfonos y ofrece lo que sí, su correo o escribirle por LinkedIn, sin inventar un número.',
    world: world(PEOPLE),
    checks: [...CORPUS_COMMON_CHECKS,
      noProposal,
      saysAny('dice que no puede revelar teléfonos todavía', /(no puedo|todavia no|aun no|no esta disponible)[^.]{0,60}(telefono|numero)/, /(telefono|numero)[^.]{0,60}(no (puedo|esta disponible)|todavia no|aun no)/),
      saysAny('ofrece lo que sí: su correo o escribirle por LinkedIn', /correo/, /linkedin/),
      noPhoneNumber] },
];
