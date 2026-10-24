// Whether a page is about a company. The pages the researcher picks come from a web search by name, and a namesake (SalfaCorp and Salfa, Besalco and
// Besco) is how a fact about another company ends up in an email to this one. The research reads every page itself, so it can look for the name:
// a page the researcher picked that says neither the company's name nor its address is not read for facts.
import type { ParsedWebEvidenceV2 } from '@/lib/report-v2-extraction';

const fold = (value: string) => String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The words of a name that say what kind of company it is or where it is, not which one: «S.A.», «Chile», «Grupo», the articles. */
const GENERIC = new Set(['sa', 'spa', 'ltda', 'limitada', 'sac', 'eirl', 'inc', 'llc', 'corp', 'corporation', 'sociedad', 'anonima', 'empresa', 'empresas', 'compania', 'company',
  'group', 'grupo', 'holding', 'chile', 'peru', 'colombia', 'latam', 'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'and', 'the']);
const SECOND_LEVEL = new Set(['com', 'co', 'org', 'net', 'gob', 'gov', 'edu']);
const MAX_SCANNED = 400_000;

/** What the company is called on a page: its name without the legal form and the country («Sodexo Chile» → «sodexo»), the words of the name that are long
 * enough to say it alone (a name of three words or more is often shortened: «Minera Collahuasi»), and the label of its address («aguasandinas»). */
export function companyNames(companyName: string, domain: string): { phrases: string[]; words: string[] } {
  const tokens = fold(companyName).split(' ').filter(Boolean);
  const kept = tokens.filter(token => token.length > 1 && !GENERIC.has(token));
  const phrase = (kept.length ? kept : tokens).join(' ');
  const host = String(domain || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase();
  const parts = host.split('.').filter(Boolean);
  const label = parts.length >= 3 && SECOND_LEVEL.has(parts[parts.length - 2]) ? parts[parts.length - 3] : (parts[parts.length - 2] ?? parts[0] ?? '');
  const phrases = [...new Set([phrase, fold(label)].filter(value => value.length >= 3))];
  const longest = kept.length >= 3 ? [...kept].sort((a, b) => b.length - a.length)[0] : '';
  return { phrases, words: longest.length >= 7 ? [longest] : [] };
}

/** True when the page says the name of the company (or the address of its site) as whole words, or is a page of the company's own site. */
export function pageMentionsCompany(page: Pick<ParsedWebEvidenceV2, 'text' | 'source'>, companyName: string, domain: string): boolean {
  if (page.source.ownDomain) return true;
  const { phrases, words } = companyNames(companyName, domain);
  if (!phrases.length && !words.length) return true;
  const text = ` ${fold(`${page.source.title} ${page.source.url} ${page.text.slice(0, MAX_SCANNED)}`)} `;
  return [...phrases, ...words].some(needle => text.includes(` ${needle} `));
}
