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
  if (overview.linkedin) figures.push({ id: 'linkedin', value: overview.linkedin.used, total: overview.linkedin.limit, label: 'invitaciones de LinkedIn esta semana' });
  return figures;
}

/** The message the «Cuéntame qué vendes» card sends: what you wrote, and your site if you gave it. */
export function coworkOfferMessage(offer: string, website = '') {
  const said = offer.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  const site = website.trim();
  return `Guarda en mi perfil lo que vendo: ${said}.${site ? ` Mi sitio web es ${site}.` : ''}`;
}
