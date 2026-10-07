/**
 * «Empresas contratando» (plan 8, phase 3): job ads from several sources become one opportunity per company. Pure: the
 * clients (src/lib/server/commercial-opportunities) bring the ads, this file normalizes them, sets aside staffing agencies
 * and anonymous posters, counts each ad once across sources, groups by company and scores against the search profile.
 * Data about companies only: the person who posted an ad is never kept.
 */

export type JobAdSource = 'jsearch' | 'linkedin' | 'jooble';
export type JobAd = {
  source: JobAdSource;
  externalId: string;
  title: string;
  company: string;
  companyDomain: string | null;
  companyLinkedinUrl: string | null;
  /** Headcount as the source gives it (a number or a bucket like «201-500»). */
  companySize: string | null;
  companyIndustry: string | null;
  location: string | null;
  region: string | null;
  /** The board that published it (Computrabajo, LinkedIn, Indeed…). */
  publisher: string | null;
  url: string | null;
  postedAt: string | null;
};
export type HiringProfile = {
  roles: string[]; regions: string[]; minAds: number; clients: string[]; contactsCompanies: string[];
  /** Other ways companies write each role (Plan 15, search-terms.ts): an ad for one of them counts for its role. */
  variants?: Record<string, string[]>;
};

const text = (value: unknown, max = 300) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const https = (value: unknown) => {
  const url = text(value, 2000);
  return /^https?:\/\//i.test(url) ? url : null;
};
export function domainOf(value: unknown) {
  const raw = text(value, 500);
  if (!raw) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, '');
    // A board or a social profile is not the company's site.
    if (!host.includes('.') || /(^|\.)(linkedin|facebook|instagram|computrabajo|laborum|trabajando|indeed|bumeran|chiletrabajos|google)\./.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

/** The sixteen regions of Chile, found by the region or by one of its main cities (English names included). */
const REGIONS: Array<{ region: string; terms: string[] }> = [
  { region: 'Arica y Parinacota', terms: ['arica'] },
  { region: 'Tarapacá', terms: ['tarapaca', 'iquique', 'alto hospicio', 'pozo almonte'] },
  { region: 'Antofagasta', terms: ['antofagasta', 'calama', 'mejillones', 'tocopilla', 'taltal'] },
  { region: 'Atacama', terms: ['atacama', 'copiapo', 'vallenar', 'caldera', 'chanaral'] },
  { region: 'Coquimbo', terms: ['coquimbo', 'la serena', 'ovalle', 'illapel', 'vicuna'] },
  { region: 'Valparaíso', terms: ['valparaiso', 'vina del mar', 'quilpue', 'villa alemana', 'san antonio', 'quillota', 'los andes', 'san felipe', 'concon'] },
  { region: 'Metropolitana', terms: ['metropolitana', 'metropolitan', 'santiago', 'providencia', 'las condes', 'maipu', 'puente alto', 'quilicura', 'pudahuel',
    'san bernardo', 'la florida', 'nunoa', 'vitacura', 'lo barnechea', 'huechuraba', 'renca', 'colina', 'lampa', 'buin', 'talagante', 'melipilla', 'cerrillos', 'estacion central'] },
  { region: "O'Higgins", terms: ["o'higgins", 'ohiggins', 'libertador', 'rancagua', 'san fernando', 'machali', 'rengo', 'santa cruz'] },
  { region: 'Maule', terms: ['maule', 'talca', 'curico', 'linares', 'constitucion', 'cauquenes'] },
  { region: 'Ñuble', terms: ['nuble', 'chillan'] },
  { region: 'Biobío', terms: ['biobio', 'bio bio', 'bio-bio', 'concepcion', 'talcahuano', 'los angeles', 'coronel', 'chiguayante', 'san pedro de la paz', 'hualpen'] },
  { region: 'La Araucanía', terms: ['araucania', 'temuco', 'angol', 'villarrica', 'padre las casas'] },
  { region: 'Los Ríos', terms: ['los rios', 'valdivia', 'la union'] },
  { region: 'Los Lagos', terms: ['los lagos', 'puerto montt', 'osorno', 'castro', 'puerto varas', 'ancud'] },
  { region: 'Aysén', terms: ['aysen', 'aisen', 'coyhaique'] },
  { region: 'Magallanes', terms: ['magallanes', 'punta arenas', 'puerto natales'] },
];
/** The regions in the north-to-south order of the country, for the search profile's choices. */
export const CHILE_REGIONS = REGIONS.map(item => item.region);
const wordIn = (haystack: string, needle: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(haystack);
export function chileanRegion(location: string | null | undefined) {
  if (!location) return null;
  const folded = fold(location);
  return REGIONS.find(item => item.terms.some(term => wordIn(folded, term)))?.region ?? null;
}

/** Staffing agencies and boards post for others: they are competitors or noise, not the company that hires. */
const AGENCY = /(servicios transitorios|\best\b|outsourcing|recursos humanos|\brr\.? ?hh\b|reclutamiento|seleccion de personal|headhunt|consultora (de |en )?(rr\.? ?hh|recursos humanos|personal|seleccion)|staffing|empleos temporales|trabajo temporal|manpower|adecco|randstad|kelly services|\bhays\b|michael page|page personnel|gi group|grupo expro|\bexpro\b|trabajando\.com|laborum|computrabajo|bumeran|chiletrabajos|indeed)/;
/** Ads that hide who hires cannot become a company to contact. */
const ANONYMOUS = /^(confidencial|empresa confidencial|importante empresa|reconocida empresa|empresa lider|empresa del rubro|cliente confidencial|anonimo|n\/a|-)$|^(importante|reconocida|destacada|prestigiosa) empresa\b/;
export function employerKind(company: string): 'company' | 'agency' | 'anonymous' {
  const folded = fold(company).trim();
  if (!folded || ANONYMOUS.test(folded)) return 'anonymous';
  return AGENCY.test(folded) ? 'agency' : 'company';
}

const LEGAL = /\b(s\.?\s?a\.?|spa|s\.?p\.?a\.?|ltda\.?|limitada|eirl|e\.i\.r\.l\.?|sociedad anonima|y cia\.?|cia\.?|inc\.?|llc|corp\.?|chile|group|grupo)\b/g;
/** The same company under its site or, without one, under its name without legal suffixes («Securitas Chile S.A.» → securitas). */
export function companyKey(ad: Pick<JobAd, 'company' | 'companyDomain'>) {
  if (ad.companyDomain) return `domain:${ad.companyDomain}`;
  const name = fold(ad.company).replace(LEGAL, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return name ? `name:${name}` : '';
}

const iso = (value: unknown) => {
  const raw = typeof value === 'number' ? new Date(value > 1e12 ? value : value * 1000).toISOString() : text(value, 40);
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

/** One ad from JSearch (Google for Jobs), as its /search endpoint returns it. */
export function jobAdFromJSearch(raw: Record<string, unknown>): JobAd | null {
  const externalId = text(raw.job_id, 300), title = text(raw.job_title, 300), company = text(raw.employer_name, 300);
  if (!externalId || !title) return null;
  const location = [raw.job_city, raw.job_state, raw.job_country].map(value => text(value, 80)).filter(Boolean).join(', ') || text(raw.job_location, 200) || null;
  return {
    source: 'jsearch', externalId, title, company,
    companyDomain: domainOf(raw.employer_website), companyLinkedinUrl: null, companySize: null, companyIndustry: null,
    location, region: chileanRegion(location), publisher: text(raw.job_publisher, 120) || null,
    url: https(raw.job_apply_link) || https(raw.job_google_link), postedAt: iso(raw.job_posted_at_datetime_utc ?? raw.job_posted_at_timestamp),
  };
}

/** One ad from the LinkedIn Job Search API of Fantastic Jobs (Apify actor fantastic-jobs/advanced-linkedin-job-search-api). */
export function jobAdFromFantastic(raw: Record<string, unknown>): JobAd | null {
  // Fantastic.jobs changed IDs from strings to integers in June 2026.
  const id = raw.id ?? raw.linkedin_id;
  const externalId = typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? String(id) : text(id, 300);
  const title = text(raw.title, 300), company = text(raw.organization, 300);
  if (!externalId || !title) return null;
  const derived = Array.isArray(raw.locations_derived) ? raw.locations_derived : [];
  const first = derived[0];
  const location = typeof first === 'string' ? text(first, 200)
    : first && typeof first === 'object' ? ['city', 'admin', 'country'].map(key => text((first as Record<string, unknown>)[key], 80)).filter(Boolean).join(', ')
    : text(raw.location, 200);
  const headcount = typeof raw.org_linkedin_headcount === 'number' ? String(raw.org_linkedin_headcount) : text(raw.org_linkedin_size ?? raw.linkedin_org_size, 40);
  return {
    source: 'linkedin', externalId, title, company,
    companyDomain: domainOf(raw.org_linkedin_website) || domainOf(raw.organization_url ?? raw.linkedin_org_url_website ?? raw.linkedin_org_url),
    companyLinkedinUrl: https(raw.organization_linkedin_url ?? raw.linkedin_org_url)
      || (/^[a-z0-9-]+$/i.test(text(raw.org_linkedin_slug)) ? `https://www.linkedin.com/company/${text(raw.org_linkedin_slug)}` : null),
    companySize: headcount || null, companyIndustry: text(raw.org_linkedin_industry ?? raw.linkedin_org_industry, 120) || null,
    location: location || null, region: chileanRegion(location), publisher: 'LinkedIn', url: https(raw.url), postedAt: iso(raw.date_posted),
  };
}

/** «operario» also finds «Operaria», «Operarios» and «Operario/a»; «conductor» finds «Conductores». */
const rolePattern = (role: string) => {
  const needle = fold(role).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stem = needle.endsWith('o') ? `${needle.slice(0, -1)}[oa]s?` : `${needle}(?:a|as|es|s)?`;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${stem}($|[^\\p{L}\\p{N}])`, 'u');
};
const roleOf = (title: string, roles: string[], variants: Record<string, string[]> = {}) => {
  const folded = fold(title);
  return roles.find(role => rolePattern(role).test(folded))
    ?? roles.find(role => (variants[role] || []).some(variant => rolePattern(variant).test(folded))) ?? null;
};

/**
 * Whether an ad is in the regions a search asked for (Plan 15). An ad whose place is not known is kept: it may well be there,
 * and leaving it out would hide companies that only say «Chile».
 */
export function adInRegions(ad: Pick<JobAd, 'region'>, regions: string[]) {
  return !regions.length || !ad.region || regions.some(region => fold(region) === fold(ad.region!));
}
const DAY = 86_400_000;
const headcountOf = (size: string | null) => {
  if (!size) return null;
  const numbers = size.replace(/\./g, '').match(/\d+/g)?.map(Number) || [];
  return numbers.length ? Math.max(...numbers) : null;
};

export type HiringOpportunity = ReturnType<typeof groupHiring>['opportunities'][number];

/**
 * Companies with at least `minAds` distinct ads in the window, best first. The same ad in two boards counts once (same company,
 * title and region within a week). Agencies and anonymous posters are counted apart, never listed.
 */
export function groupHiring(ads: JobAd[], profile: HiringProfile, options: { now: string; windowDays?: number }) {
  const now = Date.parse(options.now);
  const windowDays = options.windowDays ?? 30;
  const since = now - windowDays * DAY;
  const skipped = { agency: 0, anonymous: 0, old: 0, noCompany: 0 };
  // `ads` counts each posting once; `all` keeps every copy, so a duplicate still brings its company data (size, site, LinkedIn).
  const byCompany = new Map<string, { ads: JobAd[]; all: JobAd[]; seen: Set<string> }>();
  for (const ad of ads) {
    const posted = ad.postedAt ? Date.parse(ad.postedAt) : now;
    if (posted < since) { skipped.old++; continue; }
    const kind = employerKind(ad.company);
    if (kind !== 'company') { skipped[kind]++; continue; }
    const key = companyKey(ad);
    if (!key) { skipped.noCompany++; continue; }
    const entry = byCompany.get(key) || { ads: [], all: [], seen: new Set<string>() };
    entry.all.push(ad);
    // One posting seen in two boards the same week is one ad.
    const week = Math.floor(posted / (7 * DAY));
    const same = `${fold(ad.title).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}|${ad.region || ''}|${week}`;
    if (!entry.seen.has(same)) { entry.seen.add(same); entry.ads.push(ad); }
    byCompany.set(key, entry);
  }
  const clients = profile.clients.map(name => companyKey({ company: name, companyDomain: null }));
  const contacts = new Set(profile.contactsCompanies.map(name => companyKey({ company: name, companyDomain: null })));
  const opportunities = [...byCompany].flatMap(([key, entry]) => {
    const list = entry.ads;
    if (list.length < profile.minAds) return [];
    const pick = <T,>(values: Array<T | null>) => values.find((value): value is T => value !== null && value !== undefined) ?? null;
    const company = list.map(ad => ad.company).sort((a, b) => a.length - b.length)[0];
    const lastWeek = list.filter(ad => (ad.postedAt ? Date.parse(ad.postedAt) : now) >= now - 7 * DAY).length;
    const roles = new Map<string, number>(), regions = new Map<string, number>();
    for (const ad of list) {
      const role = profile.roles.length ? roleOf(ad.title, profile.roles, profile.variants) : null;
      if (role) roles.set(role, (roles.get(role) || 0) + 1);
      if (ad.region) regions.set(ad.region, (regions.get(ad.region) || 0) + 1);
    }
    const matching = [...roles.values()].reduce((sum, value) => sum + value, 0);
    const size = pick(entry.all.map(ad => ad.companySize));
    const headcount = headcountOf(size);
    const reasons: string[] = [];
    let score = Math.min(40, Math.round(10 * Math.log2(list.length + 1)));
    reasons.push(`${list.length} avisos en ${windowDays} días${lastWeek ? ` (${lastWeek} en la última semana)` : ''}`);
    if (lastWeek >= 3) score += 10; else if (lastWeek >= 1) score += 5;
    if (profile.roles.length && matching) {
      const share = matching / list.length;
      score += share >= 0.8 ? 20 : share >= 0.5 ? 12 : 6;
      reasons.push(`cargos: ${[...roles].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([role, count]) => `${role} (${count})`).join(', ')}`);
    }
    const topRegions = [...regions].sort((a, b) => b[1] - a[1]);
    const inProfileRegion = profile.regions.length ? topRegions.find(([region]) => profile.regions.some(wanted => fold(wanted) === fold(region))) : undefined;
    if (inProfileRegion) { score += 10; reasons.push(`en ${inProfileRegion[0]}`); }
    else if (topRegions.length) reasons.push(`en ${topRegions.slice(0, 2).map(([region]) => region).join(' y ')}`);
    if (headcount !== null) {
      if (headcount >= 200) score += 10; else if (headcount >= 50) score += 5;
      reasons.push(`${size} empleados`);
    }
    const isClient = clients.some(client => client && (client === key || client === companyKey({ company, companyDomain: null })));
    const isContact = contacts.has(key) || contacts.has(companyKey({ company, companyDomain: null }));
    if (isClient) reasons.push('ya es cliente');
    else if (isContact) reasons.push('ya tienes contactos ahí');
    else reasons.push('aún no es contacto');
    const sorted = [...list].sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''));
    return [{
      key, company, domain: pick(entry.all.map(ad => ad.companyDomain)), linkedinUrl: pick(entry.all.map(ad => ad.companyLinkedinUrl)),
      size, industry: pick(entry.all.map(ad => ad.companyIndustry)), ads: list.length, adsLastWeek: lastWeek,
      roles: [...roles].sort((a, b) => b[1] - a[1]).map(([role, count]) => ({ role, ads: count })),
      regions: topRegions.map(([region, count]) => ({ region, ads: count })),
      publishers: [...new Set(entry.all.map(ad => ad.publisher).filter((value): value is string => Boolean(value)))],
      sources: [...new Set(entry.all.map(ad => ad.source))],
      firstPostedAt: sorted[sorted.length - 1]?.postedAt ?? null, lastPostedAt: sorted[0]?.postedAt ?? null,
      score: Math.min(100, score), reasons, isClient, isContact,
      evidence: sorted.slice(0, 5).map(ad => ({ source: ad.source, externalId: ad.externalId, title: ad.title, location: ad.location,
        publisher: ad.publisher, url: ad.url, postedAt: ad.postedAt })),
      signals: [...entry.all].sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || '')),
    }];
  }).sort((a, b) => Number(a.isClient) - Number(b.isClient) || b.score - a.score || b.ads - a.ads || a.company.localeCompare(b.company));
  return { opportunities, companiesSeen: byCompany.size, adsCounted: [...byCompany.values()].reduce((sum, entry) => sum + entry.ads.length, 0), skipped };
}
