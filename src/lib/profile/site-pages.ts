import { isSameResearchCompanyDomain } from '@/lib/research-fact-eligibility';

/**
 * Which pages of a company site describe it, for the profile autofill (src/ai/flows/generate-company-profile.ts). Pure: it
 * only reads links. Fetching, DNS checks and redirects stay in the research reader (fetchCompanyProfileSite), which
 * re-validates every address it is given.
 */

const COUNTRY_SLUGS: Record<string, string[]> = {
  chile: ['chile', 'cl', 'es-cl'],
  peru: ['peru', 'pe', 'es-pe'],
  colombia: ['colombia', 'co', 'es-co'],
  mexico: ['mexico', 'mx', 'es-mx'],
  argentina: ['argentina', 'ar', 'es-ar'],
};

type LinkCategory = 'offer' | 'company' | 'proof' | 'pricing';

const POSITIVE: Array<[RegExp, number, LinkCategory]> = [
  [/servicio|services?|solucion|solution|producto|product|portfolio|plataforma|platform|que-hacemos|what-we-do|ofrecemos|modulo|module|features?|funcionalidad/, 9, 'offer'],
  [/nosotros|quienes|about|empresa|company|historia|who-we-are|acerca|somos|mision/, 8, 'company'],
  [/cliente|customer|casos|case|exito|success|testimonio|partner|alianza|certific|industria|sector|industr|rubro/, 6, 'proof'],
  [/precio|pricing|planes|plans/, 3, 'pricing'],
];

/** Pages that never describe the offer: news, jobs, sign-in, contact forms, legal notices, files. */
const NOISE = /blog|noticia|news|category|categoria|\/tag\/|author|evento|webinar|podcast|ebook|recursos|resources|academy|cursos?\b|careers?|jobs?\b|empleo|trabaja|postula|vacante|login|ingresar|signin|sign-in|registr|contact|contacto|privacidad|privacy|termino|terms|aviso-legal|legal-notice|politica|policy|cookies|denuncia|preguntas|faq|ayuda|help|soporte|support|descarga|download|wp-content|feed|\.(?:pdf|jpe?g|png|zip|docx?)$/;

function fold(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function safeLink(href: string, baseUrl: URL, domain: string) {
  try {
    const url = new URL(href, baseUrl);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.port) return null;
    if (!isSameResearchCompanyDomain(url.toString(), domain)) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function anchors(html: string) {
  const result: Array<{ href: string; label: string }> = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && result.length < 600) {
    result.push({ href: match[1], label: match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
  }
  return result;
}

/** A home page that only asks for the country («Selecciona tu país») links to /chile/, /cl/ or /es-cl/: that page is the real home. */
export function countryLandingUrl(html: string, baseUrl: URL, domain: string, country = 'Chile') {
  const slugs = COUNTRY_SLUGS[fold(country)] || [fold(country)];
  for (const { href } of anchors(html)) {
    const url = safeLink(href, baseUrl, domain);
    if (!url) continue;
    const segments = url.pathname.split('/').filter(Boolean).map(fold);
    if (segments.length === 1 && slugs.includes(segments[0])) return url.toString();
  }
  return null;
}

/** Links to read, best first: offer, company and proof pages; at most `perSection` from the same section (e.g. /portfolio/). */
export function profilePageCandidates(input: {
  pages: Array<{ html: string; url: string }>;
  domain: string;
  exclude?: string[];
  limit: number;
  perSection?: number;
}) {
  const excluded = new Set((input.exclude || []).map((url) => url.replace(/\/$/, '')));
  const links = new Map<string, { score: number; category: LinkCategory }>();
  for (const page of input.pages) {
    const base = new URL(page.url);
    for (const { href, label } of anchors(page.html)) {
      const url = safeLink(href, base, input.domain);
      if (!url || url.pathname === '/' || url.search.length > 60) continue;
      const key = url.toString().replace(/\/$/, '');
      if (excluded.has(key)) continue;
      if (NOISE.test(fold(url.pathname)) || NOISE.test(fold(label))) continue;
      const target = fold(`${url.pathname} ${label}`);
      const match = POSITIVE.find(([pattern]) => pattern.test(target));
      if (!match) continue;
      const score = match[1] + (url.pathname.split('/').filter(Boolean).length <= 2 ? 1 : 0);
      if ((links.get(key)?.score || 0) < score) links.set(key, { score, category: match[2] });
    }
  }
  const ranked = [...links.entries()]
    .sort((left, right) => right[1].score - left[1].score || left[0].length - right[0].length || left[0].localeCompare(right[0]));
  // One page about the company and one with proof (clients, cases, certifications) go first, so the offer pages do not
  // take every slot; then the rest by score, at most `perSection` from the same section (e.g. /portfolio/).
  const first = (category: LinkCategory) => ranked.find(([, link]) => link.category === category);
  const ordered = [first('company'), first('proof'), ...ranked].filter((entry): entry is [string, { score: number; category: LinkCategory }] => Boolean(entry));
  const perSection = input.perSection ?? 4;
  const sections = new Map<string, number>();
  const picked: string[] = [];
  for (const [url] of ordered) {
    if (picked.includes(url)) continue;
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const section = segments.length > 1 ? segments[0] : '';
    const used = sections.get(section) || 0;
    if (section && used >= perSection) continue;
    sections.set(section, used + 1);
    picked.push(url);
    if (picked.length >= input.limit) break;
  }
  return picked;
}

const ENTITIES: Record<string, string> = { amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>', ndash: '–', mdash: '—', hellip: '…' };

function decodeEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code) || 32))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16) || 32))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? ' ');
}

/**
 * A page as a visitor reads it, for the profile: title, description and the visible text without menus, scripts, forms,
 * links or code. Lenient on purpose: marketing copy is what a profile needs, so only challenge pages are dropped (by the
 * reader), never «generic» statements.
 */
export function readableProfilePage(url: string, html: string) {
  const source = String(html || '').slice(0, 400_000);
  const pick = (pattern: RegExp) => decodeEntities(source.match(pattern)?.[1] || '').replace(/\s+/g, ' ').trim();
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i).slice(0, 160);
  const description = (pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)
    || pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)).slice(0, 400);
  const text = decodeEntities(source
    .replace(/<(script|style|noscript|svg|nav|footer|form|iframe|template|select)\b[\s\S]*?(?:<\/\1>|$)/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(?:p|div|li|h[1-6]|section|article|br|tr)>/gi, '. ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\bhttps?:\/\/\S+/gi, ' ')
    .replace(/[{}$;=]+\S*/g, ' ')
    .replace(/(?:\s*\.\s*){2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6_000);
  return { url, title: title || null, description: description || null, text };
}
