// Explicit bounded provider probe: two company results and two people, no reveals or DB writes.
import { writeFileSync } from 'node:fs';
import { coworkApolloPayload } from '../src/lib/cowork/search-proposal';
import { requestApolloSearch } from '../src/lib/server/apollo-search-client';

async function main() {
  if (!process.argv.includes('--live') || !process.env.APOLLO_API_KEY) throw new Error('Explicit provider access required');
  const results = [];
  for (const criteria of [
    { target: 'companies' as const, titles: [], locations: [], industries: ['outsourcing'], companyLocations: ['Chile'], employeeRanges: ['51-200'], limit: 2 },
    { target: 'people' as const, titles: ['Gerente de Recursos Humanos', 'Human Resources Manager'], locations: ['Chile'], industries: [], limit: 2 },
  ]) {
    try {
      const payload = coworkApolloPayload(criteria, 'de3a3194-29b1-449a-828a-53608a7ebe47');
      const response = await requestApolloSearch(payload);
      const rows = criteria.target === 'companies' ? response.organizations : response.leads;
      results.push({ target: criteria.target, criteria, status: 'provider_response', count: rows.length,
        // No contact names, addresses or tokens in diagnostic output.
        rows: rows.slice(0, 2).map((row: Record<string, unknown>) => ({
          hasIdentity: Boolean(row.id), hasDomain: Boolean(row.primary_domain || row.organization_domain),
          country: row.country || null, title: criteria.target === 'people' ? row.title : undefined,
          employees: criteria.target === 'companies' ? row.estimated_num_employees : undefined,
        })), organizationSearchCreditsReported: response.organization_search_credits ?? null,
      });
    } catch { results.push({ target: criteria.target, status: 'failed' }); break; }
  }
  const report = JSON.stringify({ results, limitation: 'Direct provider adapter, not approval/queue/UI. Organization search may incur provider credits. No enrichment or writes.' }, null, 2);
  const output = process.argv.find(a => a.startsWith('--output='))?.slice(9);
  if (output) writeFileSync(output, report + '\n');
  console.log(report);
}
main().catch(() => { console.error('Provider probe unavailable.'); process.exitCode = 1; });
