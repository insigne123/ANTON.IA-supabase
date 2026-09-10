import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApolloPublicCompanyIdentity, loadApolloResearchContext } from './apollo-research-context';
import { mapRowToEnrichedLead } from '@/lib/services/enriched-leads-service';

const row = {
  id: 'dfe72b50-e617-42f1-9fa5-aec32ce0687d', organization_id: 'team', user_id: 'other-owner',
  source_provider: 'apollo', source_provider_id: 'contact-id-not-company',
  organization_domain: 'grupoexpro.com', full_name: 'Constanza Iturra Gavilan',
  data: { companyDomain: 'grupoexpro.com', organization: {
    id: '54a134b269702d2db411b800', domain: 'grupoexpro.com', website_url: 'http://www.grupoexpro.com',
  } },
};
const request = {
  organizationId: 'team', userId: 'request-owner',
  lead: { id: row.id, companyDomain: 'grupoexpro.com', companyWebsite: null, country: 'Chile' },
  language: 'es', depth: 'deep' as const, apolloContext: null,
};

function database(stored = row, member = true, duplicate: any = null) {
  const calls: Array<{ table: string; columns: string; filters: Record<string, string> }> = [];
  return { calls, from(table: string) {
    const call = { table, columns: '', filters: {} as Record<string, string> };
    calls.push(call);
    const query = {
      select(columns: string) { call.columns = columns; return query; },
      eq(key: string, value: string) { call.filters[key] = value; return query; },
      async maybeSingle() {
        const source = table === 'organization_members' ? (member ? { organization_id: 'team', user_id: 'request-owner' } : null)
          : table === 'enriched_leads' ? stored : table === 'enriched_opportunities' ? duplicate : null;
        if (!source || Object.entries(call.filters).some(([key, value]) => (source as any)[key] !== value)) return { data: null, error: null };
        if (!call.columns.includes('provider_organization_id:')) return { data: source, error: null };
        const org = (source as typeof row).data.organization;
        return { data: { id: (source as typeof row).id,
          stored_domain: table === 'enriched_leads' ? (source as typeof row).organization_domain : (source as typeof row).data.companyDomain,
          provider_domain: org.domain,
          primary_domain: (org as any).primary_domain, provider_organization_id: org.id, website: org.website_url }, error: null };
      },
    };
    return query;
  } };
}

test('original missing-website team lead enrolls from exact stored Apollo company, not private owner context', async () => {
  const admin = database();
  assert.equal(await loadApolloResearchContext({ ...request, leadId: row.id, companyDomain: request.lead.companyDomain }, admin), null);
  const identity = await loadApolloPublicCompanyIdentity(request, admin);
  assert.equal(identity?.apolloOrganizationId, row.data.organization.id);
  assert.equal(identity?.country, 'CL');
  assert.equal(identity?.depth, 'deep');
  assert.equal(JSON.stringify(identity).includes('other-owner'), false);
  const reads = admin.calls.filter((call) => call.columns.includes('provider_organization_id:'));
  assert.equal(reads.length, 2);
  for (const call of reads) {
    assert.deepEqual(call.filters, { id: row.id, organization_id: 'team', source_provider: 'apollo' });
    assert.doesNotMatch(call.columns, /(?:full_name|email|phone|source_provider_id|\bdata,)/);
  }
});

test('actual enriched caller mapping preserves the local row ID, domain and nested Apollo website', () => {
  const lead = mapRowToEnrichedLead(row);
  assert.equal(lead.id, request.lead.id);
  assert.notEqual(lead.id, row.source_provider_id);
  assert.equal(lead.organizationDomain, request.lead.companyDomain);
  assert.equal(lead.companyWebsite, row.data.organization.website_url);
});

test('company identity refuses other tenants, revoked membership, other references and non-Apollo rows', async () => {
  for (const overrides of [{ organization_id: 'other-team' }, { id: 'other-lead' }, { source_provider: 'manual' }]) {
    assert.equal(await loadApolloPublicCompanyIdentity(request, database({ ...row, ...overrides })), null);
  }
  const admin = database(row, false);
  assert.equal(await loadApolloPublicCompanyIdentity(request, admin), null);
  assert.equal(admin.calls.length, 1);
  assert.equal(await loadApolloPublicCompanyIdentity({ ...request, lead: { ...request.lead, id: null } }, database()), null);
});

test('no name/contact-ID fallback or conflicting domains, websites or organization merges', async () => {
  for (const organization of [
    { ...row.data.organization, id: '' },
    { ...row.data.organization, domain: 'other.example' },
    { ...row.data.organization, primary_domain: 'other.example' },
    { ...row.data.organization, domain: 'other.example', primary_domain: 'grupoexpro.com' },
    { ...row.data.organization, website_url: 'https://other.example' },
    { ...row.data.organization, website_url: '' },
  ]) {
    assert.equal(await loadApolloPublicCompanyIdentity(request, database({ ...row, data: { ...row.data, organization } })), null);
  }
  assert.equal(await loadApolloPublicCompanyIdentity({ ...request, lead: { ...request.lead, companyWebsite: 'https://other.example' } }, database()), null);
  assert.equal(await loadApolloPublicCompanyIdentity(request, database({ ...row, organization_domain: 'new-employer.example' })), null);
  const conflicting = { ...row, data: { ...row.data, organization: { ...row.data.organization, id: 'different-company' } } };
  assert.equal(await loadApolloPublicCompanyIdentity(request, database(row, true, conflicting)), null);
  const before = await loadApolloPublicCompanyIdentity(request, database());
  const after = await loadApolloPublicCompanyIdentity(request, database(conflicting));
  assert.notDeepEqual(after, before);
});

test('database failures fail closed and owned Apollo hydration still requires the requested exact domain', async () => {
  const admin = database();
  const context = await loadApolloResearchContext({ organizationId: 'team', userId: 'other-owner', leadId: row.id }, admin);
  assert.ok(context);
  const owned = await loadApolloPublicCompanyIdentity({ ...request, userId: 'other-owner', apolloContext: context }, admin);
  assert.equal(owned?.apolloOrganizationId, row.data.organization.id);
  assert.equal(await loadApolloPublicCompanyIdentity({ ...request, lead: { ...request.lead, companyDomain: 'other.example' }, apolloContext: context }, admin), null);
  const failing = { from() { const query = { select() { return query; }, eq() { return query; },
    async maybeSingle() { return { data: null, error: new Error('database unavailable') }; } }; return query; } };
  await assert.rejects(loadApolloPublicCompanyIdentity(request, failing), /database unavailable/);
});
