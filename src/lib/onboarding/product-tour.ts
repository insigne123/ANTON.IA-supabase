/** Guided first-run tour: its steps, the status stored per person and when it
 * is offered on its own. Anyone can replay it from «Ver tutorial». */

/** Bump when the steps change enough to offer the tour again to new accounts. */
export const PRODUCT_TOUR_VERSION = 1;
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
  { id: 'profile', target: 'profile', menuLabel: 'Perfil', title: 'Cuéntanos qué vendes',
    body: 'Completa tu empresa, lo que ofreces y tu firma. ANTON.IA lo usa para escribir correos a tu medida.' },
  { id: 'connections', target: 'connections', menuLabel: 'Conexiones', title: 'Conecta tu correo',
    body: 'Vincula Gmail u Outlook para enviar desde tu propia cuenta y recibir las respuestas.' },
  { id: 'search', target: 'search', menuLabel: 'Búsqueda de Leads', title: 'Encuentra prospectos',
    body: 'Busca personas por cargo, industria y ubicación, y guarda las que quieras trabajar.' },
  { id: 'saved-leads', target: 'saved-leads', menuLabel: 'Guardados · Leads', title: 'Prepara tus contactos',
    body: 'Completa sus correos e investiga a cada persona antes de escribirle.' },
  { id: 'campaigns', target: 'campaigns', menuLabel: 'Campañas', title: 'Escribe y envía',
    body: 'Arma tus secuencias de correo, revisa a quién le llegan y decide cuándo activarlas.' },
  { id: 'contacted', target: 'contacted', menuLabel: 'Leads Contactados', title: 'Sigue las respuestas',
    body: 'Mira quién respondió y qué seguimiento toca con cada persona.' },
  { id: 'antonia', target: 'antonia', menuLabel: 'Agente ANTON.IA', title: 'Deja que el agente trabaje',
    body: 'Crea misiones para que ANTON.IA busque, investigue y contacte por ti, con los límites diarios que tú fijes.' },
  { id: 'help', target: 'tour-help', menuLabel: 'Ver tutorial', title: 'Listo para empezar',
    body: 'Te recomendamos partir por tu perfil. Si quieres repasar, vuelve a ver este recorrido desde aquí.' },
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