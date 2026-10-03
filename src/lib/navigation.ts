import type { LucideIcon } from 'lucide-react';
import {
  Bot, Briefcase, LayoutDashboard, LayoutGrid, Link2, MailCheck, Megaphone, Search, Send, Settings, Shield, ShieldCheck,
  Table as TableIcon, User, Users,
} from 'lucide-react';

export type NavFeature = 'opportunities' | 'admin-dashboard' | 'cowork';

export type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  aliases?: string[];
  feature?: NavFeature;
  /** Step of the guided tour that highlights this entry. */
  tour?: string;
  /** Active only on its own path, not on the paths below it (/saved/leads vs /saved/leads/enriched). */
  exact?: boolean;
};

export type NavSection = { label: string; items: NavItem[] };

/** Grouped by what the person is doing, in the order of the work: today, find people, the people to write to, follow-up.
 * Labels say the state of a contact («Por escribir»: has an email; «Por completar»: still needs one) instead of the table it
 * lives in, so a contact that gets its email does not seem to vanish (H01, H14 of the GrupoExpro walkthrough). */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Centro de mando',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Hoy', tour: 'home' },
      { href: '/cowork', icon: Bot, label: 'Cowork', feature: 'cowork' },
    ],
  },
  {
    label: 'Prospectar',
    items: [
      { href: '/search', icon: Search, label: 'Buscar prospectos', tour: 'search' },
      { href: '/opportunities', icon: Briefcase, label: 'Oportunidades', feature: 'opportunities' },
    ],
  },
  {
    label: 'Contactos',
    items: [
      { href: '/saved/leads/enriched', icon: MailCheck, label: 'Por escribir', tour: 'saved-leads' },
      { href: '/saved/leads', icon: Users, label: 'Por completar', exact: true },
      { href: '/sheet', label: 'Tabla de datos', icon: TableIcon, aliases: ['/leads/import'] },
    ],
  },
  {
    label: 'Seguimiento',
    items: [
      { href: '/contacted', icon: Send, label: 'Conversaciones', tour: 'contacted' },
      { href: '/campaigns', icon: Megaphone, label: 'Campañas', tour: 'campaigns' },
      { href: '/crm', label: 'Pipeline', icon: LayoutGrid },
    ],
  },
  {
    label: 'Administración',
    items: [
      { href: '/dashboard/admin', icon: ShieldCheck, label: 'Administración', feature: 'admin-dashboard' },
    ],
  },
  {
    label: 'Configuración',
    items: [
      { href: '/profile', icon: User, label: 'Perfil', tour: 'profile' },
      { href: '/connections', icon: Link2, label: 'Conexiones', aliases: ['/gmail', '/outlook'], tour: 'connections' },
      { href: '/settings/email-studio', icon: Settings, label: 'Firmas y estilo' },
      {
        href: '/settings/privacy',
        icon: Shield,
        label: 'Privacidad',
        aliases: ['/settings/unsubscribes', '/settings/privacy-requests', '/settings/privacy-incidents'],
      },
    ],
  },
];

/** Screens outside the menu, opened from several places, named in the phone's top bar. */
const SCREEN_LABELS: Array<{ href: string; label: string }> = [
  { href: '/contact/compose', label: 'Redactar correo' },
  { href: '/contact/sequence', label: 'Secuencia' },
  { href: '/research', label: 'Investigación' },
  { href: '/extension/connect', label: 'Extensión' },
  { href: '/ayuda', label: 'Centro de ayuda' },
];

function pathOf(pathname: string | null | undefined) {
  return String(pathname || '').split(/[?#]/)[0];
}

/** The entry stays lit on the screens below it (/campaigns/history), except «Hoy», which has the admin panel below. */
export function isNavItemActive(item: NavItem, pathname: string | null | undefined) {
  const path = pathOf(pathname);
  if (!path) return false;
  return [item.href, ...(item.aliases || [])]
    .some((href) => path === href || (!item.exact && href !== '/dashboard' && path.startsWith(`${href}/`)));
}

/** What the phone's top bar calls the screen on view: its menu entry, or the name of a screen outside the menu. */
export function navLabelFor(pathname: string | null | undefined): string | null {
  const path = pathOf(pathname);
  if (!path) return null;
  for (const section of NAV_SECTIONS) {
    const item = section.items.find((entry) => isNavItemActive(entry, path));
    if (item) return item.label;
  }
  return SCREEN_LABELS.find(({ href }) => path === href || path.startsWith(`${href}/`))?.label ?? null;
}
