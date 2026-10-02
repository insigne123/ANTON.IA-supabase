// Plan 8, phase 3, PR-3b: what each source of «empresas contratando» brings for the GrupoExpro pilot, before trusting it.
// Runs the pilot search on JSearch and on Fantastic Jobs (Apify) with the keys from the environment, never writes to the
// database and never prints a key. Usage:
//   node --loader ./scripts/ts-test-loader.mjs scripts/measure-opportunity-sources.ts --live [--jsearch-pages=1] [--fantastic-limit=200] [--output=report.json]
import { writeFileSync } from 'node:fs';
import { employerKind, groupHiring, type JobAd } from '../src/lib/commercial-opportunities/hiring';
import { GRUPOEXPRO_PILOT, pilotHiringProfile } from '../src/lib/commercial-opportunities/pilot';
import { searchJSearch } from '../src/lib/server/commercial-opportunities/jsearch';
import { searchFantasticJobs } from '../src/lib/server/commercial-opportunities/fantastic-jobs';

const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const count = <T,>(items: T[], key: (item: T) => string) => Object.fromEntries(
  Object.entries(items.reduce<Record<string, number>>((acc, item) => { const k = key(item); acc[k] = (acc[k] || 0) + 1; return acc; }, {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 15));

async function main() {
  if (!process.argv.includes('--live')) throw new Error('Requires --live: it spends from the JSearch and Apify plans.');
  const now = new Date().toISOString();
  const profile = pilotHiringProfile();
  const sources: Record<string, { ads: JobAd[]; costUsd: number; error?: string }> = {};
  if (process.env.JSEARCH_API_KEY) {
    const pages = Math.max(1, Math.min(3, Number(arg('jsearch-pages') || 1)));
    const ads: JobAd[] = []; let costUsd = 0; let error: string | undefined;
    for (const role of GRUPOEXPRO_PILOT.roles.slice(0, 9)) {
      try { const result = await searchJSearch({ query: role, numPages: pages }); ads.push(...result.ads); costUsd += result.costUsd; }
      catch (failure) { error = failure instanceof Error ? failure.message : String(failure); break; }
    }
    sources.jsearch = { ads, costUsd, ...(error ? { error } : {}) };
  }
  if (process.env.APIFY_TOKEN) {
    try {
      const result = await searchFantasticJobs({ titles: [...GRUPOEXPRO_PILOT.roles], limit: Math.max(10, Math.min(500, Number(arg('fantastic-limit') || 200))) });
      sources.linkedin = { ads: result.ads, costUsd: result.costUsd };
    } catch (failure) { sources.linkedin = { ads: [], costUsd: 0, error: failure instanceof Error ? failure.message : String(failure) }; }
  }
  if (!Object.keys(sources).length) throw new Error('No key: set JSEARCH_API_KEY and/or APIFY_TOKEN.');
  const perSource = Object.fromEntries(Object.entries(sources).map(([name, source]) => {
    const grouped = groupHiring(source.ads, profile, { now });
    return [name, {
      ads: source.ads.length, costUsd: source.costUsd, error: source.error ?? null,
      employers: count(source.ads, ad => employerKind(ad.company)), withSite: source.ads.filter(ad => ad.companyDomain).length,
      withRegion: source.ads.filter(ad => ad.region).length, publishers: count(source.ads, ad => ad.publisher || 'sin portal'),
      regions: count(source.ads, ad => ad.region || 'sin región'), companiesSeen: grouped.companiesSeen,
      companiesWithMinAds: grouped.opportunities.length, skipped: grouped.skipped,
    }];
  }));
  const all = Object.values(sources).flatMap(source => source.ads);
  const combined = groupHiring(all, profile, { now });
  const keysBySource = Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, new Set(groupHiring(source.ads, { ...profile, minAds: 1 }, { now }).opportunities.map(item => item.key))]));
  const names = Object.keys(keysBySource);
  const overlap = names.length === 2 ? [...keysBySource[names[0]]].filter(key => keysBySource[names[1]].has(key)).length : null;
  const report = {
    mode: 'measure_opportunity_sources', at: now, profile: { roles: profile.roles, minAds: profile.minAds }, perSource,
    combined: { ads: all.length, companiesSeen: combined.companiesSeen, adsCounted: combined.adsCounted, companiesWithMinAds: combined.opportunities.length,
      companiesInBothSources: overlap, skipped: combined.skipped },
    top: combined.opportunities.slice(0, 15).map(item => ({ company: item.company, score: item.score, ads: item.ads, reasons: item.reasons,
      sources: item.sources, publishers: item.publishers })),
    costUsd: Math.round(Object.values(sources).reduce((sum, source) => sum + source.costUsd, 0) * 10_000) / 10_000,
  };
  const output = arg('output');
  if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ perSource, combined: report.combined, costUsd: report.costUsd, top: report.top.slice(0, 5) }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
