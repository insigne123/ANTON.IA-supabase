/**
 * A LinkedIn company page as the extension reads it (plan 8, phase 4, PR-4d), and the keys that tell whether a saved contact or
 * an opportunity is the same company: its LinkedIn page, its web domain, or its name written without a legal suffix.
 */

/** «https://www.linkedin.com/company/Minera-Norte/people/?x=1» → «https://www.linkedin.com/company/minera-norte»; '' otherwise. */
export function canonicalCompanyUrl(value: string | null | undefined) {
  try {
    const raw = String(value || '').trim();
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^(www\.)?linkedin\.com$/i.test(url.hostname)) return '';
    const match = decodeURIComponent(url.pathname).normalize('NFC').match(/^\/company\/([\p{L}\p{N}][\p{L}\p{N}._-]{0,150})(?:\/|$)/u);
    return match ? `https://www.linkedin.com/company/${match[1].toLowerCase()}` : '';
  } catch {
    return '';
  }
}

/** The web domain of a site or an address: «https://www.mineranorte.cl/contacto» → «mineranorte.cl»; '' when it is not one. */
export function companyDomain(value: string | null | undefined) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
    return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host) && !/(^|\.)(linkedin\.com|lnkd\.in)$/.test(host) ? host : '';
  } catch {
    return '';
  }
}

/** The domain of an email address, or ''. */
export const emailDomain = (value: string | null | undefined) => companyDomain(String(value || '').split('@')[1] || '');

const LEGAL_SUFFIX = /\s(sa|sac|saa|spa|sas|ltda|limitada|inc|llc|ltd|corp|corporation|gmbh|srl|eirl|cia)$/;

/** A company name as people write it: «Minera Norte S.A.» and «MINERA NORTE» are both «minera norte». */
export function plainCompanyName(value: string | null | undefined) {
  let name = String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\./g, '').replace(/[^a-z0-9&]+/g, ' ').trim();
  while (LEGAL_SUFFIX.test(name)) name = name.replace(LEGAL_SUFFIX, '').trim();
  return name;
}

/** The name without its legal suffix, as written, for a text search: «Minera Norte S.A.» → «Minera Norte». */
export function companySearchName(value: string) {
  return value.replace(/[\s,]+(S\.?\s?A\.?\s?C?\.?|S\.?p\.?A\.?|SAS|Ltda\.?|Limitada|Inc\.?|LLC|Ltd\.?|Corp\.?|GmbH|S\.?R\.?L\.?|E\.?I\.?R\.?L\.?)\s*$/i, '').trim();
}

export type CompanyKeys = { linkedinUrl: string; domain: string; name: string };
/** Whether a record names the same company: the same LinkedIn page, the same domain, or the same plain name. */
export function sameCompany(keys: CompanyKeys, record: { linkedinUrl?: string | null; domains?: Array<string | null | undefined>; name?: string | null }) {
  if (keys.linkedinUrl && canonicalCompanyUrl(record.linkedinUrl) === keys.linkedinUrl) return true;
  if (keys.domain && (record.domains || []).some(domain => domain === keys.domain)) return true;
  const wanted = plainCompanyName(keys.name);
  return Boolean(wanted) && plainCompanyName(record.name) === wanted;
}
