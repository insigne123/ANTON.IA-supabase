import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getFreshApolloOrganizationContext,
  persistApolloOrganizationContext,
  sanitizeApolloOrganizationContext,
} from './apollo-organization-context';

test('Apollo organization context keeps firmographics and strips unknown contact data', () => {
  const context = sanitizeApolloOrganizationContext({
    provider: 'apollo',
    status: 'completed',
    organization: {
      id: 'apollo-org-1',
      name: 'People Co',
      primary_domain: 'people.co',
      website_url: 'https://people.co/about',
      linkedin_url: 'https://www.linkedin.com/company/people-co',
      industry: 'Software',
      estimated_num_employees: 240,
      keywords: ['automation'],
      email: 'private@people.co',
      phone: '+15550100001',
    },
  }, 'https://www.people.co/contact');
  assert.ok(context);
  assert.equal(context.primary_domain, 'people.co');
  assert.equal(context.estimated_num_employees, 240);
  assert.equal(JSON.stringify(context).includes('private@people.co'), false);
  assert.equal(JSON.stringify(context).includes('+15550100001'), false);
});

test('fresh Apollo organization context is scoped by tenant, user, domain, and TTL', async () => {
  const filters: Array<[string, string]> = [];
  const admin = {
    from() {
      const query = {
        select() { return query; },
        eq(column: string, value: string) { filters.push([column, value]); return query; },
        gte(column: string, value: string) { filters.push([column, value]); return query; },
        async maybeSingle() {
          return {
            data: {
              organization_context: { id: 'apollo-org-1', name: 'People Co', primary_domain: 'people.co' },
              observed_at: '2026-09-01T12:00:00.000Z',
            },
            error: null,
          };
        },
      };
      return query;
    },
  };
  const cached = await getFreshApolloOrganizationContext({
    organizationId: 'tenant-1',
    userId: 'user-1',
    domain: 'www.people.co',
    environment: { APOLLO_ORGANIZATION_CONTEXT_TTL_DAYS: '30' },
  }, admin);
  assert.equal(cached?.organization.name, 'People Co');
  assert.deepEqual(filters.slice(0, 3), [
    ['organization_id', 'tenant-1'],
    ['user_id', 'user-1'],
    ['normalized_domain', 'people.co'],
  ]);
  assert.equal(filters[3]?.[0], 'observed_at');
});

test('organization persistence atomically completes the owned quota operation', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: true, error: null };
    },
  };
  await persistApolloOrganizationContext({
    organizationId: 'tenant-1',
    userId: 'user-1',
    operationId: 'operation-1',
    claimToken: 'claim-1',
    organization: { id: 'apollo-org-1', name: 'People Co', primary_domain: 'people.co' },
    observedAt: '2026-09-01T12:00:00.000Z',
    responsePayload: { provider: 'apollo', status: 'completed' },
  }, admin);
  assert.equal(calls[0]?.name, 'complete_apollo_organization_enrichment_v1');
  assert.equal(calls[0]?.args.p_normalized_domain, 'people.co');
  assert.equal(calls[0]?.args.p_claim_token, 'claim-1');
});
