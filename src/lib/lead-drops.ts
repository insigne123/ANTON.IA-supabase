import { dayInZone } from '@/lib/admin/chile-time';
import { displayLeadName } from '@/lib/lead-name';

/**
 * «Contacto del día» (idea del dueño, 20 oct 2026): on Tuesdays, Wednesdays and Fridays each person gets one new contact
 * that fits their customer, with why we recommend it, a brief research and a first email by Cowork's Writer. The morning
 * alert carries it: a table in its body, a PDF with the research and the draft, and a link to «Buscar prospectos» in a mode
 * that shows it as a search that already found it (dropHref). Whoever gets no email opens it in «Hoy». Pure: the server
 * prepares and saves them (server/lead-drops.ts). The code calls each day's contacts a drop.
 *
 * Until 3 Nov 2026 the contact came from Apify (Leads Finder), with its email ready, so saving it cost nothing. Since then
 * (idea del dueño: «que se use Apollo para esto, buscar un lead no nos tiene costo») it comes from Apollo's free search, with
 * a first email and three follow-ups (`followUps`): «Enriquecer y guardar» looks its email up (1 credit) and keeps it in
 * «Por escribir», so the person sees how short the way is from finding someone to writing to them. LEAD_DROPS_PROVIDER=apify
 * goes back to Leads Finder.
 */

export const DROP_SIZE = 1;
/** Tuesday, Wednesday and Friday, in Chile: days of the morning alert, which carries it (Monday is the weekly report's). */
export const DROP_WEEKDAYS = [2, 3, 5];
/**
 * What a team gets (organizations.lead_drop_size and lead_drop_weekdays, since 12 Nov 2026): how many contacts each person, and on
 * which days, 1 (Monday) to 5 (Friday). Without anything said, one contact on Tuesdays, Wednesdays and Fridays, as before.
 */
export type DropPlan = { size: number; weekdays: number[] };
export const DEFAULT_DROP_PLAN: DropPlan = { size: DROP_SIZE, weekdays: DROP_WEEKDAYS };
export const MAX_DROP_SIZE = 10;
/** A team's plan as its row says it; anything out of range falls back to the default, so a bad value never stops the drops. */
export function dropPlanOf(row: { lead_drop_size?: unknown; lead_drop_weekdays?: unknown } | null | undefined): DropPlan {
  const size = Number(row?.lead_drop_size);
  const weekdays = Array.isArray(row?.lead_drop_weekdays)
    ? [...new Set(row!.lead_drop_weekdays.map(Number).filter(day => Number.isInteger(day) && day >= 1 && day <= 5))].sort((a, b) => a - b) : [];
  return {
    size: Number.isInteger(size) && size >= 1 && size <= MAX_DROP_SIZE ? size : DEFAULT_DROP_PLAN.size,
    weekdays: weekdays.length ? weekdays : DEFAULT_DROP_PLAN.weekdays,
  };
}
const weekdayOf = (day: string) => new Date(`${day}T12:00:00.000Z`).getUTCDay();
export const dropDay = (now: Date, plan: DropPlan = DEFAULT_DROP_PLAN) => plan.weekdays.includes(weekdayOf(dayInZone(now)));
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
/** «mañana», «el martes»: when the next drop comes, after today's. */
export function nextDropDay(now: Date, plan: DropPlan = DEFAULT_DROP_PLAN) {
  const today = weekdayOf(dayInZone(now));
  const ahead = [1, 2, 3, 4, 5, 6, 7].find(days => plan.weekdays.includes((today + days) % 7)) ?? 7;
  return ahead === 1 ? 'mañana' : `el ${WEEKDAYS[(today + ahead) % 7]}`;
}

/** Who the contacts are for: from the person's «Perfil», a teammate's, or the contacts the team already saved. */
/** `perfil`: a person's own customer. From 27 to 29 Oct 2026 everyone got the company's; since then each person's own when they declared one,
 * and the company's otherwise, sharing a search with whoever has a similar one (groupDropPeople). */
export type DropCriteria = { titles: string[]; industries: string[]; locations: string[]; sizes: string[]; source: 'perfil' | 'equipo' | 'empresa' | 'contactos' };
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
  // Since 29 Oct 2026 (idea del dueño: «agrégale más info para que el usuario sepa por qué es recomendado»); drops from before have none.
  /** The level and the area of the person, in Spanish («Gerencia o jefatura», «Recursos humanos»). */
  seniority?: string | null;
  department?: string | null;
  /** Region and country, next to `city`. */
  state?: string | null;
  country?: string | null;
  /** The company's site and LinkedIn page: public, unlike the person's, which stays in the vault. */
  website?: string | null;
  companyLinkedin?: string | null;
  /** What the company does, in one sentence (writeDrop). */
  summary?: string | null;
  /** How the contact fits each part of the customer (dropFit). */
  fit?: DropFit[];
  /** Why it is worth it for what the person sells, and how to open, by a model with the data given only (writeDrop). */
  reasons?: string[];
  approach?: string | null;
  // Since 3 Nov 2026: found with Apollo's free search (see the top of this file); drops from before have neither.
  /** Found with Apollo: its email is looked up when the person saves it («Enriquecer y guardar», 1 credit). */
  provider?: 'apollo';
  /** The saved contact it became while its email was looked up: `savedLeadId` comes once it is in «Por escribir». */
  keptLeadId?: string | null;
  /** Three follow-ups after the first email, by the same Writer, with the day each one goes (the first email is day 1). */
  followUps?: DropFollowUp[];
  // Since 12 Nov 2026, for teams with more than one contact a day (the finder, server/lead-drop-finder.ts).
  /** «explore»: a role next to the customer's, offered to learn whether it works; the rest are the customer's own roles. */
  track?: 'explore';
  /** What the person said of this contact, with their reason: the finder learns from it. */
  feedback?: { useful: boolean; reason?: string | null; at: string };
};
export type DropFollowUp = { day: number; subject: string; body: string };

/** The name a screen, the email and the PDF show: «Daniel N.» while Apollo's search hides the surname («Daniel Ni***o»). */
export const dropName = (item: Pick<DropItem, 'name'>) => displayLeadName(item.name).text || item.name;
/** A contact whose email is still to look up: «Enriquecer y guardar» (1 credit) instead of «Guardar» (free, the email came with the search). */
export const needsLookup = (item: Pick<DropItem, 'provider' | 'savedLeadId'>) => item.provider === 'apollo' && !item.savedLeadId;
/** What saving them costs, said where they are offered: the email, the PDF, «Hoy». */
export function dropCostNote(items: Array<Pick<DropItem, 'provider'>>) {
  const one = items.length === 1;
  if (items.some(item => item.provider === 'apollo')) return one ? 'Ver su correo y guardarlo usa 1 crédito.' : 'Ver el correo de cada uno y guardarlo usa 1 crédito por contacto.';
  return one ? 'Guardarlo no gasta créditos.' : 'Guardarlos no gasta créditos.';
}

/** How a contact fits one part of the customer: what they have, what the customer asks for, and whether it matches. */
export type DropFit = { criterion: 'Cargo' | 'Rubro' | 'Lugar' | 'Tamaño'; theirs: string; wanted: string; match: 'yes' | 'partial' | 'no' | 'unknown' };
export const FIT_LABEL: Record<DropFit['match'], string> = { yes: 'Sí', partial: 'En parte', no: 'No', unknown: 'Sin dato' };

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

/**
 * The customer of a whole organization, for whoever did not declare one: the «Ficha de la empresa»'s; without one, the one most
 * of the team declared (the first in `team`, admins first, on a tie); else what the team saved. Null with nothing to go by.
 * On 21 Oct 2026 one search per person took 11 searches for 35 people of two companies, each with Apify's minimum charge however
 * few it brings: people with similar customers share one now (groupDropPeople).
 */
export function companyDropCriteria(company: IcpDeclared | null, team: IcpDeclared[], saved: Array<{ title?: string | null; industry?: string | null }>) {
  const fromCompany = fromDeclared(company, 'empresa');
  if (fromCompany) return fromCompany;
  const counted = new Map<string, { criteria: DropCriteria; count: number; first: number }>();
  team.forEach((declared, index) => {
    const criteria = fromDeclared(declared, 'equipo');
    if (!criteria) return;
    const key = criteriaKey(criteria);
    const known = counted.get(key);
    if (known) known.count++; else counted.set(key, { criteria, count: 1, first: index });
  });
  const top = [...counted.values()].sort((a, b) => b.count - a.count || a.first - b.first)[0];
  return top?.criteria ?? inferCriteria(saved);
}

/** A key that groups people with the same customer, so one search serves all of them. */
export const criteriaKey = (criteria: DropCriteria) => JSON.stringify([criteria.titles, criteria.industries, criteria.locations, criteria.sizes].map(values => values.map(fold).sort()));

/** A person's own customer: the one in their «Perfil» when they declared it, else the company's (companyDropCriteria). */
export function personDropCriteria(own: IcpDeclared | null | undefined, company: DropCriteria | null): DropCriteria | null {
  return fromDeclared(own, 'perfil') ?? company;
}

// What two customers are compared on: the words that say what the person does («personas», «facility»), without the level of
// the title («Gerente», «Jefe») nor linking words, in singular. To compare, the names Chile gives the area of people («RR. HH.»,
// «HR», «Personas», «Capital humano», «Talento humano», «People», «Talento») are all «recursos humanos».
const LEVELS = new Set(['gerente', 'subgerente', 'jefe', 'jefa', 'director', 'directora', 'head', 'manager', 'encargado', 'encargada',
  'coordinador', 'coordinadora', 'supervisor', 'supervisora', 'lider', 'responsable', 'analista', 'ejecutivo', 'ejecutiva', 'especialista',
  'vicepresidente', 'chief', 'officer', 'senior', 'junior', 'asistente', 'general', 'regional', 'corporativo', 'corporativa', 'area']);
const singular = (word: string) => word.length > 5 && word.endsWith('iones') ? word.slice(0, -2) : word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word;
function wordsOf(values: string[], withoutLevels: boolean, synonyms = true) {
  const words = new Set<string>();
  for (const value of values) {
    const folded = fold(value);
    const text = (synonyms ? folded.replace(/\brr\.?\s*hh\b\.?|\bhr\b|\bhuman resources\b|\bpersonas\b|\b(capital|talento) humano\b|\bpeople\b|\btalento?\b/g, ' recursos humanos ') : folded)
      .replace(/[^a-z0-9 ]/g, ' ');
    for (const raw of text.split(' ')) {
      const word = singular(raw);
      if (word.length < 3 || LINKING.has(word) || (withoutLevels && LEVELS.has(word))) continue;
      words.add(word);
    }
  }
  return words;
}
/** The countries a customer looks in («Chile», «Perú»); the places as written when they name none we know. */
function placesOf(locations: string[]) {
  const countries = new Set(COUNTRIES.filter(country => locations.some(place => country.names.some(name => ` ${fold(place)} `.includes(` ${name} `)))).map(country => country.domain));
  return countries.size ? countries : new Set(locations.map(fold));
}
/** How much of `mine` is already in `theirs`, from 0 to 1; a customer without words of that kind fits anywhere. */
const covered = (mine: Set<string>, theirs: Set<string>) => mine.size ? [...mine].filter(word => theirs.has(word)).length / mine.size : 1;

export type DropGroup = { criteria: DropCriteria; people: string[] };
const GROUP_TITLES = 6;
const GROUP_INDUSTRIES = 6;

/**
 * Who shares a search (idea del dueño, 29 oct 2026: each Apify search costs, however few it brings). Someone whose customer is
 * like a group's (half or more of the words of their titles and of their industries are the group's already, in a country it
 * searches) joins it, and the group's search takes their titles and industries too, up to 6 of each; the rest get a search of
 * their own. The most common customer opens the first group. At most `maxGroups` searches: past that, each smaller group joins
 * the one most like it, keeping that search. The largest groups come first, so a tight budget pays for them.
 */
export function groupDropPeople(people: Array<{ id: string; criteria: DropCriteria }>, maxGroups: number): DropGroup[] {
  type Group = DropGroup & { titles: Set<string>; industries: Set<string>; places: Set<string>; first: number };
  const counts = new Map<string, number>();
  for (const person of people) counts.set(criteriaKey(person.criteria), (counts.get(criteriaKey(person.criteria)) || 0) + 1);
  const ordered = people.map((person, index) => ({ ...person, index }))
    .sort((a, b) => counts.get(criteriaKey(b.criteria))! - counts.get(criteriaKey(a.criteria))! || a.index - b.index);
  const groups: Group[] = [];
  const likeness = (titles: Set<string>, industries: Set<string>, places: Set<string>, group: Group) =>
    [...places].some(place => group.places.has(place)) ? { titles: covered(titles, group.titles), industries: covered(industries, group.industries) } : null;
  for (const person of ordered) {
    const { titles, industries, locations } = person.criteria;
    const words = { titles: wordsOf(titles, true), industries: wordsOf(industries, false), places: placesOf(locations) };
    let best: Group | null = null, bestScore = -1;
    for (const group of groups) {
      const like = likeness(words.titles, words.industries, words.places, group);
      if (!like || like.titles < 0.5 || like.industries < 0.5 || like.titles + like.industries <= bestScore) continue;
      best = group; bestScore = like.titles + like.industries;
    }
    if (!best) {
      groups.push({ criteria: { ...person.criteria, titles: titles.slice(0, GROUP_TITLES), industries: industries.slice(0, GROUP_INDUSTRIES) },
        people: [person.id], ...words, first: person.index });
      continue;
    }
    best.people.push(person.id);
    // «Jefes de operaciones» is «Jefe de Operaciones» already: compared by their words, in singular.
    const same = (value: string) => [...wordsOf([value], false, false)].sort().join(' ');
    const add = (current: string[], more: string[], max: number) => {
      const seen = new Set(current.map(same));
      return [...current, ...more.filter(value => !seen.has(same(value)) && seen.add(same(value)))].slice(0, max);
    };
    best.criteria = { ...best.criteria, titles: add(best.criteria.titles, titles, GROUP_TITLES), industries: add(best.criteria.industries, industries, GROUP_INDUSTRIES) };
    best.titles = wordsOf(best.criteria.titles, true);
    best.industries = wordsOf(best.criteria.industries, false);
  }
  const bySize = (a: Group, b: Group) => b.people.length - a.people.length || a.first - b.first;
  const kept = groups.slice().sort(bySize).slice(0, Math.max(1, maxGroups));
  for (const extra of groups.filter(group => !kept.includes(group))) {
    const target = kept.map(group => {
      const like = likeness(extra.titles, extra.industries, extra.places, group);
      return { group, score: like ? like.titles + like.industries + 1 : 0 };
    }).sort((a, b) => b.score - a.score || bySize(a.group, b.group))[0].group;
    target.people.push(...extra.people);
  }
  return kept.sort(bySize).map(({ criteria, people: members }) => ({ criteria, people: members }));
}

/** A contact found, with what the server needs to choose (the email and LinkedIn only as keys to skip known people). */
export type DropCandidate = Omit<DropItem, 'why' | 'research' | 'draft' | 'savedLeadId' | 'summary' | 'fit' | 'reasons' | 'approach'>
  & { emailKey: string | null; linkedinKey: string | null; about: string | null };
export type KnownPeople = { emails: Set<string>; linkedins: Set<string>; leadIds: Set<string> };

// The country domains of the places a team may search in (and of its neighbours): the search filters by where the PERSON is,
// so a Mexican company with someone in Santiago («gou.mx») came out as a contact «en Santiago».
const COUNTRIES: Array<{ domain: string; names: string[] }> = [
  { domain: 'cl', names: ['chile'] }, { domain: 'mx', names: ['mexico'] }, { domain: 'ar', names: ['argentina'] }, { domain: 'pe', names: ['peru'] },
  { domain: 'br', names: ['brasil', 'brazil'] }, { domain: 'uy', names: ['uruguay'] }, { domain: 'py', names: ['paraguay'] }, { domain: 'bo', names: ['bolivia'] },
  { domain: 'ec', names: ['ecuador'] }, { domain: 've', names: ['venezuela'] }, { domain: 'co', names: ['colombia'] }, { domain: 'es', names: ['espana', 'spain'] },
  { domain: 'pt', names: ['portugal'] }, { domain: 'gt', names: ['guatemala'] }, { domain: 'cr', names: ['costa rica'] }, { domain: 'pa', names: ['panama'] },
  { domain: 'do', names: ['republica dominicana'] },
];
/** The country a company domain belongs to (`.mx`, `.com.ar`), when it says one; `.co` alone is how many startups end, so only `.com.co` and the like are Colombian. */
function domainCountry(domain: string | null | undefined) {
  const labels = fold(String(domain || '')).split('.').filter(Boolean);
  const tld = labels[labels.length - 1];
  if (!tld) return null;
  if (tld === 'co') return labels.length > 2 && ['com', 'net', 'org', 'gov', 'edu'].includes(labels[labels.length - 2]) ? 'co' : null;
  return COUNTRIES.some(country => country.domain === tld) ? tld : null;
}
/**
 * A company whose domain belongs to a country the search did not ask for («gou.mx» for «Chile»). Only when the places name a country
 * we know («Chile», «Perú»): «Santiago» alone, or a `.com`, says nothing, and nothing is left out for that.
 */
export function foreignDomain(domain: string | null | undefined, locations: string[]) {
  const own = domainCountry(domain);
  if (!own) return false;
  const asked = new Set(COUNTRIES.filter(country => locations.some(place => country.names.some(name => ` ${fold(place)} `.includes(` ${name} `)))).map(country => country.domain));
  return asked.size > 0 && !asked.has(own);
}

/** Who of a search may be offered at all: with an email, and nobody the team already has or got in an earlier drop. */
export const usableDrops = (candidates: DropCandidate[], known: KnownPeople) => candidates.filter(item => item.hasEmail
  && !known.leadIds.has(item.leadId)
  && !(item.emailKey && known.emails.has(item.emailKey))
  && !(item.linkedinKey && known.linkedins.has(item.linkedinKey)));

/**
 * `size` contacts (DROP_SIZE) for each person of a group, different for each: only people with an email, none the team
 * already has or got in an earlier drop, no company from another country than the one asked, one per company for each person
 * and, while there are enough, a company nobody else in the group got. People with a phone and with a title closer to the
 * criteria go first: to each person's own (`criteriaOf`) when a group shares a search.
 */
export function assignDrops(candidates: DropCandidate[], people: string[], known: KnownPeople, criteria: DropCriteria, size = DROP_SIZE,
  criteriaOf?: (person: string) => DropCriteria) {
  const closenessTo = (target: DropCriteria) => {
    const titleWords = target.titles.map(title => new Set(fold(title).split(' ').filter(word => word.length > 2)));
    return (title: string | null) => {
      const words = new Set(fold(title || '').split(' '));
      return Math.max(0, ...titleWords.map(set => [...set].filter(word => words.has(word)).length / Math.max(1, set.size)));
    };
  };
  const usable = usableDrops(candidates, known);
  const ranked = new Map(people.map(person => {
    const own = criteriaOf?.(person) ?? criteria;
    const closeness = closenessTo(own);
    return [person, usable.filter(item => !foreignDomain(item.domain, own.locations))
      .sort((a, b) => Number(b.hasPhone) - Number(a.hasPhone) || closeness(b.title) - closeness(a.title) || a.leadId.localeCompare(b.leadId))];
  }));
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
        const pick = ranked.get(person)!.find(item => !taken.has(item.leadId) && !companies.has(companyOf(item)) && (!strict || !usedCompanies.has(companyOf(item))));
        if (!pick) continue;
        taken.add(pick.leadId); usedCompanies.add(companyOf(pick)); mine.push(pick);
      }
    }
  }
  return out;
}

/** What the finder makes of a candidate for one person: how its title relates to the customer's roles, and a score from 0 to 100. */
export type DropScore = { titleClass: 'exact' | 'similar' | 'related'; score: number };
/** How many of a drop are roles next to the customer's («explore»): none in a drop of one or two, about three in ten of a larger one. */
export const exploreSlots = (size: number) => (size >= 3 ? Math.max(1, Math.round(size * 0.3)) : 0);

/**
 * `size` contacts for each person, by the finder's score instead of the words of the title (assignDrops): the customer's own roles
 * first («exact» and «similar»), and the last slots (exploreSlots) for roles next to them («related»), so the team learns whether
 * they work. The rest is as assignDrops: only people with an email, nobody the team has or got before, no company from another
 * country, one per company for each person and, while there are enough, a company nobody else in the group got. Someone the finder
 * left without a score is not offered. Each pick says whether it is an exploration.
 */
export function pickRankedDrops(candidates: DropCandidate[], people: string[], known: KnownPeople, size: number, deps: {
  criteriaOf: (person: string) => DropCriteria;
  scoreOf: (person: string, item: DropCandidate) => DropScore | null;
}) {
  const usable = usableDrops(candidates, known);
  const lists = new Map(people.map(person => {
    const own = deps.criteriaOf(person);
    const scored = usable.filter(item => !foreignDomain(item.domain, own.locations))
      .map(item => ({ item, score: deps.scoreOf(person, item) }))
      .filter((entry): entry is { item: DropCandidate; score: DropScore } => Boolean(entry.score))
      .sort((a, b) => b.score.score - a.score.score || a.item.leadId.localeCompare(b.item.leadId));
    return [person, { core: scored.filter(entry => entry.score.titleClass !== 'related'), explore: scored.filter(entry => entry.score.titleClass === 'related') }];
  }));
  const companyOf = (item: DropCandidate) => fold(item.domain || item.company || item.leadId);
  const taken = new Set<string>(), usedCompanies = new Set<string>();
  const out = new Map<string, Array<DropCandidate & { track?: 'explore' }>>(people.map(person => [person, []]));
  const exploring = exploreSlots(size);
  for (const strict of [true, false]) {
    for (let round = 0; round < size; round++) {
      for (const person of people) {
        const mine = out.get(person)!;
        if (mine.length > round) continue;
        const companies = new Set(mine.map(companyOf));
        const free = (entry: { item: DropCandidate }) => !taken.has(entry.item.leadId) && !companies.has(companyOf(entry.item))
          && (!strict || !usedCompanies.has(companyOf(entry.item)));
        const { core, explore } = lists.get(person)!;
        // The last slots explore; a list that ran out is filled from the other one.
        const wanted = round >= size - exploring ? [explore, core] : [core, explore];
        const pick = wanted[0].find(free) ?? wanted[1].find(free);
        if (!pick) continue;
        taken.add(pick.item.leadId); usedCompanies.add(companyOf(pick.item));
        mine.push(pick.score.titleClass === 'related' ? { ...pick.item, track: 'explore' } : pick.item);
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

/**
 * «Calza con tu cliente ideal por su cargo y su rubro (retail), en Santiago»: why the contact fits, from what matched, without
 * repeating the role the screen shows beside it. With the fit (dropFit), only the industry and the place that do match: a
 * company in «sector público» for a customer in retail is not a reason (it said so until 3 Nov 2026, next to a table that said «No calza»).
 */
export function whyText(item: Pick<DropItem, 'title' | 'industry' | 'city' | 'track'>, criteria: DropCriteria, fit?: DropFit[]) {
  const source = criteria.source === 'perfil' ? 'tu cliente ideal' : criteria.source === 'equipo' ? 'el cliente ideal de tu equipo'
    : criteria.source === 'empresa' ? 'el cliente ideal de tu empresa' : 'los contactos que guarda tu equipo';
  const fits = (criterion: DropFit['criterion']) => {
    const entry = fit?.find(candidate => candidate.criterion === criterion);
    return !entry || entry.match === 'yes' || entry.match === 'partial';
  };
  // A role next to the customer's (the finder's exploration): said as what it is, so nobody takes it for a mistake.
  if (item.track === 'explore') {
    const where = [item.industry && fits('Rubro') ? `en tu rubro objetivo (${item.industry.toLowerCase()})` : null, item.city && fits('Lugar') ? `en ${item.city}` : null].filter(Boolean).join(', ');
    return `Su cargo es vecino a los que buscas${where ? `, ${where}` : ''}: te lo proponemos para probar si también te sirve.`;
  }
  // The title is what the search asked for, similar titles included: our word match is no reason to doubt it.
  const matched = [item.title ? 'su cargo' : null, item.industry && fits('Rubro') ? `su rubro (${item.industry.toLowerCase()})` : null].filter(Boolean).join(' y ');
  return `Calza con ${source}${matched ? ` por ${matched}` : ''}${item.city && fits('Lugar') ? `, en ${item.city}` : ''}.`;
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

// ─── Who the person is and how they fit, for the report ──────────────────────────────────────────────────────────────

// Leads Finder's levels (actor-enums.ts) and areas («functional_level»), as the report says them.
const SENIORITIES: Record<string, string> = {
  founder: 'Fundador o fundadora', owner: 'Dueño o dueña', c_suite: 'Alta dirección', partner: 'Socio o socia', vp: 'Vicepresidencia',
  director: 'Dirección', head: 'Jefatura de área', manager: 'Gerencia o jefatura', senior: 'Profesional senior', entry: 'Profesional', trainee: 'En práctica',
};
const DEPARTMENTS: Record<string, string> = {
  human_resources: 'Recursos humanos', sales: 'Ventas', operations: 'Operaciones', finance: 'Finanzas', accounting: 'Contabilidad', marketing: 'Marketing',
  engineering: 'Ingeniería', information_technology: 'Tecnología', legal: 'Legal', administrative: 'Administración', c_suite: 'Alta dirección',
  product_management: 'Producto', consulting: 'Consultoría', education: 'Educación', medical_health: 'Salud', support: 'Soporte',
  customer_service: 'Atención al cliente', purchasing: 'Compras', procurement: 'Compras', logistics: 'Logística', supply_chain: 'Logística',
  design: 'Diseño', data_science: 'Datos', business_development: 'Desarrollo de negocios', security: 'Seguridad',
};
const humanize = (value: string) => { const words = value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(); return words ? words.charAt(0).toLocaleUpperCase('es-CL') + words.slice(1) : null; };
export const seniorityLabel = (value: string | null | undefined) => value ? SENIORITIES[fold(value)] ?? humanize(value) : null;
export const departmentLabel = (value: string | null | undefined) => value ? DEPARTMENTS[fold(value)] ?? humanize(value) : null;

/** «Santiago, Región Metropolitana, Chile»: the region in Spanish (Leads Finder says «Santiago Metropolitan Region»), nothing twice. */
export function placeLabel(item: Pick<DropItem, 'city' | 'state' | 'country'>) {
  const state = String(item.state || '').trim().replace(/^santiago metropolitan region$/i, 'Región Metropolitana').replace(/^(.+) region$/i, 'Región de $1');
  const parts = [item.city, state, item.country].map(value => String(value || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  return parts.filter((part, index) => parts.findIndex(other => fold(other) === fold(part)) === index).join(', ') || null;
}

const wantedOf = (values: string[]) => values.length > 3 ? `${values.slice(0, 3).join(', ')} y ${values.length - 3} más` : values.join(', ');
/** «51 a 200 personas», for a size as «Perfil» keeps it (PROFILE_SIZES). */
function sizeRangeLabel(range: string) {
  const [min, max] = range.split(',').map(Number);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return max >= 1_000_000 ? `Más de ${(min - 1).toLocaleString('es-CL')} personas` : `${min.toLocaleString('es-CL')} a ${max.toLocaleString('es-CL')} personas`;
}
/** Of the words a wanted value says, the share the contact's value has too; a title of levels only («Gerente General») is compared with its levels. */
function closest(wanted: string[], theirs: string, withoutLevels: boolean) {
  return Math.max(0, ...wanted.map(value => {
    const words = wordsOf([value], withoutLevels);
    return words.size ? covered(words, wordsOf([theirs], withoutLevels)) : covered(wordsOf([value], false), wordsOf([theirs], false));
  }));
}
const matchOf = (share: number): DropFit['match'] => share >= 1 ? 'yes' : share > 0 ? 'partial' : 'no';

/**
 * How the contact fits the customer it was chosen for, criterion by criterion: the title and the industry by their words (an
 * industry also when the search names it the same, `sameIndustry`), the place by name or by country, and the size by range.
 * A criterion the customer leaves open is left out; one the search brought no data for says so.
 */
export function dropFit(item: Pick<DropItem, 'title' | 'industry' | 'size' | 'city' | 'state' | 'country'>, criteria: DropCriteria,
  sameIndustry?: (wanted: string) => boolean): DropFit[] {
  const fit: DropFit[] = [];
  const unknown = (criterion: DropFit['criterion'], wanted: string): DropFit => ({ criterion, theirs: 'Sin dato', wanted, match: 'unknown' });
  if (criteria.titles.length) {
    const wanted = wantedOf(criteria.titles);
    fit.push(item.title ? { criterion: 'Cargo', theirs: item.title, wanted, match: matchOf(closest(criteria.titles, item.title, true)) } : unknown('Cargo', wanted));
  }
  if (criteria.industries.length) {
    const wanted = wantedOf(criteria.industries);
    fit.push(item.industry ? { criterion: 'Rubro', theirs: item.industry, wanted,
      match: criteria.industries.some(value => sameIndustry?.(value)) ? 'yes' : matchOf(closest(criteria.industries, item.industry, false)) } : unknown('Rubro', wanted));
  }
  if (criteria.locations.length) {
    const wanted = wantedOf(criteria.locations);
    const place = placeLabel(item);
    const asked = COUNTRIES.filter(country => criteria.locations.some(value => country.names.some(name => ` ${fold(value)} `.includes(` ${name} `))));
    const theirs = COUNTRIES.find(country => country.names.includes(fold(item.country || '')));
    const named = place && criteria.locations.some(value => ` ${fold(place).replace(/,/g, ' ')} `.includes(` ${fold(value)} `));
    // The search keeps to those places: a contact that names none of them is in a part of them («Las Condes» for «Santiago»).
    fit.push(!place ? unknown('Lugar', wanted) : { criterion: 'Lugar', theirs: place, wanted,
      match: named || (theirs && asked.includes(theirs)) ? 'yes' : theirs && asked.length ? 'no' : 'partial' });
  }
  if (criteria.sizes.length) {
    const wanted = criteria.sizes.map(sizeRangeLabel).filter(Boolean).join(' o ');
    const within = (size: number) => criteria.sizes.some(range => { const [min, max] = range.split(',').map(Number); return size >= min && size <= max; });
    fit.push(item.size ? { criterion: 'Tamaño', theirs: `${item.size.toLocaleString('es-CL')} personas`, wanted, match: within(item.size) ? 'yes' : 'no' } : unknown('Tamaño', wanted));
  }
  return fit;
}

/**
 * Apollo's free search often brings a contact without its company's industry, size or place: when the search kept to them (an
 * industry it knows by its tag, the sizes, the places), the contact is within them, and the fit says so instead of «Sin dato».
 */
export function searchedFit(fit: DropFit[], kept: { industry: boolean; size: boolean; place: boolean }): DropFit[] {
  const within: Partial<Record<DropFit['criterion'], boolean>> = { Rubro: kept.industry, Tamaño: kept.size, Lugar: kept.place };
  return fit.map(entry => entry.match === 'unknown' && within[entry.criterion] ? { ...entry, theirs: 'Dentro de lo que buscas', match: 'yes' } : entry);
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
  // Found with Apollo (since 3 Nov 2026), the email is looked up on saving: the email does not promise it is ready.
  const lookup = items.some(item => item.provider === 'apollo');
  const lead = lookup ? (one ? 'Tu contacto de hoy, elegido para ti' : `${items.length} contactos nuevos para ti`)
    : one ? 'Tu contacto de hoy, con su correo listo' : `${items.length} contactos nuevos para ti, con su correo listo`;
  const email = items.some(item => item.followUps?.length) ? 'un primer correo y tres seguimientos' : 'un primer correo sugerido';
  const research = one ? `En el PDF adjunto va por qué te lo recomendamos, quién es, su empresa y ${email}.`
    : `En el PDF adjunto va por qué te recomendamos a cada uno, quiénes son, sus empresas y ${email}.`;
  const text = [
    ...(heading ? [`${lead}:`] : []),
    ...items.map(item => `- ${dropName(item)}, ${[item.title, item.company].filter(Boolean).join(' en ')}. ${[item.why, item.reasons?.[0]].filter(Boolean).join(' ')}`),
    lookup ? `${one ? 'Míralo' : 'Míralos'}: ${link}` : `${one ? 'Míralo y guárdalo' : 'Míralos y guárdalos'} sin costo: ${link}`,
    lookup ? `${dropCostNote(items)} ${research}` : research,
  ].join('\n');
  const block = (item: DropItem, index: number) => `<div style="padding:12px 0;${index ? 'border-top:1px solid #e5e7eb;' : ''}">`
    + `<p style="margin:0;font-size:17px;line-height:24px;font-weight:600;color:#111827">${escape(dropName(item))}</p>`
    + `<p style="margin:2px 0 0;font-size:14px;line-height:20px;color:#374151">${escape([item.title, item.company].filter(Boolean).join(' · '))}</p>`
    + `<p style="margin:6px 0 0;font-size:14px;line-height:20px;color:#6b7280">${escape(item.why)}</p>`
    // The first reason it is worth it for what the person sells (writeDrop): the rest, with the fit criterion by criterion, in the PDF.
    + (item.reasons?.[0] ? `<p style="margin:4px 0 0;font-size:14px;line-height:20px;color:#374151">${escape(item.reasons[0])}</p>` : '') + '</div>';
  const html = (heading ? `<h2 style="margin:28px 0 8px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280">Contacto del día</h2>`
      + `<p style="margin:0 0 12px;font-size:15px;line-height:22px;color:#111827">${lead}.</p>` : '')
    + `<div style="margin:0 0 16px;padding:4px 16px;border:1px solid #e5e7eb;border-radius:14px;background:#f9fafb">${items.map(block).join('')}</div>`
    + `<p style="margin:0"><a href="${escape(link)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px">${one ? 'Ver y guardar' : `Ver y guardar los ${items.length}`}</a></p>`
    + `<p style="margin:8px 0 0;font-size:13px;line-height:19px;color:#6b7280">${escape(dropCostNote(items))} ${research}</p>`;
  return { text, html, link };
}

/** «Tu contacto de hoy: Gerente de Personas en Ripley»; with more than one, how many. */
export function dropSubject(items: Array<Pick<DropItem, 'title' | 'company'>>) {
  if (items.length !== 1) return `${items.length} contactos nuevos para ti`;
  const who = [items[0].title, items[0].company].filter(Boolean).join(' en ');
  return who ? `Tu contacto de hoy: ${who}`.slice(0, 120) : 'Tu contacto de hoy';
}
