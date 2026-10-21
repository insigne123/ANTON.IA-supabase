import { dayInZone } from '@/lib/admin/chile-time';

/**
 * «Contacto del día» (idea del dueño, 20 oct 2026): on Tuesdays, Wednesdays and Fridays each person gets one new contact
 * that fits their customer, found with Apify (Leads Finder), not with Apollo's credits, with a brief research and a first
 * email by Cowork's Writer. The morning alert carries it: a table in its body, a PDF with the research and the draft, and
 * a link to «Buscar prospectos» in a mode that shows it as a search that already found it (dropHref), with its email ready:
 * saving it to «Por escribir» costs nothing. Whoever gets no email opens it in «Hoy». Pure: the server prepares and saves
 * them (server/lead-drops.ts). The code calls each day's contacts a drop.
 */

export const DROP_SIZE = 1;
/** Tuesday, Wednesday and Friday, in Chile: days of the morning alert, which carries it (Monday is the weekly report's). */
export const DROP_WEEKDAYS = [2, 3, 5];
const weekdayOf = (day: string) => new Date(`${day}T12:00:00.000Z`).getUTCDay();
export const dropDay = (now: Date) => DROP_WEEKDAYS.includes(weekdayOf(dayInZone(now)));
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
/** «mañana», «el martes»: when the next drop comes, after today's. */
export function nextDropDay(now: Date) {
  const today = weekdayOf(dayInZone(now));
  const ahead = [1, 2, 3, 4, 5, 6, 7].find(days => DROP_WEEKDAYS.includes((today + days) % 7)) ?? 7;
  return ahead === 1 ? 'mañana' : `el ${WEEKDAYS[(today + ahead) % 7]}`;
}

/** Who the contacts are for: from the person's «Perfil», a teammate's, or the contacts the team already saved. */
export type DropCriteria = { titles: string[]; industries: string[]; locations: string[]; sizes: string[]; source: 'perfil' | 'equipo' | 'contactos' };
export type IcpDeclared = { roles?: string | null; industries?: string | null; locations?: string | null; size?: string | null };

/** One contact of a drop, as the person sees it before saving it: never the email or the phone, which stay in the vault. */
export type DropItem = {
  leadId: string;
  name: string;
  title: string | null;
  company: string | null;
  domain: string | null;
  industry: string | null;
  size: number | null;
  city: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  /** Why it fits, from the criteria it matched. */
  why: string;
  /** Two or three short facts about the company. */
  research: string[];
  draft: { subject: string; body: string } | null;
  /** The contact in «Por escribir» once saved. */
  savedLeadId?: string | null;
};

const PROFILE_SIZES: Record<string, string> = {
  '1-10': '1,10', '11-50': '11,50', '51-200': '51,200', '201-500': '201,500', '501-1000': '501,1000', '1001-5000': '1001,5000', '5001+': '5001,1000000',
};
const list = (value: string | null | undefined, max: number) => [...new Set(String(value || '').split(/[,;\n]/).map(item => item.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, max);
const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function fromDeclared(declared: IcpDeclared | null | undefined, source: DropCriteria['source']): DropCriteria | null {
  const titles = list(declared?.roles, 5), industries = list(declared?.industries, 5);
  if (!titles.length && !industries.length) return null;
  const size = PROFILE_SIZES[String(declared?.size || '').trim()];
  return { titles, industries, locations: list(declared?.locations, 3).length ? list(declared?.locations, 3) : ['Chile'], sizes: size ? [size] : [], source };
}

/** The most repeated titles and industries among the contacts the team saved: what they look for, said by what they keep. */
export function inferCriteria(saved: Array<{ title?: string | null; industry?: string | null }>): DropCriteria | null {
  const top = (values: Array<string | null | undefined>, max: number) => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const raw of values) {
      const label = String(raw || '').replace(/\s+/g, ' ').trim();
      if (label.length < 3 || label.length > 80) continue;
      const key = fold(label);
      const known = counts.get(key);
      if (known) known.count++; else counts.set(key, { label, count: 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es')).slice(0, max).map(item => item.label);
  };
  const withTitle = saved.filter(row => String(row.title || '').trim());
  if (withTitle.length < 5) return null;
  return { titles: top(saved.map(row => row.title), 4), industries: top(saved.map(row => row.industry), 3), locations: ['Chile'], sizes: [], source: 'contactos' };
}

/** The person's customer, else a teammate's, else what the team saved; null when there is nothing to go by. */
export function dropCriteria(person: IcpDeclared | null, team: IcpDeclared[], saved: Array<{ title?: string | null; industry?: string | null }>) {
  return fromDeclared(person, 'perfil') ?? team.map(item => fromDeclared(item, 'equipo')).find(Boolean) ?? inferCriteria(saved);
}

/** A key that groups people with the same customer, so one search serves all of them. */
export const criteriaKey = (criteria: DropCriteria) => JSON.stringify([criteria.titles, criteria.industries, criteria.locations, criteria.sizes].map(values => values.map(fold).sort()));

/** A contact found, with what the server needs to choose (the email and LinkedIn only as keys to skip known people). */
export type DropCandidate = Omit<DropItem, 'why' | 'research' | 'draft' | 'savedLeadId'> & { emailKey: string | null; linkedinKey: string | null; about: string | null };
export type KnownPeople = { emails: Set<string>; linkedins: Set<string>; leadIds: Set<string> };

/**
 * `size` contacts (DROP_SIZE) for each person of a group, different for each: only people with an email, none the team
 * already has or got in an earlier drop, one per company for each person and, while there are enough, a company nobody
 * else in the group got. People with a phone and with a title closer to the criteria go first.
 */
export function assignDrops(candidates: DropCandidate[], people: string[], known: KnownPeople, criteria: DropCriteria, size = DROP_SIZE) {
  const titleWords = criteria.titles.map(title => new Set(fold(title).split(' ').filter(word => word.length > 2)));
  const closeness = (title: string | null) => {
    const words = new Set(fold(title || '').split(' '));
    return Math.max(0, ...titleWords.map(set => [...set].filter(word => words.has(word)).length / Math.max(1, set.size)));
  };
  const usable = candidates.filter(item => item.hasEmail
    && !known.leadIds.has(item.leadId)
    && !(item.emailKey && known.emails.has(item.emailKey))
    && !(item.linkedinKey && known.linkedins.has(item.linkedinKey)))
    .sort((a, b) => Number(b.hasPhone) - Number(a.hasPhone) || closeness(b.title) - closeness(a.title) || a.leadId.localeCompare(b.leadId));
  const companyOf = (item: DropCandidate) => fold(item.domain || item.company || item.leadId);
  const taken = new Set<string>(), usedCompanies = new Set<string>();
  const out = new Map<string, DropCandidate[]>(people.map(person => [person, []]));
  // Round robin: each person takes one at a time, so the best contacts are shared out instead of going to the first person.
  for (const strict of [true, false]) {
    for (let round = 0; round < size; round++) {
      for (const person of people) {
        const mine = out.get(person)!;
        if (mine.length > round) continue;
        const companies = new Set(mine.map(companyOf));
        const pick = usable.find(item => !taken.has(item.leadId) && !companies.has(companyOf(item)) && (!strict || !usedCompanies.has(companyOf(item))));
        if (!pick) continue;
        taken.add(pick.leadId); usedCompanies.add(companyOf(pick)); mine.push(pick);
      }
    }
  }
  return out;
}

// The linking words LinkedIn titles often capitalize («Jefe De Reclutamiento Y Selección»).
const LINKING = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'en', 'a', 'al', 'para', 'por', 'con']);
/** A title as people write it: «Jefe De Ventas Y Marketing» → «Jefe de Ventas y Marketing». One in capitals stays as it is. */
export function tidyTitle(title: string | null | undefined) {
  const value = String(title || '').replace(/\s+/g, ' ').trim();
  if (!/\p{Ll}/u.test(value)) return value || null;
  return value.split(' ').map((word, index) => index && LINKING.has(word.toLowerCase()) && /^\p{Lu}\p{Ll}*$/u.test(word) ? word.toLowerCase() : word).join(' ');
}

/** A company with its legal form as Chile writes it: «Logistica S.a.» → «Logistica S.A.», «Rutas Spa» → «Rutas SpA». */
export function tidyCompany(name: string | null | undefined) {
  const value = String(name || '').replace(/\s+/g, ' ').trim();
  return value.replace(/\bS\.\s?A\.?$/i, 'S.A.').replace(/\bSpa$/i, 'SpA').replace(/\bLtda\.?$/i, 'Ltda.').replace(/\bE\.?I\.?R\.?L\.?$/i, 'EIRL') || null;
}

/** «Calza con tu cliente ideal por su cargo y su rubro (retail), en Santiago»: why the contact fits, from what matched, without repeating the role the screen shows beside it. */
export function whyText(item: Pick<DropItem, 'title' | 'industry' | 'city'>, criteria: DropCriteria) {
  const source = criteria.source === 'perfil' ? 'tu cliente ideal' : criteria.source === 'equipo' ? 'el cliente ideal de tu equipo' : 'los contactos que guarda tu equipo';
  const matched = [item.title ? 'su cargo' : null, item.industry ? `su rubro (${item.industry.toLowerCase()})` : null].filter(Boolean).join(' y ');
  return `Calza con ${source}${matched ? ` por ${matched}` : ''}${item.city ? `, en ${item.city}` : ''}.`;
}

/** The facts the research starts from: what the company does (the actor's description, summarized when there is one), size and place. */
export function researchFacts(item: Pick<DropCandidate, 'company' | 'industry' | 'size' | 'city' | 'about'>) {
  const facts: string[] = [];
  if (item.about) facts.push(item.about);
  const size = item.size ? `${item.size.toLocaleString('es-CL')} personas` : null;
  const where = [item.industry, size, item.city].filter(Boolean).join(' · ');
  if (where) facts.push(where);
  return facts.slice(0, 3);
}

// ─── In the morning alert: a table, the link and the PDF ────────────────────────────────────────────────────────────

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
/** «Buscar prospectos» in the drop's mode: the search that found them, with the contacts ready. */
export const dropHref = (dropId: string) => `/search/contactos/${encodeURIComponent(dropId)}`;

/**
 * The drop's part of the email: each contact as a block (name, role and company, why), the button to see them and a note on
 * the PDF. With `heading: false` (the drop is all the email has) the title and its lead are left out.
 */
export function dropEmailSection(items: DropItem[], dropId: string, appUrl: string, options: { heading?: boolean } = {}) {
  const link = `${appUrl.replace(/\/$/, '')}${dropHref(dropId)}`;
  const one = items.length === 1;
  const heading = options.heading !== false;
  const lead = one ? 'Tu contacto de hoy, con su correo listo' : `${items.length} contactos nuevos para ti, con su correo listo`;
  const research = one ? 'En el PDF adjunto va una breve investigación y un primer correo sugerido.' : 'En el PDF adjunto va una breve investigación de cada uno y un primer correo sugerido.';
  const text = [
    ...(heading ? [`${lead}:`] : []),
    ...items.map(item => `- ${item.name}, ${[item.title, item.company].filter(Boolean).join(' en ')}. ${item.why}`),
    `${one ? 'Míralo y guárdalo' : 'Míralos y guárdalos'} sin costo: ${link}`,
    research,
  ].join('\n');
  const block = (item: DropItem, index: number) => `<div style="padding:12px 0;${index ? 'border-top:1px solid #e5e7eb;' : ''}">`
    + `<p style="margin:0;font-size:17px;line-height:24px;font-weight:600;color:#111827">${escape(item.name)}</p>`
    + `<p style="margin:2px 0 0;font-size:14px;line-height:20px;color:#374151">${escape([item.title, item.company].filter(Boolean).join(' · '))}</p>`
    + `<p style="margin:6px 0 0;font-size:14px;line-height:20px;color:#6b7280">${escape(item.why)}</p></div>`;
  const html = (heading ? `<h2 style="margin:28px 0 8px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280">Contacto del día</h2>`
      + `<p style="margin:0 0 12px;font-size:15px;line-height:22px;color:#111827">${lead}.</p>` : '')
    + `<div style="margin:0 0 16px;padding:4px 16px;border:1px solid #e5e7eb;border-radius:14px;background:#f9fafb">${items.map(block).join('')}</div>`
    + `<p style="margin:0"><a href="${escape(link)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px">${one ? 'Ver y guardar' : `Ver y guardar los ${items.length}`}</a></p>`
    + `<p style="margin:8px 0 0;font-size:13px;line-height:19px;color:#6b7280">${one ? 'Guardarlo' : 'Guardarlos'} no gasta créditos. ${research}</p>`;
  return { text, html, link };
}

/** «Tu contacto de hoy: Gerente de Personas en Ripley»; with more than one, how many. */
export function dropSubject(items: Array<Pick<DropItem, 'title' | 'company'>>) {
  if (items.length !== 1) return `${items.length} contactos nuevos para ti`;
  const who = [items[0].title, items[0].company].filter(Boolean).join(' en ');
  return who ? `Tu contacto de hoy: ${who}`.slice(0, 120) : 'Tu contacto de hoy';
}
