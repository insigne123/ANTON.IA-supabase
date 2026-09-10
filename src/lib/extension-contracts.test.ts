import test from 'node:test';
import assert from 'node:assert/strict';
import { ExtensionProfileSchema, ExtensionRequestSchema, extensionLeadId, assertExtensionScope } from './extension-contracts';

const organizationId = '550e8400-e29b-41d4-a716-446655440000';
const userId = '550e8400-e29b-41d4-a716-446655440001';
test('normalizes LinkedIn identity and keeps workspace identities separate', () => {
  const profile = ExtensionProfileSchema.parse({ linkedinUrl: 'linkedin.com/in/josé-pérez/?trk=profile' });
  assert.equal(profile.linkedinUrl, 'https://www.linkedin.com/in/jos%C3%A9-p%C3%A9rez');
  assert.equal(extensionLeadId(organizationId, profile.linkedinUrl), extensionLeadId(organizationId, 'https://www.linkedin.com/in/JOSÉ-PÉREZ/'));
  assert.notEqual(extensionLeadId(organizationId, profile.linkedinUrl), extensionLeadId(userId, profile.linkedinUrl));
  for (const url of ['https://linkedin.com.evil.test/in/person', 'https://www.linkedin.com/sales/lead/123', 'https://www.linkedin.com/company/test']) {
    assert.equal(ExtensionProfileSchema.safeParse({ linkedinUrl: url }).success, false);
  }
});
test('requires confirmed scope for operations and validates sequence offsets', () => {
  assert.equal(ExtensionRequestSchema.safeParse({ action: 'save', profile: { linkedinUrl: 'linkedin.com/in/test' } }).success, false);
  for (const offsets of [[7, 3], [3, 3], [0], [366]]) {
    assert.equal(ExtensionRequestSchema.safeParse({ action: 'sequence', userId, organizationId, profile: { linkedinUrl: 'linkedin.com/in/test' }, offsets }).success, false);
  }
  assert.throws(() => assertExtensionScope({ userId, organizationId }, { user: { id: organizationId }, organizationId }), /SESSION_CHANGED/);
  assert.throws(() => assertExtensionScope({ userId, organizationId }, { user: { id: userId }, organizationId: userId }), /SESSION_CHANGED/);
  assert.doesNotThrow(() => assertExtensionScope({ userId, organizationId }, { user: { id: userId }, organizationId }));
});
