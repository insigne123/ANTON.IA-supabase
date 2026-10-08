// The reads that close the gaps of the AXIS bank (docs/cowork-banco-axis.md, gaps 6, 7 and 10): an exact count of a segment
// (leads.count), the invitations that still wait for an answer (linkedin.quota) and the company of the second-contact candidates
// (linkedin.followups). Each world is the shape the app returns, with a made-up account: the app is for any company.
import { CORPUS_COMMON_CHECKS, corpusRead, corpusShown, type CorpusCase, type CorpusTurnResult } from './cowork-conversation-corpus';

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const shown = (result: CorpusTurnResult) => normalize(corpusShown(result));
const says = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.every(pattern => pattern.test(shown(result))) });
const avoids = (label: string, ...patterns: RegExp[]) => ({ label, test: (result: CorpusTurnResult) => patterns.every(pattern => !pattern.test(shown(result))) });
const readsOnly = (label: string, action: string) => ({ label, test: (result: CorpusTurnResult) => result.actions.length === 1 && result.actions[0] === action });
const noEffect = { label: 'no propone nada sin tu aprobación ni envía', test: (result: CorpusTurnResult) => !result.proposal && !result.search };
const world = (reads: Record<string, unknown>): NonNullable<CorpusCase['world']> => ({
  read: (action, query) => action in reads ? reads[action] : corpusRead(action, query), savedEmails: [] });

const COUNT = { scope: 'own_saved_contacts', phrases: ['reclutador', 'recursos humanos', 'talent'], exact: true, total: 214, withEmail: 180, withoutEmail: 34, withLinkedinProfile: 150,
  matchedIn: ['title', 'company', 'industry'], limitation: 'Cuenta por texto en cargo, empresa y sector de tus contactos guardados; un cargo escrito de otra forma no entra. Los conteos son exactos, pero «quiénes son» se ve con leads.search.' };
const QUOTA = { scope: 'own_linkedin_quota', pending: 4, sent7d: 18, limit: 100, allowed: true, remaining: 78, reason: 'Cupo disponible: quedan 78 de 100 esta semana (22 usadas entre pendientes y enviadas de 7 días).', windowDays: 7,
  awaitingAcceptance: { count: 61, sentFromApp: 70, windowDays: 30, networkSynced: true, basis: 'Invitaciones confirmadas desde ANTON.IA cuyo perfil no aparece entre tus conexiones observadas.' },
  limitation: 'Límite operativo observado en cuentas gratuitas, no oficial de LinkedIn. Las invitaciones que enviaste directo en LinkedIn no se ven desde aquí: si sabes cuántas pendientes ves en LinkedIn («Mi red» → «Invitaciones» → «Enviadas»), dímelo y lo uso.' };
const followup = (name: string, slug: string, company: string | null) => ({ canonicalUrl: `https://www.linkedin.com/in/${slug}`, displayName: name, lastConfirmedAt: '2026-09-10T12:00:00Z',
  daysSince: 15, eligible: true, blockedBy: [], requiresNewInformation: true, cooldownDays: 7, company });
const FOLLOWUPS = { scope: 'own_linkedin_followups', returned: 4, items: [followup('Paula Ríos', 'paula-rios', 'Transportes del Sur'), followup('Hugo Mena', 'hugo-mena', 'Transportes del Sur'),
  followup('Sara Lira', 'sara-lira', 'Minera Norte'), followup('Tomás Vega', 'tomas-vega', null)],
  limitation: 'Elegibilidad base sin el contenido nuevo: el segundo mensaje debe aportar información distinta, verificada en su revisión.' };

const CREDITS = { scope: 'shared_provider_credits', available: true, remaining: 1840, used: 660, limit: 2500, cycleEnd: '2026-10-15T00:00:00Z', capturedAt: '2026-09-25T12:00:00Z',
  stale: false, ageHours: 1, costs: { emailEnrichment: 1, phoneEnrichment: 10 }, affords: { emailEnrichments: 1840, phoneReveals: 184 },
  limitation: 'Saldo compartido de la cuenta de créditos, tomado de la última lectura: si tiene más de unas horas (stale), dilo y no lo presentes como exacto. Un crédito alcanza para el correo de un contacto; revelar un teléfono cuesta diez.' };

export const LECTURAS_CORPUS: CorpusCase[] = [
  { id: 'lectura-contar-segmento', title: 'Cuántos contactos de un rol tengo guardados', request: '¿Cuántos reclutadores tengo guardados?',
    origin: 'Brecha 7 del banco AXIS (A1): «cuántos hay entre 2.512 contactos» no se puede contar con una búsqueda que se corta en 20; leads.count da el número exacto.',
    world: world({ 'leads.count': COUNT }),
    checks: [...CORPUS_COMMON_CHECKS,
      readsOnly('cuenta con una sola lectura exacta', 'leads.count'),
      says('da el número exacto: 214, de los cuales 180 tienen correo', /\b214\b/, /\b180\b/),
      avoids('no dice que son 20 (lo que lista la búsqueda)', /\b20\b[^.]{0,30}(reclut|contact)|(reclut|contact)[^.]{0,30}\b20\b/),
      says('dice que cuenta por texto en el cargo, la empresa y el sector', /(cargo|texto)/),
      noEffect] },
  { id: 'lectura-cupo-pendientes', title: 'Cupo de invitaciones con las que siguen sin aceptar', request: '¿Cuántas invitaciones de LinkedIn puedo mandar hoy?',
    origin: 'Brecha 6 del banco AXIS (E3): el cupo contaba solo la cola de ANTON.IA; ahora dice cuántas enviadas desde la app siguen sin aceptar y qué no ve.',
    world: world({ 'linkedin.quota': QUOTA }),
    checks: [...CORPUS_COMMON_CHECKS,
      readsOnly('lee el cupo en una sola lectura', 'linkedin.quota'),
      says('separa pendientes (4) y enviadas (18) sin mezclarlas', /\b4\b[^.]{0,30}pendiente/, /\b18\b[^.]{0,30}enviada/),
      says('dice que hay al menos 61 sin aceptar, enviadas desde ANTON.IA', /\b61\b/, /(sin acepta|sin respuesta|esperan|pendientes de aceptar|no (?:aparecen|figuran|est[aá]n) aceptadas)/),
      // Plan 15: «22/100» was read as 22 left; what is left is 78.
      says('dice que le quedan 78', /\b78\b/),
      says('dice que lo enviado directo en LinkedIn no lo ve', /(directo|directamente|fuera de anton)/),
      avoids('no dice «se usaron 22»', /se usaron|se han usado/),
      noEffect] },
  { id: 'lectura-seguimiento-empresa', title: 'Segundo contacto por LinkedIn sin repetir empresa', request: '¿A quién le hago seguimiento por LinkedIn esta semana? Una persona por empresa.',
    origin: 'Brecha 10 del banco AXIS (E5): los candidatos no traían la empresa; ahora sí (null si no está entre los guardados) y se elige una por empresa.',
    world: world({ 'linkedin.followups': FOLLOWUPS }),
    checks: [...CORPUS_COMMON_CHECKS,
      readsOnly('lee los candidatos en una sola lectura', 'linkedin.followups'),
      says('nombra a Paula y a Sara, una por empresa', /paula/, /sara/),
      { label: 'no propone a Hugo: es de la misma empresa que Paula', test: result => !/hugo/.test(shown(result)) || /(misma empresa|otro dia|otra semana|despues|queda|proxima|siguiente)/.test(shown(result)) },
      says('dice que de Tomás no conoce la empresa y no la adivina', /tomas/, /(no (se|conozco|tengo)[^.]{0,40}empresa|sin empresa|empresa (no|desconocida)|empresa[^.]{0,30}no (aparece|esta|figura))/),
      noEffect] },
  { id: 'lectura-saldo-creditos', title: 'Saldo de créditos y si alcanza para enriquecer', request: '¿Cuántos créditos me quedan y me alcanzan para buscar el correo de 120 contactos?',
    origin: 'Brecha 5 del banco AXIS (A4, F1): no había saldo de créditos; credits.balance da lo que queda, lo que cuesta cada cosa y cuánto alcanza.',
    world: world({ 'credits.balance': CREDITS }),
    checks: [...CORPUS_COMMON_CHECKS,
      readsOnly('lee el saldo en una sola lectura', 'credits.balance'),
      says('da el saldo tal cual: 1.840 créditos', /1\.?840/),
      says('responde que sí alcanza para 120 correos (un crédito cada uno)', /\b120\b/, /(alcanza|alcanzan|sobra|de sobra|si puedes|si te alcanza)/),
      avoids('no dice que no alcanza', /no (te )?alcanza/),
      says('dice que revelar un teléfono cuesta diez', /\b(10|diez)\b[^.]{0,40}(credito|telefono)|(telefono)[^.]{0,60}\b(10|diez)\b/),
      noEffect] },
];
