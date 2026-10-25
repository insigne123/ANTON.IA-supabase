import { NAV_SECTIONS } from '@/lib/navigation';

/**
 * ⌘K or Ctrl+K (APP-24): one box to go anywhere, look for something in the person's own data and ask Cowork, instead of opening the
 * right section first and using its own search. It reuses what exists: the menu entries the person can see, the searches of
 * Conversaciones, the Tabla de datos and Oportunidades (each reads `?q=` from the address), and Cowork, which gets the question
 * written and waits for the person to send it.
 */
export type PaletteAccess = { opportunities: boolean; cowork: boolean; admin: boolean };
export type PaletteItem = { id: string; group: 'Ir a' | 'Buscar en tus datos' | 'Preguntar a Cowork'; label: string; hint?: string; href: string };

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** The menu entries the person sees, in the menu's order, and the help. */
function destinations(access: PaletteAccess) {
  const entries = NAV_SECTIONS.flatMap(section => section.items
    .filter(item => item.feature !== 'opportunities' || access.opportunities)
    .filter(item => item.feature !== 'cowork' || access.cowork)
    .filter(item => item.feature !== 'admin-dashboard' || access.admin)
    .map(item => ({ label: item.label, href: item.href, section: section.label })));
  return [...entries, { label: 'Centro de ayuda', href: '/ayuda', section: 'Ayuda' }];
}

export function paletteItems(query: string, access: PaletteAccess): PaletteItem[] {
  const text = query.replace(/\s+/g, ' ').trim().slice(0, 200);
  const needle = fold(text);
  const go: PaletteItem[] = destinations(access)
    .filter(entry => !needle || fold(entry.label).includes(needle) || fold(entry.section).includes(needle))
    .map(entry => ({ id: `go:${entry.href}`, group: 'Ir a', label: entry.label, hint: entry.section, href: entry.href }));
  if (text.length < 2) return go;
  const q = encodeURIComponent(text);
  const search: PaletteItem[] = [
    { id: 'search:contacted', group: 'Buscar en tus datos', label: `«${text}» en Conversaciones`, hint: 'Nombre, correo, empresa o asunto', href: `/contacted?q=${q}` },
    { id: 'search:sheet', group: 'Buscar en tus datos', label: `«${text}» en la Tabla de datos`, hint: 'Todos tus contactos', href: `/sheet?q=${q}` },
    ...access.opportunities ? [{ id: 'search:opportunities', group: 'Buscar en tus datos' as const, label: `«${text}» en Oportunidades`, hint: 'Nombre, organismo o empresa', href: `/opportunities?vista=lista&q=${q}` }] : [],
  ];
  // Cowork is the last option: a question, not a place.
  const ask: PaletteItem[] = access.cowork && text.length >= 3
    ? [{ id: 'ask:cowork', group: 'Preguntar a Cowork', label: text, hint: 'Queda escrito en una conversación nueva; lo envías tú', href: `/cowork?pregunta=${q}` }]
    : [];
  return [...go, ...search, ...ask];
}

/** ⌘K on a Mac, Ctrl+K elsewhere; Cowork keeps its own ⌘K, which searches its conversations. */
export function isPaletteShortcut(event: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, mac: boolean, pathname: string | null) {
  if (event.altKey || event.shiftKey) return false;
  if (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return false;
  if (event.key.toLowerCase() !== 'k' && event.code !== 'KeyK') return false;
  return !String(pathname || '').startsWith('/cowork');
}
