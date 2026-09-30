// Approving several people on LinkedIn with one decision (COWORK_LINKEDIN_BATCH_ENABLED on): the saved contacts with their profile, the
// weekly quota and the requests that should become one batch card, one single action or no proposal at all. The proposal goes through the
// same planning the server applies (corpusStageLinkedinBatch), so what is checked is what the card would list: who goes today, with the
// text each one gets, and who waits for another day and why. Nothing is queued: a proposal is not a send.
import { CORPUS_COMMON_CHECKS, corpusRead, corpusShown, type CorpusCase, type CorpusTurnResult } from './cowork-conversation-corpus';

const L = (n: number) => `00000000-0000-4000-8000-0000000000b${n}`;
export const BATCH_IDS = { marcela: L(1), gerardo: L(2), hector: L(3), ana: L(4), ivan: L(5), paz: L(6) };

const saved = (n: number, name: string, title: string, company: string, email: string, slug: string | null) => ({
  id: L(n), name, title, company, email, status: 'saved', industry: null, location: 'Santiago, Chile', domain: email.split('@')[1], employees: null,
  linkedin_url: slug ? `https://www.linkedin.com/in/${slug}` : null,
});
export const BATCH_SAVED = [
  saved(1, 'Marcela Rojas', 'Gerente de RR. HH.', 'Servicios Norte', 'mrojas@sernorte.cl', 'marcela-rojas'),
  saved(2, 'Gerardo Paz', 'Subgerente', 'Servicios Norte', 'gpaz@sernorte.cl', 'gerardo-paz'),
  saved(3, 'Héctor Vidal', 'Jefe de Personal', 'Casino Central', 'hvidal@casinocentral.cl', 'hector-vidal'),
  saved(4, 'Ana Ruiz', 'Analista de Selección', 'Alimentos del Valle', 'aruiz@delvalle.cl', 'ana-ruiz'),
  saved(5, 'Iván Herrera', 'Gerente', 'Servicios Integrales', 'iherrera@servintegrales.cl', 'ivan-herrera'),
  saved(6, 'Paz Soto', 'Jefa de Operaciones', 'Transportes Sur', 'psoto@transportessur.cl', null),
];

const searchOf = (query: string) => {
  const term = query.toLowerCase().trim();
  const words = term.split(/\s+/).filter(word => word.length > 2);
  const items = !words.length ? BATCH_SAVED : BATCH_SAVED.filter(lead => [lead.name, lead.title, lead.company, lead.email]
    .some(value => String(value || '').toLowerCase().split(/\s+/).some(part => words.some(word => part.includes(word)))));
  return { items, returned: items.length, limit: 20, scope: 'own_saved_contacts', truncated: false, partial: false };
};

const world = (): NonNullable<CorpusCase['world']> => ({
  read: (action, query) => action === 'leads.search' ? searchOf(query)
    : action === 'leads.get' ? { items: BATCH_SAVED.filter(lead => lead.id === query), returned: 1, limit: 1, scope: 'own_saved_contacts', truncated: false }
      : action === 'linkedin.quota' ? { scope: 'own_linkedin_quota', pending: 8, sent7d: 12, limit: 100, windowDays: 7, allowed: true, reason: 'Cupo disponible (20/100).',
        limitation: 'Límite operativo observado en cuentas gratuitas, no oficial de LinkedIn.' }
        : corpusRead(action, query),
  savedEmails: [],
});

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const shown = (result: CorpusTurnResult) => normalize(corpusShown(result));
const says = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.every(pattern => pattern.test(shown(result))) });
const saysAny = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.some(pattern => pattern.test(shown(result))) });
const avoids = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.every(pattern => !pattern.test(shown(result))) });
const batchOf = (result: CorpusTurnResult) => result.proposal?.linkedinBatch ?? null;
const proposes = (label: string, kind: string) => ({ label, test: (result: CorpusTurnResult) => result.proposal?.kind === kind });
const everyone = (result: CorpusTurnResult) => { const batch = batchOf(result); return batch ? [...batch.items, ...batch.deferred] : []; };
const companyOf = (id: string) => BATCH_SAVED.find(lead => lead.id === id)?.company;

const readsFirst = (action: string) => ({ label: `consulta ${action} antes de proponer`, test: (result: CorpusTurnResult) => result.actions.includes(action) });
/** The approval card is where the person decides: the answer says so and never says it already went. */
const leavesItToApproval = saysAny('dice que lo revisas o lo apruebas en la tarjeta antes de que salga', /(aprueb|aprobar|aprobarlo|tarjeta)/);
const noSendYet = avoids('no dice que ya se enviaron ni que ya salieron', /\b(ya (se )?(las? |los? )*(envie|envio|mande|salio|salieron|enviaron)|quedaron? enviad[oa]s?|fueron? enviad[oa]s?|se enviaron)\b/);
/** How many go is the server's to say: the card shows it, and a figure in the reply could contradict it. */
const noCount = avoids('no dice cuántas salen: lo fija el servidor y lo muestra la tarjeta', /\b(\d+|una|dos|tres|cuatro|cinco|seis)\s+(invitaciones|mensajes|personas)\s+(saldran|saldrian|van a salir|quedan en cola|iran|van)\b/);
const oneProposal = { label: 'propone una sola cosa: ni búsqueda ni otra acción', test: (result: CorpusTurnResult) => !result.search && Boolean(result.proposal) };

const INVITE_REQUEST = 'invita por LinkedIn a mis contactos guardados que tengan perfil';
const MESSAGE_REQUEST = 'escríbeles por LinkedIn a Marcela Rojas, Héctor Vidal y Ana Ruiz: que gracias por aceptar y si les sirve una llamada corta esta semana';

export const BATCH_CORPUS: CorpusCase[] = [
  { id: 'lote-invitar', title: 'Invitar por LinkedIn a varias personas con una sola aprobación', request: INVITE_REQUEST,
    origin: 'Aprobar en lote (AXIS E3): un pedido de varias invitaciones es un solo lote con su tarjeta, no una tarjeta por persona; el servidor deja para otro día a quien comparte empresa y cuida el cupo.',
    world: world(), linkedinBatch: true,
    checks: [...CORPUS_COMMON_CHECKS,
      readsFirst('leads.search'),
      readsFirst('linkedin.quota'),
      proposes('propone un lote de invitaciones, no una por persona', 'linkedin_invite_batch'),
      { label: 'cubre a las personas con perfil, una de cada empresa como mínimo', test: result => {
        const companies = new Set(everyone(result).map(person => companyOf(person.id)));
        return ['Servicios Norte', 'Casino Central', 'Alimentos del Valle', 'Servicios Integrales'].every(company => companies.has(company));
      } },
      { label: 'no incluye a quien no tiene perfil de LinkedIn guardado', test: result => Boolean(batchOf(result)) && !everyone(result).some(person => person.id === BATCH_IDS.paz) },
      { label: 'sale una persona por empresa hoy y la otra de la misma empresa espera con su motivo', test: result => {
        const batch = batchOf(result);
        if (!batch) return false;
        const today = batch.items.map(item => item.company);
        return new Set(today).size === today.length && batch.deferred.every(person => /empresa/.test(normalize(person.reason)));
      } },
      leavesItToApproval,
      noSendYet,
      noCount,
      oneProposal] },
  { id: 'lote-mensajes', title: 'Escribir por LinkedIn a varias personas, cada una con su texto', request: MESSAGE_REQUEST,
    origin: 'Aprobar en lote (AXIS E4): un mensaje por persona, con sus datos, en un solo lote; nada de textos iguales ni de placeholders.',
    world: world(), linkedinBatch: true,
    checks: [...CORPUS_COMMON_CHECKS,
      readsFirst('leads.search'),
      proposes('propone un lote de mensajes, no uno por persona', 'linkedin_message_batch'),
      { label: 'es para las tres personas pedidas, y solo ellas', test: result => {
        const ids = everyone(result).map(person => person.id).sort();
        return JSON.stringify(ids) === JSON.stringify([BATCH_IDS.marcela, BATCH_IDS.hector, BATCH_IDS.ana].sort());
      } },
      { label: 'cada mensaje nombra a su persona', test: result => { const batch = batchOf(result); return Boolean(batch) && batch!.items.every(item => normalize(String(item.message || '')).includes(normalize(String(item.name || '').split(' ')[0]))); } },
      { label: 'cada mensaje es distinto', test: result => { const batch = batchOf(result); return Boolean(batch) && new Set(batch!.items.map(item => item.message)).size === batch!.items.length; } },
      { label: 'ningún mensaje deja un marcador por completar ni pide el dato de otra persona', test: result => { const batch = batchOf(result); return Boolean(batch) && batch!.items.every(item => !/\[[^\]]*\]|\{\{|\}\}/.test(String(item.message || ''))); } },
      { label: 'cada mensaje va firmado con el nombre real de quien escribe', test: result => { const batch = batchOf(result); return Boolean(batch) && batch!.items.every(item => /nicolas/.test(normalize(String(item.message || '')))); } },
      { label: 'cada mensaje es breve: hasta 600 caracteres', test: result => { const batch = batchOf(result); return Boolean(batch) && batch!.items.every(item => String(item.message || '').length > 0 && String(item.message || '').length <= 600); } },
      { label: 'ningún mensaje promete precio ni plazo', test: result => { const batch = batchOf(result); return Boolean(batch) && batch!.items.every(item => !/\$\s?\d|\b\d[\d.,]*\s?(usd|clp|uf|pesos)\b/i.test(String(item.message || ''))); } },
      leavesItToApproval,
      noSendYet,
      noCount,
      oneProposal] },
  { id: 'lote-una-persona', title: 'Una sola persona no es un lote', request: 'invita a Héctor Vidal por LinkedIn',
    origin: 'Aprobar en lote: con el lote encendido, pedir una sola persona sigue siendo la acción individual.',
    world: world(), linkedinBatch: true,
    checks: [...CORPUS_COMMON_CHECKS,
      readsFirst('leads.search'),
      proposes('propone la invitación individual, no un lote', 'linkedin_invite'),
      leavesItToApproval,
      noSendYet,
      oneProposal] },
  { id: 'lote-sin-perfil', title: 'Invitar a quien no tiene perfil de LinkedIn guardado', request: 'invita a Paz Soto por LinkedIn',
    origin: 'Aprobar en lote: sin URL de perfil no hay invitación posible; se dice y no se propone nada.',
    world: world(), linkedinBatch: true,
    checks: [...CORPUS_COMMON_CHECKS,
      readsFirst('leads.search'),
      { label: 'no propone ninguna invitación', test: result => !result.proposal && !result.search },
      says('nombra a Paz Soto', /paz/),
      saysAny('dice que no tiene perfil de LinkedIn guardado', /(no tiene|sin|falta)[^.]{0,40}(perfil|linkedin|url)/, /(perfil|linkedin|url)[^.]{0,40}(no (esta|figura|tiene)|falta|sin)/),
      saysAny('ofrece otra vía: escribirle por correo', /(correo|email|mail)/),
      noSendYet] },
];
