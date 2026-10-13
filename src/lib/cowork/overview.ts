import type { CoworkSince } from './since-visit';
import { coworkStarter } from './starters';

/**
 * The account at a glance on the Cowork home (plan 2, V7): real figures of your own work, the
 * first name to greet you, and whether ANTON.IA knows what you sell. Each figure is null when it
 * could not be read: the home shows what it has and never a made-up zero.
 */
export type CoworkOverview = {
  firstName: string | null;
  /** Whether Cowork has an offer to write with (your profile or the organization settings). */
  hasOffer: boolean | null;
  contacts: number | null;
  withEmail: number | null;
  campaigns: number | null;
  /** LinkedIn invitations this week (pending and confirmed) against the weekly limit. */
  linkedin: { used: number; limit: number } | null;
  /** Saved contacts with an email nobody in the organization has written to yet: who «Escribir a mis contactos» reaches. */
  toWrite?: number | null;
  /** What changed since the person's last own turn (since-visit.ts); null without a previous visit or when it could not be read. */
  since?: CoworkSince | null;
};

/** The first word of a full name, as a greeting uses it. */
export function coworkFirstName(fullName: string | null | undefined) {
  const first = String(fullName || '').trim().split(/\s+/)[0] || '';
  return first && /\p{L}/u.test(first) ? first.slice(0, 40) : null;
}

export type CoworkOverviewFigure = { id: 'contacts' | 'withEmail' | 'campaigns' | 'linkedin'; value: number; label: string; total?: number };

/** The figures the home shows, in order, with their words in singular or plural. Unknown ones are left out. */
export function coworkOverviewFigures(overview: CoworkOverview | null): CoworkOverviewFigure[] {
  if (!overview) return [];
  const figures: CoworkOverviewFigure[] = [];
  const plural = (value: number, one: string, many: string) => (value === 1 ? one : many);
  if (overview.contacts !== null) figures.push({ id: 'contacts', value: overview.contacts, label: plural(overview.contacts, 'contacto guardado', 'contactos guardados') });
  if (overview.withEmail !== null && overview.contacts) figures.push({ id: 'withEmail', value: overview.withEmail, label: 'con correo' });
  if (overview.campaigns !== null) figures.push({ id: 'campaigns', value: overview.campaigns, label: plural(overview.campaigns, 'campaña', 'campañas') });
  // What is left, said as such: «0 de 100» did not tell used from available (round 2 readings).
  if (overview.linkedin) {
    const left = Math.max(0, overview.linkedin.limit - overview.linkedin.used);
    figures.push({ id: 'linkedin', value: left, label: `${left === 1 ? 'invitación' : 'invitaciones'} de LinkedIn libres esta semana` });
  }
  return figures;
}

export type CoworkTodayItem = { id: 'write' | 'emails'; text: string; action: string; prompt: string };

/** Writing starts as the starter «Escribir a mis contactos» does, so it shares its corpus case. */
export const COWORK_TODAY_PROMPTS = {
  write: coworkStarter('escribir').prompt,
  emails: 'Busca el correo de mis contactos guardados que todavía no lo tienen.',
} as const;

/** «Para hoy» on the home: what is ready to move without being asked, from the account's own figures. Who has an email and
 * never got one comes first; then who still lacks an email. Nothing when the figures are unknown or there is nobody. */
export function coworkTodayItems(overview: CoworkOverview | null): CoworkTodayItem[] {
  if (!overview) return [];
  const items: CoworkTodayItem[] = [];
  const plural = (value: number, one: string, many: string) => (value === 1 ? one : many);
  const toWrite = overview.toWrite ?? null;
  if (toWrite !== null && toWrite > 0) items.push({ id: 'write', action: 'Escribirles',
    text: `${toWrite} ${plural(toWrite, 'contacto con correo aún no recibe', 'contactos con correo aún no reciben')} nada de ti`, prompt: COWORK_TODAY_PROMPTS.write });
  const missing = overview.contacts !== null && overview.withEmail !== null ? overview.contacts - overview.withEmail : 0;
  if (missing > 0) items.push({ id: 'emails', action: 'Buscar sus correos',
    text: `${missing} ${plural(missing, 'contacto guardado no tiene', 'contactos guardados no tienen')} correo`, prompt: COWORK_TODAY_PROMPTS.emails });
  return items;
}

/** The message the «Cuéntame qué vendes» card sends: what you wrote, and your site if you gave it. With only the site, Cowork reads
 * it (site.read) and proposes who to aim at before anything is saved (scripts/fixtures/cowork-web-corpus.ts). */
export function coworkOfferMessage(offer: string, website = '') {
  const said = offer.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  const site = website.trim();
  if (!said && site) return `Mi web es ${site}, ayúdame a partir`;
  return `Guarda en mi perfil lo que vendo: ${said}.${site ? ` Mi sitio web es ${site}.` : ''}`;
}
