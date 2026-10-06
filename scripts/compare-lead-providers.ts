// Plan 11, PR 6a: does Apify «Leads Finder» find the same people as Apollo for the same filters? Runs one search on each
// with the keys from the environment (APOLLO_API_KEY, APIFY_TOKEN), never writes to the database and never prints a key,
// an email or a phone: only counts, masked names and companies. Usage:
//   node --loader ./scripts/ts-test-loader.mjs scripts/compare-lead-providers.ts [--filters='{"titles":["Gerente de Personas"],"personLocations":["Chile"]}'] [--max=50] [--live] [--only=leads-finder] [--output=report.json]
// Without --live it only prints the input each provider would receive (no network, no cost). --only=leads-finder runs Leads Finder
// alone (no APOLLO_API_KEY needed): what it finds, its cost and how much of it matches the filters.
import { writeFileSync } from 'node:fs';
import { executeApolloLeadSearch, getApolloApiKey } from '../src/lib/server/apollo-provider/apollo';
import { getGatewayConfig } from '../src/lib/server/apollo-provider/gateway';
import type { LeadSearchInput } from '../src/lib/server/apollo-provider/validation';
import { searchLeadsFinder } from '../src/lib/server/leads-finder/client';
import { leadsFinderInput } from '../src/lib/server/leads-finder/input';

const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const fold = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/** The same person in both lists: first name and company domain (Apollo's search masks the last name). */
const personKey = (lead: { first_name?: string | null; organization_domain?: string | null; organization_name?: string | null }) =>
  `${fold(lead.first_name)}|${fold(lead.organization_domain || lead.organization_name)}`;

const maskName = (name: unknown) => String(name ?? '').trim().split(/\s+/).map((part, index) => (index === 0 ? part : `${part.charAt(0)}.`)).join(' ');

const DEFAULT_FILTERS: Partial<LeadSearchInput> = { titles: ['Gerente de Personas', 'Gerente de Recursos Humanos'], personLocations: ['Chile'] };

async function main() {
  const filters = { ...(arg('filters') ? JSON.parse(arg('filters')!) : DEFAULT_FILTERS) } as Partial<LeadSearchInput>;
  const maxResults = Math.max(1, Math.min(100, Number(arg('max') || 50)));
  const input: LeadSearchInput = {
    provider: 'apollo', searchMode: 'batch', revealEmail: false, revealPhone: false, organizationDomains: [], titles: [], seniorities: [],
    industryKeywords: [], companyKeywords: [], companyLocations: [], personLocations: [], employeeRanges: [], includeSimilarTitles: true,
    ...filters, maxResults,
  };
  const mapped = leadsFinderInput(input);
  console.log('Leads Finder input:', JSON.stringify(mapped, null, 2));
  if (!process.argv.includes('--live')) { console.log('Dry run: add --live to search (Apollo search is free; Leads Finder costs ~US$0.002 per lead).'); return; }
  const finderOnly = arg('only') === 'leads-finder';
  if (!process.env.APIFY_TOKEN || (!finderOnly && !getApolloApiKey(process.env))) {
    throw new Error(finderOnly ? 'Set APIFY_TOKEN in the environment.' : 'Set APOLLO_API_KEY and APIFY_TOKEN in the environment (or use --only=leads-finder).');
  }

  const startedApollo = Date.now();
  const apollo = finderOnly ? { leads: [] as Array<Record<string, any>> }
    : await executeApolloLeadSearch(input, getApolloApiKey(process.env), getGatewayConfig(process.env)) as { leads: Array<Record<string, any>> };
  const apolloMs = Date.now() - startedApollo;
  const startedFinder = Date.now();
  const finder = await searchLeadsFinder(input);
  const finderMs = Date.now() - startedFinder;

  const apolloLeads = apollo.leads || [];
  const finderLeads = finder.results.map(result => ({ ...result.lead, emailStatus: result.contact.emailStatus, hasLinkedin: Boolean(result.contact.linkedinUrl) }));
  const apolloKeys = new Set(apolloLeads.map(personKey));
  const shared = finderLeads.filter(lead => apolloKeys.has(personKey(lead))).length;
  const titleWords = (input.titles || []).flatMap(title => fold(title).split(/\s+/)).filter(word => word.length > 3);
  const titleMatch = (title: unknown) => titleWords.length === 0 || titleWords.some(word => fold(title).includes(word));
  const share = (part: number, total: number) => (total ? Math.round((part / total) * 1000) / 10 : 0);
  const report = {
    filters: input, at: new Date().toISOString(),
    apollo: finderOnly ? null : {
      found: apolloLeads.length, ms: apolloMs, withEmail: share(apolloLeads.filter(lead => lead.has_email).length, apolloLeads.length),
      titleMatch: share(apolloLeads.filter(lead => titleMatch(lead.title)).length, apolloLeads.length),
      companies: new Set(apolloLeads.map(lead => fold(lead.organization_domain || lead.organization_name))).size,
      sample: apolloLeads.slice(0, 8).map(lead => `${lead.name} · ${lead.title || ''} · ${lead.organization_name || ''}`),
    },
    leadsFinder: {
      found: finderLeads.length, ms: finderMs, costUsd: finder.costUsd, notApplied: finder.notApplied,
      validatedEmail: share(finderLeads.filter(lead => lead.emailStatus === 'validated').length, finderLeads.length),
      withPhone: share(finderLeads.filter(lead => lead.has_direct_phone).length, finderLeads.length),
      withLinkedin: share(finderLeads.filter(lead => lead.hasLinkedin).length, finderLeads.length),
      titleMatch: share(finderLeads.filter(lead => titleMatch(lead.title)).length, finderLeads.length),
      companies: new Set(finderLeads.map(lead => fold(lead.organization_domain || lead.organization_name))).size,
      // Leads Finder returns full names: the sample keeps the first name and the initial of the last one.
      sample: finderLeads.slice(0, 8).map(lead => `${maskName(lead.name)} · ${lead.title || ''} · ${lead.organization_name || ''}`),
    },
    overlap: finderOnly ? null : { samePeople: shared, ofLeadsFinder: share(shared, finderLeads.length), ofApollo: share(shared, apolloLeads.length) },
  };
  console.log(JSON.stringify(report, null, 2));
  const output = arg('output');
  if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
