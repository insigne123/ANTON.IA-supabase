import assert from 'node:assert/strict';
import test from 'node:test';

import { syncLeadAutopilotToCrm } from '@/lib/server/crm-autopilot';

function fake(rpcResult: { data?: unknown; error?: unknown } = { data: 'suggestion-1', error: null }) {
  const upserts: Array<Record<string, unknown>> = [];
  const rpcs: Array<[string, Record<string, unknown>]> = [];
  const client = {
    from: () => ({ upsert: async (row: Record<string, unknown>) => { upserts.push(row); return { error: null }; } }),
    rpc: async (fn: string, args: Record<string, unknown>) => { rpcs.push([fn, args]); return { data: null, error: null, ...rpcResult }; },
  };
  return { client, upserts, rpcs };
}

test('an event never writes the stage: it leaves a suggestion with its reason and source', async () => {
  const { client, upserts, rpcs } = fake();
  await syncLeadAutopilotToCrm(client, {
    organizationId: 'org-1', leadId: 'lead-1', stage: 'engaged', notes: 'Lead hizo click en el contenido enviado',
    nextAction: 'Priorizar seguimiento', autopilotStatus: 'clicked', lastAutopilotEvent: 'click',
  });
  assert.deepEqual(rpcs, [['suggest_crm_stage_v1', {
    p_organization_id: 'org-1', p_lead_ref: 'lead-1', p_to_stage: 'engaged', p_reason: 'Hizo clic en el correo.', p_source: 'click',
    p_evidence: { event: 'click', autopilotStatus: 'clicked', note: 'Lead hizo click en el contenido enviado' },
  }]]);
  assert.equal(upserts.length, 2, 'the rest still goes to both pipeline rows');
  for (const row of upserts) {
    assert.equal('stage' in row, false, 'no stage is written');
    assert.equal(row.next_action, 'Priorizar seguimiento');
    assert.equal(row.organization_id, 'org-1');
  }
});

test('without a stage nothing is suggested; a failed suggestion is logged and the rest is still saved', async () => {
  const quiet = fake();
  await syncLeadAutopilotToCrm(quiet.client, { organizationId: 'org-1', leadId: 'lead-1', notes: 'Nota' });
  assert.equal(quiet.rpcs.length, 0);
  assert.equal(quiet.upserts.length, 2);

  const original = console.error; console.error = () => {};
  try {
    const failing = fake({ data: null, error: { message: 'function does not exist' } });
    await syncLeadAutopilotToCrm(failing.client, { organizationId: 'org-1', leadId: 'lead-1', stage: 'contacted', lastAutopilotEvent: 'delivered' });
    assert.equal(failing.upserts.length, 2);
  } finally { console.error = original; }
});

test('no lead, nothing happens', async () => {
  const { client, upserts, rpcs } = fake();
  await syncLeadAutopilotToCrm(client, { organizationId: 'org-1', leadId: '  ', stage: 'contacted' });
  assert.equal(upserts.length + rpcs.length, 0);
});
