// Probable work addresses for a person, built from their name and the company's domain. Used when Apollo identified
// the person but had no email: each candidate is then checked with Reoon (run.ts) before it is saved.

export type ParsedName = { first: string; second: string; last1: string; last2: string };

export type PatternKey =
  | 'first.last'
  | 'flast'
  | 'firstlast'
  | 'f.last'
  | 'first'
  | 'first_last'
  | 'last.first'
  | 'last.f'
  | 'flastl'
  | 'flastlast'
  | 'first.lastlast'
  | 'firstsecond.last'
  | 'fslast';

// Most common formats in Chile, Peru and Colombia, in the order they are tried when the company's format is unknown.
const DEFAULT_ORDER: PatternKey[] = [
  'first.last', 'flast', 'firstlast', 'f.last', 'first', 'first_last', 'last.first', 'flastl', 'last.f', 'firstsecond.last',
  'fslast', 'flastlast', 'first.lastlast',
];

// A second token that is a given name, not the first surname ("Juan Diego Molina", "Marta Elisa Fuenzalida").
const SECOND_GIVEN = new Set([
  'alberto', 'alejandra', 'alejandro', 'andrea', 'andres', 'antonio', 'belen', 'carlos', 'cristobal', 'diego', 'eduardo',
  'elena', 'elisa', 'enrique', 'esteban', 'eugenia', 'felipe', 'fernanda', 'francisca', 'francisco', 'gabriel', 'ignacia',
  'ignacio', 'isabel', 'javier', 'jesus', 'jose', 'luis', 'manuel', 'pablo', 'patricio', 'paz', 'pia', 'sofia', 'teresa',
  'tomas',
]);
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'da', 'di', 'van', 'von']);
const LOCAL_PART = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es', 'live.com', 'live.cl',
  'yahoo.com', 'yahoo.es', 'icloud.com', 'me.com', 'msn.com', 'aol.com', 'proton.me', 'protonmail.com',
]);

function plain(value: unknown) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: unknown) {
  const out: string[] = [];
  let open = false;                                      // the last token ends in a particle: "de", "de la"
  for (const token of plain(value).split(' ')) {
    const bare = token.replace(/^-+|-+$/g, '');
    if (bare.replace(/-/g, '').length < 2) continue;      // initials ("Lagos R") say nothing about the address
    if (open) out[out.length - 1] += bare.replace(/-/g, '');
    else out.push(bare);
    open = PARTICLES.has(bare);
  }
  return out;
}

/** First name, optional second given name and up to two surnames; null when there is no usable first name and surname. */
export function parseName(input: { fullName?: string | null; firstName?: string | null; lastName?: string | null }): ParsedName | null {
  const raw = [input.fullName, input.firstName, input.lastName].map(value => String(value || ''));
  if (raw.some(value => value.includes('*'))) return null;   // masked by the provider ("Ro***s")
  let given = tokens(input.firstName);
  let family = tokens(input.lastName);
  if (!given.length || !family.length) {
    const all = tokens(input.fullName);
    given = all.slice(0, 1);
    family = all.slice(1);
  }
  if (given.length === 1 && family.length >= 2 && SECOND_GIVEN.has(family[0])) {
    given = [given[0], family[0]];
    family = family.slice(1);
  }
  const [first = '', second = ''] = given;
  const [last1 = '', last2 = ''] = family;
  if (!first || !last1) return null;
  return { first, second, last1, last2 };
}

export function normalizeDomain(value: unknown) {
  let raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    raw = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname;
  } catch {
    return '';
  }
  raw = raw.replace(/^www\./, '').replace(/\.$/, '');
  return DOMAIN.test(raw) && raw.length <= 253 && !FREE_MAIL.has(raw) ? raw : '';
}

export function localPart(pattern: PatternKey, name: ParsedName): string | null {
  const first = name.first.replace(/-/g, '');
  const f = first[0];
  const { second, last1, last2 } = name;
  const value = {
    'first.last': `${first}.${last1}`,
    flast: `${f}${last1}`,
    firstlast: `${first}${last1}`,
    'f.last': `${f}.${last1}`,
    first,
    first_last: `${first}_${last1}`,
    'last.first': `${last1}.${first}`,
    'last.f': `${last1}.${f}`,
    flastl: last2 ? `${f}${last1}${last2[0]}` : '',
    flastlast: last2 ? `${f}${last1}${last2}` : '',
    'first.lastlast': last2 ? `${first}.${last1}${last2}` : '',
    'firstsecond.last': second ? `${first}${second}.${last1}` : '',
    fslast: second ? `${f}${second[0]}${last1}` : '',
  }[pattern];
  return value && value.length <= 64 && LOCAL_PART.test(value) ? value : null;
}

export type DomainEvidence = { order: PatternKey[]; top: { pattern: PatternKey; count: number; share: number } | null };

/** Which formats the company's known addresses use, most common first. */
export function domainEvidence(examples: Array<{ local: string; name: ParsedName | null }>): DomainEvidence {
  const votes = new Map<PatternKey, number>();
  let total = 0;
  for (const example of examples) {
    if (!example.name) continue;
    total += 1;
    const hit = DEFAULT_ORDER.find(pattern => localPart(pattern, example.name!) === example.local);
    if (hit) votes.set(hit, (votes.get(hit) || 0) + 1);
  }
  const order = [...votes.entries()].sort((a, b) => b[1] - a[1] || DEFAULT_ORDER.indexOf(a[0]) - DEFAULT_ORDER.indexOf(b[0]));
  const top = order[0] ? { pattern: order[0][0], count: order[0][1], share: order[0][1] / total } : null;
  return { order: order.map(([pattern]) => pattern), top };
}

/** Candidate addresses, the company's own formats first and then the common ones, without repeats. */
export function emailCandidates(name: ParsedName, domain: string, evidence: DomainEvidence, max: number) {
  const out: Array<{ email: string; pattern: PatternKey }> = [];
  const seen = new Set<string>();
  for (const pattern of [...evidence.order, ...DEFAULT_ORDER]) {
    const local = localPart(pattern, name);
    if (!local || seen.has(local)) continue;
    seen.add(local);
    out.push({ email: `${local}@${domain}`, pattern });
    if (out.length >= max) break;
  }
  return out;
}

/** A guess is only kept, unverified, when the company clearly uses one format (at least 2 known addresses, 60% or more). */
export function confidentPattern(evidence: DomainEvidence) {
  return evidence.top && evidence.top.count >= 2 && evidence.top.share >= 0.6 ? evidence.top.pattern : null;
}
