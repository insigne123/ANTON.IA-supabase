// What the radar saw of a signal, read from the opportunity's own data (no AI): a company that is hiring (its ads, roles, regions and
// the pace of the last week) or a LinkedIn post (who wrote it, when, what it says). The commercial sheet draws its charts from this, so
// a sheet has a pulse even before anyone asks for the written report. Pure: the page, the PDF and the tests read the same thing.

export type SignalRelation = 'client' | 'contact' | 'new';
export type Bar = { label: string; value: number; /** Of the largest bar, 0 to 1: how long it is drawn. */ share: number; /** Of the total, 0 to 1, when there is a total. */ percent: number | null };
/** The week that just passed against the weekly average of the days before it: whether hiring sped up. */
export type Pace = { lastWeek: number; priorWeekly: number; times: number | null };
export type AdSample = { title: string; where: string | null; when: string | null; publisher: string | null; url: string | null };

export type HiringFacts = {
  kind: 'hiring'; company: string; domain: string | null; linkedinUrl: string | null; industry: string | null; size: string | null;
  ads: number; adsLastWeek: number; windowDays: number; firstPostedAt: string | null; lastPostedAt: string | null;
  roles: Bar[]; regions: Bar[]; publishers: string[]; sample: AdSample[]; relation: SignalRelation; pace: Pace | null;
};
export type PostFacts = {
  kind: 'linkedin_post'; author: string; authorUrl: string | null; authorType: 'person' | 'company' | null; postedAt: string | null; text: string;
  summary: string | null; truncated: boolean; /** Whether the author is known to be who the post says it is. */ verified: boolean; url: string | null;
};
export type SignalFacts = HiringFacts | PostFacts;

export type SignalItem = {
  kind: string; title?: string | null; company_name?: string | null; company_domain?: string | null; company_linkedin_url?: string | null; url?: string | null;
  data?: Record<string, unknown> | null;
};

const text = (value: unknown, max = 600) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const count = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0; };
const when = (value: unknown) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null);
/** Only web links go out of the app. */
const web = (value: unknown) => { const url = text(value, 500); return /^https?:\/\//i.test(url) ? url : null; };

/** Bars from `{ label, value }` rows: biggest first, each drawn against the biggest and as a share of the total. */
export function bars(rows: ReadonlyArray<{ label: string; value: number }>, total: number | null = null): Bar[] {
  const clean = rows.filter(row => row.label && row.value > 0).sort((a, b) => b.value - a.value);
  const top = clean[0]?.value || 1;
  return clean.map(row => ({ label: row.label, value: row.value, share: row.value / top, percent: total && total > 0 ? Math.min(1, row.value / total) : null }));
}

export function pace(ads: number, adsLastWeek: number, windowDays: number): Pace | null {
  if (!(ads > 0) || !(windowDays > 7) || adsLastWeek > ads) return null;
  const priorWeekly = (ads - adsLastWeek) / ((windowDays - 7) / 7);
  return { lastWeek: adsLastWeek, priorWeekly, times: priorWeekly > 0 ? adsLastWeek / priorWeekly : null };
}

/** The company's relation to the team, as the radar knows it (a client counts over a contact). */
export const relationOf = (data: Record<string, unknown>): SignalRelation => (data.isClient === true ? 'client' : data.isContact === true ? 'contact' : 'new');
export const RELATION_LABELS: Record<SignalRelation, string> = { client: 'Ya es tu cliente', contact: 'Ya tienes contactos ahí', new: 'Empresa nueva para ti' };

const rows = (value: unknown, key: string): Array<{ label: string; value: number }> => (Array.isArray(value) ? value.flatMap((row: any) => (text(row?.[key], 80) ? [{ label: text(row[key], 80), value: count(row.ads) }] : [])) : []);

export function signalFacts(item: SignalItem): SignalFacts | null {
  const data = (item.data && typeof item.data === 'object' ? item.data : {}) as Record<string, unknown>;
  if (item.kind === 'hiring') {
    const ads = count(data.ads);
    const windowDays = count(data.windowDays) || 30;
    const evidence = Array.isArray(data.evidence) ? data.evidence : [];
    return {
      kind: 'hiring', company: text(item.company_name, 200) || text(item.title, 200) || 'Empresa', domain: text(item.company_domain, 200) || null, linkedinUrl: web(item.company_linkedin_url),
      industry: text(data.industry, 120) || null, size: text(data.size, 40) || null, ads, adsLastWeek: Math.min(ads, count(data.adsLastWeek)), windowDays,
      firstPostedAt: when(data.firstPostedAt), lastPostedAt: when(data.lastPostedAt),
      roles: bars(rows(data.roles, 'role'), ads), regions: bars(rows(data.regions, 'region'), ads),
      publishers: (Array.isArray(data.publishers) ? data.publishers : []).map(value => text(value, 60)).filter(Boolean).slice(0, 8),
      sample: evidence.slice(0, 8).map((ad: any) => ({ title: text(ad?.title, 200) || 'Aviso', where: text(ad?.location, 120) || null, when: when(ad?.postedAt), publisher: text(ad?.publisher, 60) || null, url: web(ad?.url) })),
      relation: relationOf(data), pace: pace(ads, Math.min(ads, count(data.adsLastWeek)), windowDays),
    };
  }
  if (item.kind === 'linkedin_post') {
    const observed = (data.observed && typeof data.observed === 'object' ? data.observed : {}) as Record<string, unknown>;
    const summary = data.summary && typeof data.summary === 'object' ? text((data.summary as Record<string, unknown>).text, 400) : '';
    const type = observed.authorType;
    return {
      kind: 'linkedin_post', author: text(item.company_name, 200) || 'Autor de la publicación', authorUrl: web(observed.authorUrl)?.split('?')[0] ?? null,
      authorType: type === 'company' ? 'company' : type === 'profile' || type === 'person' ? 'person' : null, postedAt: when(observed.postedAt), text: text(data.description, 2500) || text(item.title, 2500),
      summary: summary || null, truncated: observed.truncated === true, verified: observed.authorshipVerified === true, url: web(item.url),
    };
  }
  return null;
}

/** Whole days between `at` and `now` (0 for today, never negative); null without a date. */
export function daysSince(at: string | null | undefined, now = Date.now()) {
  const time = at ? Date.parse(at) : NaN;
  return Number.isFinite(time) ? Math.max(0, Math.floor((now - time) / 86_400_000)) : null;
}
/** «hoy», «ayer», «hace 3 días», «hace 2 semanas», «hace 3 meses». */
export function agoText(days: number | null) {
  if (days === null) return '';
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 14) return `hace ${days} días`;
  if (days < 60) return `hace ${Math.round(days / 7)} semanas`;
  return `hace ${Math.round(days / 30)} meses`;
}
