import test from 'node:test';
import assert from 'node:assert/strict';

import {
  contactThreadConflictsWithLead,
  isCollaborationUnavailable,
  isLeadClaimActive,
  LeadCollaborationServiceError,
  resolveLeadUuid,
  type ContactThread,
  type LeadCollaboration,
} from './lead-collaboration-service';

const leadId = '10000000-0000-4000-8000-000000000001';

function collaboration(overrides: Partial<LeadCollaboration> = {}): LeadCollaboration {
  return {
    lead_id: leadId,
    organization_id: '20000000-0000-4000-8000-000000000001',
    discovered_by_user_id: null,
    discovered_at: '2026-08-26T12:00:00.000Z',
    assigned_to_user_id: null,
    assigned_at: null,
    assigned_by_user_id: null,
    claimed_by_user_id: null,
    claim_expires_at: null,
    contact_state: 'uncontacted',
    created_at: '2026-08-26T12:00:00.000Z',
    updated_at: '2026-08-26T12:00:00.000Z',
    ...overrides,
  };
}

function thread(overrides: Partial<ContactThread> = {}): ContactThread {
  return {
    id: '30000000-0000-4000-8000-000000000001',
    organization_id: '20000000-0000-4000-8000-000000000001',
    channel: 'email',
    recipient_key: 'recipient@example.test',
    recipient_email: 'recipient@example.test',
    status: 'active',
    active_lead_id: leadId,
    active_campaign_id: null,
    opened_by_user_id: '40000000-0000-4000-8000-000000000001',
    last_sent_by_user_id: '40000000-0000-4000-8000-000000000001',
    root_dispatch_id: null,
    reserved_dispatch_id: null,
    reservation_expires_at: null,
    first_contacted_at: null,
    last_contacted_at: null,
    closed_at: null,
    reopened_at: null,
    reopened_by_user_id: null,
    reopen_reason: null,
    created_at: '2026-08-26T12:00:00.000Z',
    updated_at: '2026-08-26T12:00:00.000Z',
    ...overrides,
  };
}

test('resolves only UUID-backed lead identifiers', () => {
  assert.equal(resolveLeadUuid({ id: leadId }), leadId);
  assert.equal(resolveLeadUuid({ gid: `lead|${leadId}` }), leadId);
  assert.equal(resolveLeadUuid({ id: 'legacy-lead', gid: 'lead|legacy-lead' }), null);
});

test('degrades only for the explicit disabled collaboration flag', () => {
  assert.equal(isCollaborationUnavailable(new LeadCollaborationServiceError('Organization collaboration is not enabled', 404)), true);
  assert.equal(isCollaborationUnavailable(new LeadCollaborationServiceError('Lead collaboration not found', 404)), false);
  assert.equal(isCollaborationUnavailable(new LeadCollaborationServiceError('Organization collaboration is not enabled', 500)), false);
});

test('treats lead claims as active only before their expiry', () => {
  const now = Date.parse('2026-08-26T12:00:00.000Z');
  assert.equal(isLeadClaimActive(collaboration({
    claimed_by_user_id: '40000000-0000-4000-8000-000000000001',
    claim_expires_at: '2026-08-26T12:15:00.000Z',
  }), now), true);
  assert.equal(isLeadClaimActive(collaboration({
    claimed_by_user_id: '40000000-0000-4000-8000-000000000001',
    claim_expires_at: '2026-08-26T11:59:59.000Z',
  }), now), false);
});

test('detects conflicts by lead identity and personal thread owner', () => {
  const ownerId = '40000000-0000-4000-8000-000000000001';
  assert.equal(contactThreadConflictsWithLead(thread(), leadId, ownerId), false);
  assert.equal(contactThreadConflictsWithLead(thread(), leadId, '40000000-0000-4000-8000-000000000002'), true);
  assert.equal(contactThreadConflictsWithLead(thread({
    active_lead_id: '10000000-0000-4000-8000-000000000002',
  }), leadId, ownerId), true);
  assert.equal(contactThreadConflictsWithLead(thread({ status: 'available' }), leadId, 'other-user'), false);
});
