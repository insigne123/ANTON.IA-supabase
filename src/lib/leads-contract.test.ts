import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeFromN8N } from '@/lib/normalizers/n8n';
import { CompanyNameSearchRequestSchema } from '@/lib/schemas/leads';

test('company name schema allows domain-only search', () => {
  const parsed = CompanyNameSearchRequestSchema.safeParse({
    search_mode: 'company_name',
    organization_domains: ['acme.com'],
    titles: ['CEO'],
  });

  assert.equal(parsed.success, true);
});

test('normalizeFromN8N preserves stable backend lead fields', () => {
  const response = normalizeFromN8N({
    leads_count: 1,
    leads: [
      {
        id: 'lead-1',
        name: 'Jane Doe',
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@acme.com',
        title: 'CEO',
        linkedin_url: 'https://www.linkedin.com/in/jane-doe',
        organization_name: 'Acme',
        organization_id: 'org-1',
        organization_domain: 'acme.com',
        organization_website: 'https://acme.com',
        organization_industry: 'software',
        organization_size: 120,
        city: 'Santiago',
        state: 'RM',
        country: 'Chile',
        headline: 'Building Acme',
        seniority: 'c_suite',
        departments: ['executive'],
        page: 2,
        batch_run_id: 'batch-1',
        updated_at: '2026-04-08T00:00:00.000Z',
      },
    ],
  });

  const lead = response.leads[0];
  assert.equal(response.count, 1);
  assert.equal(lead.name, 'Jane Doe');
  assert.equal(lead.organization_name, 'Acme');
  assert.equal(lead.organization_id, 'org-1');
  assert.equal(lead.organization_domain, 'acme.com');
  assert.equal(lead.organization_website, 'https://acme.com');
  assert.equal(lead.organization_industry, 'software');
  assert.equal(lead.organization_size, 120);
  assert.equal(lead.city, 'Santiago');
  assert.equal(lead.country, 'Chile');
  assert.equal(lead.headline, 'Building Acme');
  assert.deepEqual(lead.departments, ['executive']);
  assert.equal(lead.batch_run_id, 'batch-1');
});
