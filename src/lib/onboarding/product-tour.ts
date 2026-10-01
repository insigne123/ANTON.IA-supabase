/** Guided first-run tour: it walks the person through every screen of the app, opening each one and pointing at its real
 * controls. Its steps, the status stored per person and when it is offered on its own. Anyone can replay it from «Ver
 * tutorial» (docs/ui-ux/ayuda-y-manual.md). */

/** Bump when the steps change enough to offer the tour again to new accounts. */
export const PRODUCT_TOUR_VERSION = 3;
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
  /** Screen the step is on: the tour opens it first. Without one, the step stays on the screen on view. */
  route?: string;
  /** Part of the app the step is in, shown next to the progress («Paso 3 de 15 · Perfil»). */
  section?: string;
  /** Name of the menu entry, shown when the element is not on screen (the folded menu on phones). */
  menuLabel?: string;
  title: string;
  body: string;
  /** Only on small screens, where the menu is folded behind its button. */
  mobileOnly?: boolean;
};

/** The path to a first email, screen by screen, and then where help lives. Each page step is anchored on a real control. */
export const PRODUCT_TOUR_STEPS: ProductTourStep[] = [
  { id: 'menu', target: 'menu', mobileOnly: true, section: 'Menú', title: 'Todo está en este menú',
    body: 'Desde aquí llegas a cada pantalla. Ahora te llevamos por cada una y te mostramos cómo se usa.' },
  { id: 'today', target: 'today', route: '/dashboard', section: 'Hoy', title: 'Empieza cada día aquí',
    body: 'Una sola acción, la más importante: a quién responder, qué te falta para enviar o a quién escribir hoy.' },
  { id: 'setup', target: 'setup', route: '/dashboard', section: 'Hoy', title: 'Prepara tu cuenta',
    body: 'Cuatro pasos comprobados: perfil, correo conectado, primeros contactos y primer envío. Cada uno trae su enlace.' },
  { id: 'profile-ai', target: 'profile-ai', route: '/profile', section: 'Perfil', title: 'Cuéntanos qué vendes',
    body: 'Escribe el sitio de tu empresa: la IA propone qué vendes y a quién, con su fuente. Tú eliges qué guardar.' },
  { id: 'profile-offer', target: 'profile-offer', route: '/profile', section: 'Perfil', title: 'La IA solo dice lo que está aquí',
    body: 'Servicios, propuesta de valor, problemas que resuelves y pruebas. Sin tu oferta, la IA no puede redactar.' },
  { id: 'connections', target: 'connections-list', route: '/connections', section: 'Conexiones', title: 'Conecta tu correo',
    body: 'Gmail u Outlook: los correos salen desde tu cuenta y las respuestas vuelven solas a la app.' },
  { id: 'search-modes', target: 'search-modes', route: '/search', section: 'Buscar prospectos', title: 'Tres formas de buscar',
    body: 'Por filtros (cargo, sector, tamaño), dentro de una empresa o pegando un perfil de LinkedIn.' },
  { id: 'search-starters', target: 'search-starters', route: '/search', section: 'Buscar prospectos', title: 'Parte de lo que vendes',
    body: 'Un punto de partida rellena cargos e industrias. Busca, marca a quienes te interesan y guárdalos.' },
  { id: 'saved', target: 'saved-list', route: '/saved/leads', section: 'Por completar', title: 'Busca su correo',
    body: 'Aquí llegan tus guardados sin correo. Selecciónalos y pulsa «Buscar correo»: pasan a «Por escribir».' },
  { id: 'enriched-research', target: 'enriched-research', route: '/saved/leads/enriched', section: 'Por escribir',
    title: 'Investiga antes de escribir',
    body: 'Marca a quién investigar: la IA lee su empresa y su rol para que el correo no sea genérico.' },
  { id: 'enriched-contact', target: 'enriched-contact', route: '/saved/leads/enriched', section: 'Por escribir',
    title: 'La IA prepara, tú envías',
    body: '«Contactar» prepara el correo y sus seguimientos. Los revisas, confirmas y pulsas «Enviar ahora».' },
  { id: 'conversations', target: 'conv-views', route: '/contacted', section: 'Conversaciones', title: 'Responde a quien te escribió',
    body: '«Por responder» junta a quienes esperan tu respuesta. Contestas en el mismo hilo, desde la app.' },
  { id: 'campaigns', target: 'campaigns-tabs', route: '/campaigns', section: 'Campañas', title: 'Escribe a un grupo',
    body: 'Hasta 100 contactos con una sola aprobación. Los seguimientos se detienen si la persona responde.' },
  { id: 'pipeline', target: 'crm-board', route: '/crm', section: 'Pipeline', title: 'Cada contacto, en su etapa',
    body: 'Mueve a cada contacto según avanza: contactado, interesado, reunión, negociación y ganado.' },
  { id: 'page-help', target: 'page-help', section: 'Ayuda', title: 'Ayuda en cada pantalla',
    body: 'El botón «?» explica la pantalla en la que estás, con preguntas frecuentes y una IA que responde tus dudas.' },
  { id: 'help-center', target: 'help-center', menuLabel: 'Centro de ayuda', section: 'Ayuda', title: 'El manual completo',
    body: 'En «Centro de ayuda» está todo, con buscador. «Ver tutorial» repite este recorrido cuando quieras.' },
];

export function productTourSteps(isMobile: boolean): ProductTourStep[] {
  return PRODUCT_TOUR_STEPS.filter(step => isMobile || !step.mobileOnly);
}

/** Whether the screen on view is the one a step is on. */
export function onTourRoute(pathname: string | null | undefined, route: string) {
  const clean = (value: string) => value.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return clean(String(pathname || '')) === clean(route);
}

/** The screen guides the tour walks through: after finishing it, they are not offered again on their own. */
export function pageGuidesInTour(steps: ProductTourStep[] = PRODUCT_TOUR_STEPS): string[] {
  return [...new Set(steps.flatMap((step) => {
    const guide = step.route ? pageGuideFor(step.route) : null;
    return guide ? [guide.id] : [];
  }))];
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
    { id: 'ai', target: 'profile-ai', title: 'Complétalo con IA',
      body: 'Escribe el sitio de tu empresa: la IA propone cada campo con la página de donde lo sacó, y tú eliges qué guardar.' },
    { id: 'offer', target: 'profile-offer', title: 'Lo que vendes',
      body: 'Servicios, propuesta de valor y pruebas. La IA solo afirma lo que está aquí: mientras más concreto, mejor.' },
    { id: 'icp', target: 'profile-icp', title: 'Tu cliente ideal',
      body: 'Cargos, industrias y tamaño. «Buscar prospectos» los usa como punto de partida.' },
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

