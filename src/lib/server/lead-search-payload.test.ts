import assert from 'node:assert/strict';
import test from 'node:test';

import { N8NRequestBodySchema } from '@/lib/schemas/leads';
import { buildBatchLeadSearchPayload } from './lead-search-payload';

test('batch payload preserves each UI filter and uses one employee range field', () => {
  const [currentParams] = N8NRequestBodySchema.parse([{
    industry_keywords: ['Technology'],
    company_keywords: ['payroll', 'onboarding'],
    company_location: ['Chile'],
    person_locations: ['Santiago'],
    employee_ranges: ['51-200'],
    titles: ['HR Director', 'VP People'],
    seniorities: ['director'],
    include_similar_titles: false,
    max_results: 25,
  }]);

  const payload = buildBatchLeadSearchPayload(currentParams, {
    provider: 'apollo',
    userId: 'user-1',
  });

  assert.deepEqual(payload, {
    provider: 'apollo',
    user_id: 'user-1',
    search_mode: 'batch',
    industry_keywords: ['Technology'],
    company_keywords: ['payroll', 'onboarding'],
    company_location: ['Chile'],
    person_locations: ['Santiago'],
    titles: ['HR Director', 'VP People'],
    seniorities: ['director'],
    include_similar_titles: false,
    employee_ranges: ['51-200'],
    max_results: 25,
  });
  assert.equal('employee_range' in payload, false);
});

test('batch payload normalizes legacy string titles without changing the filter contract', () => {
  const [currentParams] = N8NRequestBodySchema.parse([{
    titles: ' Founder ',
  }]);

  const payload = buildBatchLeadSearchPayload(currentParams, {
    provider: 'apollo',
  });

  assert.deepEqual(payload.titles, ['Founder']);
  assert.equal(payload.user_id, undefined);
});
