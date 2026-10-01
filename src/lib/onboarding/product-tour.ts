/** Guided first-run tour: its steps, the status stored per person and when it
 * is offered on its own. Anyone can replay it from «Ver tutorial». */

/** Bump when the steps change enough to offer the tour again to new accounts. */
export const PRODUCT_TOUR_VERSION = 2;
/** Accounts younger than this are offered the tour once. */
export const PRODUCT_TOUR_NEW_ACCOUNT_DAYS = 30;
/** Key inside the Supabase user metadata. */
export const PRODUCT_TOUR_METADATA_KEY = 'anton_tour';

export type ProductTourStatus = 'completed' | 'skipped';
export type ProductTourRecord = { version: number; status: ProductTourStatus; updatedAt: string };

export type ProductTourStep = {
  id: string;
  /** `data-tour` value of the element to highlight. */
  target: string;
  /** Name of the menu entry, shown when the element is not on screen (mobile). */
  menuLabel?: string;
  title: string;
  body: string;
  /** Only on small screens, where the menu is folded behind its button. */
  mobileOnly?: boolean;
};

export const PRODUCT_TOUR_STEPS: ProductTourStep[] = [
  { id: 'menu', target: 'menu', mobileOnly: true, title: 'Todo está en este menú',
    body: 'Desde aquí llegas a cada parte de ANTON.IA. Te mostramos las más importantes.' },
  { id: 'home', target: 'home', menuLabel: 'Hoy', title: 'Empieza cada día aquí',
    body: '«Hoy» te dice qué hacer primero, quién te respondió y qué te falta para enviar tu primer correo.' },
  { id: 'profile', target: 'profile', menuLabel: 'Perfil', title: 'Cuéntanos qué vendes',
    body: 'Completa tu empresa, lo que ofreces y tu firma. ANTON.IA lo usa para escribir correos a tu medida.' },
  { id: 'connections', target: 'connections', menuLabel: 'Conexiones', title: 'Conecta tu correo',
    body: 'Vincula Gmail u Outlook para enviar desde tu propia cuenta y recibir las respuestas.' },
  { id: 'search', target: 'search', menuLabel: 'Buscar prospectos', title: 'Encuentra prospectos',
    body: 'Elige un punto de partida según lo que vendes, o pega un perfil de LinkedIn. Guarda a quienes te interesen.' },
  { id: 'saved-leads', target: 'saved-leads', menuLabel: 'Por escribir', title: 'Escríbeles',
    body: 'Aquí están tus contactos con correo: la IA prepara el borrador y tú lo revisas. Los que aún no tienen correo esperan en «Por completar».' },
  { id: 'contacted', target: 'contacted', menuLabel: 'Conversaciones', title: 'Sigue las respuestas',
    body: 'Quien responde aparece aquí y en «Hoy». Contestas en el mismo hilo, desde la app.' },
  { id: 'campaigns', target: 'campaigns', menuLabel: 'Campañas', title: 'Seguimientos y campañas',
    body: 'Programa seguimientos o una campaña para varios contactos a la vez. Nada sale sin tu aprobación.' },
  { id: 'help', target: 'tour-help', menuLabel: 'Ver tutorial', title: 'Ayuda en cada pantalla',
    body: 'El botón «?» de arriba te enseña a usar la pantalla en la que estás. Y aquí repites este recorrido.' },
];

export function productTourSteps(isMobile: boolean): ProductTourStep[] {
  return PRODUCT_TOUR_STEPS.filter(step => isMobile || !step.mobileOnly);
}

/** The stored record, or null when the person has not finished or skipped it. */
export function productTourRecord(metadata: unknown): ProductTourRecord | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>)[PRODUCT_TOUR_METADATA_KEY] as Partial<ProductTourRecord> | null | undefined;
  if (!value || typeof value !== 'object' || typeof value.version !== 'number') return null;
  if (value.status !== 'completed' && value.status !== 'skipped') return null;
  return { version: value.version, status: value.status, updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '' };
}

/** Offered on its own once, to new accounts that have not finished or skipped this version. */
export function shouldOfferProductTour(input: { record: ProductTourRecord | null; createdAt: string | null | undefined; now?: Date }): boolean {
  if (input.record && input.record.version >= PRODUCT_TOUR_VERSION) return false;
  const created = Date.parse(String(input.createdAt || ''));
  if (!Number.isFinite(created)) return false;
  // A clock slightly behind the database still counts a brand-new account as new.
  return (input.now || new Date()).getTime() - created <= PRODUCT_TOUR_NEW_ACCOUNT_DAYS * 86_400_000;
}

/** A short guide inside one screen: two to four spots on real controls, offered once on the first visit and replayed from «?». */
export type PageGuideStep = { id: string; target: string; title: string; body: string };
export type PageGuide = { id: string; title: string; routes: RegExp; steps: PageGuideStep[] };

/** Key inside the Supabase user metadata: the guides already seen or declined, by id. */
export const PAGE_GUIDES_METADATA_KEY = 'anton_guides';

export const PAGE_GUIDES: PageGuide[] = [
  { id: 'home', title: 'Hoy', routes: /^\/dashboard\/?$/, steps: [
    { id: 'today', target: 'today', title: 'Lo primero, siempre arriba',
      body: 'Una sola acción: quien te respondió, lo que te falta para enviar o a quién escribir hoy.' },
    { id: 'setup', target: 'setup', title: 'Prepara tu cuenta',
      body: 'Cuatro pasos comprobados. Cuando estén listos, ya puedes vender desde ANTON.IA.' },
  ] },
  { id: 'search', title: 'Buscar prospectos', routes: /^\/search\/?$/, steps: [
    { id: 'modes', target: 'search-modes', title: 'Tres formas de buscar',
      body: 'Por filtros (cargo, empresa, tamaño), por una empresa en particular o pegando un perfil de LinkedIn.' },
    { id: 'starters', target: 'search-starters', title: 'Parte sin pensar en filtros',
      body: 'Un punto de partida rellena cargos e industrias según lo que vendes. Puedes ajustarlos.' },
    { id: 'run', target: 'search-run', title: 'Busca y guarda',
      body: 'Primero eliges empresas y después personas. Marca a quienes te interesan y guárdalas.' },
  ] },
  { id: 'saved', title: 'Por completar', routes: /^\/saved\/leads\/?$/, steps: [
    { id: 'list', target: 'saved-list', title: 'Contactos sin correo',
      body: 'Selecciona a quienes quieras y busca su correo (usa créditos).' },
    { id: 'enriched', target: 'saved-enriched-link', title: 'Los que tienen correo, aquí',
      body: 'Al encontrar su correo pasan a «Por escribir». Desde ahí les escribes.' },
  ] },
  { id: 'enriched', title: 'Por escribir', routes: /^\/saved\/leads\/enriched\/?$/, steps: [
    { id: 'research', target: 'enriched-research', title: 'Investiga antes de escribir',
      body: 'Marca a quién investigar: la IA lee su empresa y su rol para que el correo no sea genérico.' },
    { id: 'contact', target: 'enriched-contact', title: 'Escríbeles',
      body: 'Marca a quién contactar: la IA prepara el correo y los seguimientos, y tú los revisas antes de enviar.' },
  ] },
  { id: 'conversations', title: 'Conversaciones', routes: /^\/contacted(\/replied)?\/?$/, steps: [
    { id: 'views', target: 'conv-views', title: 'Primero, quien te respondió',
      body: '«Por responder» junta a quienes esperan tu respuesta. Ábrelos y contesta en el mismo hilo.' },
    { id: 'sync', target: 'conv-sync', title: 'Trae respuestas nuevas',
      body: 'Con tu correo conectado se actualizan solas; este botón las trae en el momento.' },
  ] },
  { id: 'campaigns', title: 'Campañas', routes: /^\/campaigns\/?$/, steps: [
    { id: 'tabs', target: 'campaigns-tabs', title: 'Masivas o una por una',
      body: '«Campañas masivas» escribe a muchos con una sola aprobación; «Seguimientos individuales» revisa cada correo.' },
  ] },
  { id: 'crm', title: 'Pipeline', routes: /^\/crm\/?$/, steps: [
    { id: 'board', target: 'crm-board', title: 'Cada contacto, en su etapa',
      body: 'Arrastra a cada contacto según avanza: contactado, interesado, reunión, negociación, ganado.' },
  ] },
  { id: 'profile', title: 'Perfil', routes: /^\/profile\/?$/, steps: [
    { id: 'company', target: 'profile-company', title: 'Tu empresa',
      body: 'Nombre y sitio web. Con eso la IA sabe a quién representa cada correo.' },
    { id: 'offer', target: 'profile-offer', title: 'Lo que vendes',
      body: 'Propuesta de valor, servicios y pruebas. La IA los usa en cada borrador: mientras más concreto, mejor.' },
  ] },
  { id: 'connections', title: 'Conexiones', routes: /^\/connections\/?$/, steps: [
    { id: 'list', target: 'connections-list', title: 'Conecta Gmail u Outlook',
      body: 'Los correos salen desde tu cuenta y las respuestas vuelven a ANTON.IA solas.' },
  ] },
];

export function pageGuideFor(pathname?: string | null): PageGuide | null {
  const path = String(pathname || '');
  return PAGE_GUIDES.find((guide) => guide.routes.test(path)) || null;
}

/** The guides stored as seen, from the user metadata; anything malformed counts as none. */
export function seenPageGuides(metadata: unknown): Record<string, true> {
  if (!metadata || typeof metadata !== 'object') return {};
  const value = (metadata as Record<string, unknown>)[PAGE_GUIDES_METADATA_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const known = new Set(PAGE_GUIDES.map((guide) => guide.id));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([id, seen]) => known.has(id) && seen === true)
    .map(([id]) => [id, true as const]));
}

