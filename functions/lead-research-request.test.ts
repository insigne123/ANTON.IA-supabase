import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildFirebaseLeadResearchRequestKey } from './lead-research-request';

const indexSource = readFileSync('functions/index.ts', 'utf8');
const helperSource = readFileSync('functions/lead-research-request.ts', 'utf8');
const migrationSource = readFileSync('supabase/migrations/20260813103000_atomic_lead_research_request_claim.sql', 'utf8');

test('firebase investigation request identity is stable and isolated by task and lead', () => {
    const input = {
        organizationId: 'org-1',
        userId: 'user-1',
        taskId: 'task-1',
        leadRef: 'lead-1',
    };
    assert.equal(buildFirebaseLeadResearchRequestKey(input), buildFirebaseLeadResearchRequestKey(input));
    assert.notEqual(buildFirebaseLeadResearchRequestKey(input), buildFirebaseLeadResearchRequestKey({ ...input, leadRef: 'lead-2' }));
    assert.notEqual(buildFirebaseLeadResearchRequestKey(input), buildFirebaseLeadResearchRequestKey({ ...input, taskId: 'task-2' }));
    assert.match(buildFirebaseLeadResearchRequestKey(input), /^research:v1:[a-f0-9]{64}$/);
});

test('investigation claims before quota and provider and replays before consuming either', () => {
    const claim = indexSource.indexOf('const claim = await claimLeadResearchRequest');
    const replay = indexSource.indexOf("if (!claim.claimed && ['pre_provider', 'provider_submitting'].includes");
    const quota = indexSource.indexOf('reservation = await consumeLeadResearchRequestQuota');
    const submitting = indexSource.indexOf('await markLeadResearchRequestSubmitting');
    const provider = indexSource.indexOf('response = await fetch(providerUrl');
    assert.ok(claim >= 0 && replay > claim && quota > replay && submitting > quota && provider > submitting);
});

test('firebase investigation shares one request key and does not retain broad n8n fallback', () => {
    assert.match(indexSource, /const requestPayload = USE_N8N_RESEARCH_ONLY \? n8nPayload : leadResearchPayload/);
    assert.match(indexSource, /'Idempotency-Key': researchRequestIdempotencyKey/);
    assert.doesNotMatch(indexSource, /Falling back to N8N/);
    assert.doesNotMatch(indexSource, /n8n_research_forced/);
});

test('ambiguous submission is marked unknown and terminal persistence uses the rpc lifecycle', () => {
    assert.match(indexSource, /catch \(error: any\) \{[\s\S]+markLeadResearchRequestUnknown[\s\S]+no resend/);
    const storeTerminal = helperSource.indexOf('store_lead_research_request_terminal_v1');
    const persistSnapshot = helperSource.indexOf("from('research_snapshots')", storeTerminal);
    const finalizeTerminal = helperSource.indexOf('finalize_lead_research_request_terminal_v1', persistSnapshot);
    assert.ok(storeTerminal >= 0 && persistSnapshot > storeTerminal && finalizeTerminal > persistSnapshot);
    assert.match(migrationSource, /research_snapshot_id is not null or request_claim_state = 'terminal_pending'/);
    assert.match(indexSource, /daily_research_quota_exceeded[\s\S]+deferredLeadsForQuota/);
});
