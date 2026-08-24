import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NativeResearchBatchRequestSchema,
  NativeResearchLeadSchema,
  NativeResearchLeadStatusesRequestSchema,
  NativeResearchReprocessRequestSchema,
  NativeResearchRequestSchema,
} from '@/lib/native-research-contracts';

test('native research request accepts a lead with domain-only company identity', () => {
  const parsed = NativeResearchRequestSchema.parse({
    lead: {
      id: 'lead-1',
      fullName: 'Ana Silva',
      email: 'ana@example.com',
      companyDomain: 'example.com',
    },
    options: {},
  });

  assert.equal(parsed.options.depth, 'standard');
  assert.equal(parsed.lead.companyDomain, 'example.com');
});

test('native research request rejects an invalid recipient email', () => {
  assert.throws(() => NativeResearchRequestSchema.parse({
    lead: { id: 'lead-1', email: 'not-an-email', companyName: 'Example' },
  }));
});

test('native research requires a meaningful subject or company identity', () => {
  assert.equal(NativeResearchLeadSchema.safeParse({}).success, false);
  assert.equal(NativeResearchLeadSchema.safeParse({ title: 'Operations' }).success, false);
  assert.equal(NativeResearchLeadSchema.safeParse({ companyName: 'Example' }).success, true);
});

test('native research batch caps the requested workload at fifty leads', () => {
  const leads = Array.from({ length: 51 }, (_, index) => ({ id: `lead-${index}`, companyName: 'Example' }));
  assert.throws(() => NativeResearchBatchRequestSchema.parse({ leads }));
});

test('native research status lookup only accepts a bounded list of exact lead IDs', () => {
  const parsed = NativeResearchLeadStatusesRequestSchema.parse({ leadIds: ['lead-1', 'lead-2'] });
  assert.deepEqual(parsed.leadIds, ['lead-1', 'lead-2']);
  assert.throws(() => NativeResearchLeadStatusesRequestSchema.parse({ leadIds: [] }));
  assert.throws(() => NativeResearchLeadStatusesRequestSchema.parse({ leadIds: Array.from({ length: 201 }, (_, index) => `lead-${index}`) }));
});

test('reprocessing requires an explicit confirmation and stays batch-bounded', () => {
  assert.deepEqual(NativeResearchReprocessRequestSchema.parse({ confirm: true }), { confirm: true, limit: 50 });
  assert.equal(NativeResearchReprocessRequestSchema.safeParse({ confirm: false }).success, false);
  assert.equal(NativeResearchReprocessRequestSchema.safeParse({ confirm: true, limit: 51 }).success, false);
});
