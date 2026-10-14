import { createHash, createHmac } from 'node:crypto';
import { normalizeDomain } from '@/lib/domain';
import { normalizeLinkedinProfileUrl, linkedinProfilesMatch } from '@/lib/linkedin-url';
import { isMaskedName } from '@/lib/lead-name';

export const MICROWORLDS_ACTOR = 'microworlds~leads-finder';
export const MICROWORLDS_MAX_CONTACTS = 100;
export const MICROWORLDS_RUN_USD = 1.50;
export const MICROWORLDS_MONTH_USD = 20;
export const MICROWORLDS_TTL_DAYS = 30;
/** Leads Finder price per lead and per start on the account's Apify plan (FREE tier). */
export const MICROWORLDS_LEAD_USD = 0.003;
export const MICROWORLDS_START_USD = 0.001;
/** Leads bought per run: the people Apollo showed without a cached contact, plus half again (never fewer than 20). */
export const MICROWORLDS_MIN_CONTACTS = 20;
const positive = (value: string | undefined, fallback: number) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; };
/** Price per lead from the env when the plan changes (BRONZE 0.0017, GOLD 0.001). */
export const leadUsd = (env: Record<string,string|undefined> = process.env) => positive(env.MICROWORLDS_LEAD_USD, MICROWORLDS_LEAD_USD);
/** What one organization may spend on mirrors per month. The Apify plan is US$ 5 and shared with Opportunities. */
export const monthCapUsd = (env: Record<string,string|undefined> = process.env) => Math.min(MICROWORLDS_MONTH_USD, positive(env.MICROWORLDS_MONTH_USD, 4));
/** How many contacts to buy for a search where `uncovered` of the people shown are not in the cache yet. */
export function mirrorLimit(uncovered: number) {
  const shown = Number.isFinite(uncovered) ? Math.max(0, Math.ceil(uncovered)) : MICROWORLDS_MAX_CONTACTS;
  return Math.min(MICROWORLDS_MAX_CONTACTS, Math.max(MICROWORLDS_MIN_CONTACTS, Math.ceil(shown * 1.5)));
}
/** The real charge ceiling of one run: its leads and start at plan price, plus 10%, in whole cents. Apify stops there. */
export function runChargeUsd(limit: number, env: Record<string,string|undefined> = process.env) {
  return Math.min(MICROWORLDS_RUN_USD, Math.ceil((limit * leadUsd(env) + MICROWORLDS_START_USD) * 1.1 * 100) / 100);
}
export const hybridEnabled = (env: Record<string,string|undefined> = process.env) => env.MICROWORLDS_HYBRID_ENABLED === 'true';
const text = (value: unknown, max = 500) => typeof value === 'string' ? value.replace(/\s+/g,' ').trim().slice(0,max) : '';
const fold = (value: unknown) => text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const list = (values: unknown) => [...new Set((Array.isArray(values) ? values : []).map(v=>text(v,160)).filter(Boolean))].sort().slice(0,20);
export type MirrorCriteria = { domain: string; titles: string[]; personLocations: string[]; seniorities: string[]; limit?: number };
export function mirrorCriteria(input: {domain:unknown;titles?:unknown;personLocations?:unknown;seniorities?:unknown;limit?:unknown}): MirrorCriteria {
  const domain = normalizeDomain(text(input.domain,500));
  if (!domain||domain.length>253||!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)) throw Error('MIRROR_DOMAIN_REQUIRED');
  const criteria:MirrorCriteria={domain,titles:list(input.titles),personLocations:list(input.personLocations),seniorities:list(input.seniorities)};
  // Jobs queued before sizing have no limit: they keep buying the old 100.
  const limit=Number(input.limit);
  if(input.limit!==undefined&&Number.isInteger(limit)&&limit>=1&&limit<=MICROWORLDS_MAX_CONTACTS)criteria.limit=limit;
  return criteria;
}
/** The same company and filters within 30 days reuse one run, whatever size it bought. */
export function mirrorFingerprint(criteria: MirrorCriteria) {
  const {domain,titles,personLocations,seniorities}=criteria;
  return createHash('sha256').update(JSON.stringify({v:1,actor:MICROWORLDS_ACTOR,domain,titles,personLocations,seniorities,limit:100,mobile:true})).digest('hex');
}
/** A full run without title or location filters brought anyone at the company: a later search there needs no new run. */
export const coversAnySearch = (criteria: Pick<MirrorCriteria,'titles'|'personLocations'|'limit'>) =>
  !criteria.titles.length && !criteria.personLocations.length && (criteria.limit ?? MICROWORLDS_MAX_CONTACTS) >= MICROWORLDS_MAX_CONTACTS;
export function microworldsInput(criteria: MirrorCriteria) {
  // Company filters have already been applied by Apollo before company selection.
  // Seniority has no equivalent actor field. It is not reinterpreted as a title;
  // only identity-confirmed contacts from the visible Apollo population are used.
  return {max_result:criteria.limit??MICROWORLDS_MAX_CONTACTS,include_mobile:true,company_domains:[criteria.domain],
    contact_job_titles:criteria.titles,contact_location:criteria.personLocations,email_status:[]};
}
export type CachedContact = {
  fullName: string; firstName: string; lastName: string; domain: string;
  linkedinUrl: string | null; title: string; email: string | null;
  emailStatus: 'verified'|'unverified'|'unknown'; mobile: string | null;
};
export type ApolloIdentity = {id:string;fullName?:string;linkedinUrl?:string|null;domain:string;title?:string};
export function contactFromMicroworlds(row: Record<string,unknown>, domain: string): CachedContact | null {
  if(!row||typeof row!=='object'||Array.isArray(row))return null;
  const actualDomain=normalizeDomain(text(row.organization_primary_domain || row.organization_website_url));
  const firstName=text(row.first_name,100),lastName=text(row.last_name,150);
  const fullName=text(row.full_name || [firstName,lastName].filter(Boolean).join(' '),200);
  if(actualDomain!==domain||!fullName||isMaskedName(fullName))return null;
  const rawEmail=text(row.email,320).toLowerCase();
  const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)&&!rawEmail.includes('email_not_unlocked')?rawEmail:null;
  // Corporate switchboards are not personal mobile numbers. Never read organization phones.
  const rawMobile=text(row.mobile_number_formatted || row.mobile_number,64);
  const digits=rawMobile.replace(/[^\d]/g,'');
  const mobile=rawMobile.startsWith('+')&&digits.length>=8&&digits.length<=15?'+'+digits:null;
  const status=fold(row.email_status);
  return {fullName,firstName,lastName,domain,linkedinUrl:normalizeLinkedinProfileUrl(text(row.linkedin_url))||null,
    title:text(row.title,160),email,emailStatus:status==='verified'?'verified':status==='unverified'?'unverified':'unknown',mobile};
}
function hashKey(){const secret=process.env.INTERNAL_API_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY;if(!secret)throw Error('CACHE_KEY_UNAVAILABLE');return secret;}
export function cacheHash(kind:'profile'|'name'|'contact',value:string,org:string) {
  return createHmac('sha256',hashKey()).update(`microworlds:v1:${org}:${kind}:${fold(value)}`).digest('hex');
}
/** A partially masked name is not an identity. Exact LinkedIn wins; fully known
 * name + domain + exact role must be unique, with no conflicting known profile. */
export function chooseCachedContact(identity:ApolloIdentity,candidates:CachedContact[]):CachedContact|null {
  const scoped=candidates.filter(c=>c.domain===identity.domain);
  if(identity.linkedinUrl){const same=scoped.filter(c=>c.linkedinUrl&&linkedinProfilesMatch(identity.linkedinUrl,c.linkedinUrl));return same.length===1?same[0]:null;}
  if(!identity.fullName||isMaskedName(identity.fullName)||!identity.title)return null;
  const same=scoped.filter(c=>fold(c.fullName)===fold(identity.fullName)&&fold(c.title)===fold(identity.title));
  return same.length===1?same[0]:null;
}
export function residualFields(requested:{email:boolean;phone:boolean},existing:{email?:string|null;phone?:string|null},cache:CachedContact|null) {
  const email=existing.email||cache?.email||null,phone=existing.phone||cache?.mobile||null;
  return {apolloEmail:requested.email&&!email,apolloPhone:requested.phone&&!phone,
    verifyEmail:requested.email&&requested.phone&&!phone&&Boolean(email),cacheEmail:requested.email&&!existing.email?cache?.email||null:null,
    cachePhone:requested.phone&&!existing.phone?cache?.mobile||null:null};
}
