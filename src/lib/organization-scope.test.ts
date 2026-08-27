import test from 'node:test';
import assert from 'node:assert/strict';

import { selectActiveOrganizationMembership, type OrganizationMembership } from './organization-scope';

const memberships: OrganizationMembership[] = [
  { organizationId: '10000000-0000-4000-8000-000000000001', role: 'owner', createdAt: '2026-01-01T00:00:00Z' },
  { organizationId: '10000000-0000-4000-8000-000000000002', role: 'member', createdAt: '2026-02-01T00:00:00Z' },
];

test('uses a valid stored workspace instead of always selecting the first membership', () => {
  assert.equal(selectActiveOrganizationMembership(memberships, null, memberships[1].organizationId)?.organizationId, memberships[1].organizationId);
});

test('falls back safely when a stored workspace is stale', () => {
  assert.equal(selectActiveOrganizationMembership(memberships, null, 'stale-workspace')?.organizationId, memberships[0].organizationId);
});

test('explicit organization scope must match a current membership', () => {
  assert.equal(selectActiveOrganizationMembership(memberships, memberships[1].organizationId, memberships[0].organizationId)?.organizationId, memberships[1].organizationId);
  assert.equal(selectActiveOrganizationMembership(memberships, '10000000-0000-4000-8000-000000000099', memberships[0].organizationId), null);
});
