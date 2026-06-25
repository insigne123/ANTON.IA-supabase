import test from 'node:test';
import assert from 'node:assert/strict';

import { getSupliaPolicy } from './suplia-policy';

test('external search and enrichment require approval', () => {
  assert.deepEqual(getSupliaPolicy('prospecting.search_companies'), {
    riskLevel: 'medium',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Las busquedas externas pueden consumir creditos de proveedor.',
  });

  assert.equal(getSupliaPolicy('prospecting.search_people').requiresApproval, true);
  assert.equal(getSupliaPolicy('lead.enrich').requiresApproval, true);
  assert.equal(getSupliaPolicy('lead.enrich_batch').requiresApproval, true);
});

test('campaign launch, resume, reply send and bulk send are strong approvals', () => {
  for (const toolName of ['campaign.launch', 'campaign.resume', 'thread.reply_send', 'email.bulk_send']) {
    const policy = getSupliaPolicy(toolName);
    assert.equal(policy.requiresApproval, true, toolName);
    assert.equal(policy.approvalKind, 'strong', toolName);
  }
});

test('safe planning, reading and compliance tools run without approval', () => {
  for (const toolName of ['campaigns.get', 'prospecting.build_search_plan', 'compliance.preflight_campaign', 'memory.propose']) {
    const policy = getSupliaPolicy(toolName);
    assert.equal(policy.requiresApproval, false, toolName);
    assert.equal(policy.approvalKind, 'none', toolName);
  }
});

test('workflow plan approval is a simple internal approval', () => {
  assert.deepEqual(getSupliaPolicy('workflow.approve_plan'), {
    riskLevel: 'low',
    requiresApproval: true,
    approvalKind: 'simple',
    approvalReason: 'Aprueba el plan operativo antes de continuar con subagentes. No consume creditos ni ejecuta acciones externas.',
  });
});

test('persistent data changes require approval', () => {
  for (const toolName of ['campaign.create_draft', 'campaign.update', 'crm.assign_owner', 'followup.create_tasks', 'memory.save', 'memory.forget', 'playbook.create', 'playbook.update', 'playbook.archive', 'playbook.apply']) {
    const policy = getSupliaPolicy(toolName);
    assert.equal(policy.requiresApproval, true, toolName);
    assert.notEqual(policy.approvalKind, 'none', toolName);
  }
});

test('playbook reads do not require approval', () => {
  for (const toolName of ['playbook.list', 'playbook.get']) {
    const policy = getSupliaPolicy(toolName);
    assert.equal(policy.requiresApproval, false, toolName);
    assert.equal(policy.approvalKind, 'none', toolName);
  }
});

test('gmail private reads require simple approval', () => {
  for (const toolName of ['gmail.search_messages', 'gmail.get_message', 'gmail.get_thread', 'gmail.search_threads', 'gmail.find_contacted_leads']) {
    const policy = getSupliaPolicy(toolName);
    assert.equal(policy.requiresApproval, true, toolName);
    assert.equal(policy.approvalKind, 'simple', toolName);
    assert.equal(policy.riskLevel, 'medium', toolName);
  }

  const profilePolicy = getSupliaPolicy('gmail.profile.get');
  assert.equal(profilePolicy.requiresApproval, false);
  assert.equal(profilePolicy.approvalKind, 'none');
});
