import assert from 'node:assert/strict';
import test from 'node:test';

import {
  apolloCompanyResearchContext,
  apolloResearchContextForPrompt,
  apolloResearchContextInternals,
  buildApolloResearchContextFromRows,
  loadApolloResearchContext,
  mergeApolloResearchContextIntoLead,
  parseApolloResearchContext,
} from './apollo-research-context';

function apolloRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    full_name: 'Ada Lovelace',
    title: 'Directora de Operaciones',
    company_name: 'Acme',
    organization_domain: 'acme.example',
    organization_industry: 'Software',
    organization_size: 240,
    source_provider: 'apollo',
    source_provider_id: 'apollo-person-1',
    updated_at: '2026-09-01T12:00:00.000Z',
    data: {
      providerObservedAt: '2026-09-01T11:59:00.000Z',
      email: 'private@acme.example',
      primaryPhone: '+15550100001',
      organization: {
        name: 'Acme',
        short_description: 'Acme coordina operaciones regionales.',
      },
    },
    ...overrides,
  };
}

test('Apollo research context is deterministic and strips all contact data', () => {
  const context = buildApolloResearchContextFromRows([
    { table: 'enriched_leads', row: apolloRow() },
  ]);
  assert.ok(context);
  assert.match(context.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(context.person.fullName, 'Ada Lovelace');
  assert.equal(context.company.description, 'Acme coordina operaciones regionales.');
  assert.equal(JSON.stringify(context).includes('private@acme.example'), false);
  assert.equal(JSON.stringify(context).includes('+15550100001'), false);

  const changed = buildApolloResearchContextFromRows([
    { table: 'enriched_leads', row: apolloRow({ organization_industry: 'Logistics' }) },
  ]);
  assert.ok(changed);
  assert.notEqual(context.fingerprint, changed.fingerprint);
});

test('stored Apollo context is integrity-checked and re-sanitized before prompt use', () => {
  const context = buildApolloResearchContextFromRows([
    { table: 'enriched_leads', row: apolloRow() },
  ]);
  assert.ok(context);
  const withInjectedContact = {
    ...context,
    person: { ...context.person, email: 'injected@acme.example', phone: '+15550100002' },
  };
  const parsed = parseApolloResearchContext(withInjectedContact);
  assert.ok(parsed);
  const promptContext = apolloResearchContextForPrompt(parsed);
  assert.equal(JSON.stringify(promptContext).includes('injected@acme.example'), false);
  assert.equal(JSON.stringify(promptContext).includes('+15550100002'), false);

  assert.equal(parseApolloResearchContext({ ...context, observedAt: '2026-09-02T00:00:00.000Z' }), null);
});

test('Apollo context hydrates research identity without importing operational email', () => {
  const context = buildApolloResearchContextFromRows([
    { table: 'enriched_leads', row: apolloRow() },
  ]);
  const lead = mergeApolloResearchContextIntoLead({
    id: 'lead-1',
    email: 'request-owner@acme.example',
    companyName: 'Stale Acme',
  }, context);
  assert.equal(lead.email, 'request-owner@acme.example');
  assert.equal(lead.fullName, 'Ada Lovelace');
  assert.equal(lead.companyName, 'Acme');
  assert.equal(lead.organizationIndustry, 'Software');
});

test('company cache context excludes person identity and is shared across people', () => {
  const first = buildApolloResearchContextFromRows([
    { table: 'enriched_leads', row: apolloRow() },
  ]);
  const second = buildApolloResearchContextFromRows([
    { table: 'people_search_leads', row: apolloRow({ id: 'lead-2', full_name: 'Grace Hopper', source_provider_id: 'apollo-person-2' }) },
  ]);
  const firstCompany = apolloCompanyResearchContext(first);
  const secondCompany = apolloCompanyResearchContext(second);
  assert.ok(firstCompany);
  assert.ok(secondCompany);
  assert.equal(firstCompany.fingerprint, secondCompany.fingerprint);
  assert.equal(JSON.stringify(firstCompany).includes('Ada Lovelace'), false);
  assert.equal(JSON.stringify(firstCompany).includes('apollo-person-1'), false);
  assert.equal('sources' in firstCompany, false);
});

test('Apollo context loader scopes every exact reference by record, organization, and user', async () => {
  const calls: Array<{ table: string; columns: string; filters: Array<[string, string]> }> = [];
  const admin = {
    from(table: string) {
      const call = { table, columns: '', filters: [] as Array<[string, string]> };
      calls.push(call);
      const query = {
        select(columns: string) {
          call.columns = columns;
          return query;
        },
        eq(column: string, value: string) {
          call.filters.push([column, value]);
          return query;
        },
        async maybeSingle() {
          if (table === 'enriched_leads') return { data: apolloRow(), error: null };
          if (table === 'apollo_organization_contexts') {
            return {
              data: {
                normalized_domain: 'acme.example',
                observed_at: '2026-09-02T12:00:00.000Z',
                organization_context: {
                  id: 'apollo-org-1',
                  name: 'Acme Global',
                  primary_domain: 'acme.example',
                  industry: 'Enterprise software',
                  keywords: ['operations', 'automation'],
                },
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      };
      return query;
    },
  };

  const context = await loadApolloResearchContext({
    organizationId: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    leadId: 'lead-1',
  }, admin);
  assert.ok(context);
  assert.equal(context.company.name, 'Acme Global');
  assert.deepEqual(context.company.keywords, ['operations', 'automation']);
  assert.deepEqual(calls.map((call) => call.table).sort(), [
    ...Object.keys(apolloResearchContextInternals.TABLE_SELECTS),
    'apollo_organization_contexts',
  ].sort());
  for (const call of calls.filter((item) => item.table !== 'apollo_organization_contexts')) {
    assert.deepEqual(call.filters, [
      ['id', 'lead-1'],
      ['organization_id', '00000000-0000-4000-8000-000000000001'],
      ['user_id', '00000000-0000-4000-8000-000000000002'],
    ]);
    assert.doesNotMatch(`,${call.columns},`, /,(?:email|email_status|primary_phone|phone_numbers),/);
  }
  const organizationCall = calls.find((call) => call.table === 'apollo_organization_contexts');
  assert.deepEqual(organizationCall?.filters, [
    ['organization_id', '00000000-0000-4000-8000-000000000001'],
    ['user_id', '00000000-0000-4000-8000-000000000002'],
    ['normalized_domain', 'acme.example'],
  ]);
});
