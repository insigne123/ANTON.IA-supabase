import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  normalizeResearchUsage,
  persistResearchGenerationAttempt,
  recordReportV2ModelTelemetry,
} from './research-generation-attempts';

test('research attempts are append-only cost telemetry without any send or approval surface', () => {
  const migration = readFileSync('supabase/migrations/20260912140000_research_generation_attempts.sql', 'utf8');
  assert.match(migration, /create table public\.research_generation_attempts/);
  assert.match(migration, /stage in \('synthesis_analysis', 'synthesis_section', 'synthesis_audit', 'sequence_editorial'\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all .* from public, anon, authenticated/);
  assert.match(migration, /grant select on table public\.research_generation_attempts to authenticated/);
  assert.match(migration, /Authenticated members can read research generation attempts/);
  assert.doesNotMatch(migration, /for\s+(insert|update|delete)\s+to\s+authenticated/i);
  assert.doesNotMatch(migration, /grant\s+(insert|update|delete)\s+on table public\.research_generation_attempts/i);
  assert.doesNotMatch(migration, /create\s+(trigger|function)/i);
});

test('usage normalization keeps OpenAI semantics without inventing tokens', () => {
  assert.deepEqual(
    normalizeResearchUsage({ prompt_tokens: 11519, completion_tokens: 1459, completion_tokens_details: { reasoning_tokens: 1226 } }),
    { inputTokens: 11519, outputTokens: 1459, reasoningTokens: 1226 },
  );
  assert.deepEqual(normalizeResearchUsage(null), { inputTokens: null, outputTokens: null, reasoningTokens: null });
  assert.deepEqual(normalizeResearchUsage({ prompt_tokens: -3 }), { inputTokens: null, outputTokens: null, reasoningTokens: null });
});

test('synthesis telemetry maps phases to stages with normalized usage', async () => {
  const recorded: any[] = [];
  await recordReportV2ModelTelemetry({
    organizationId: 'org-1',
    userId: 'user-1',
    researchSnapshotId: 'snap-1',
    promptVersion: 'report-v2/test',
    modelTelemetry: [
      { phase: 'analysis', attempt: 1, model: 'gpt-5.6-terra', usage: { prompt_tokens: 20000, completion_tokens: 3000, completion_tokens_details: { reasoning_tokens: 1500 } } },
      { phase: 'section', attempt: 2, model: 'gpt-5.6-luna', usage: { prompt_tokens: 8000, completion_tokens: 1200 } },
      { phase: 'audit', attempt: 1, model: 'gpt-5.6-luna', usage: null },
    ],
  }, { record: async (input) => { recorded.push(input); } });
  assert.equal(recorded.length, 3);
  assert.deepEqual(recorded.map((row) => row.stage), ['synthesis_analysis', 'synthesis_section', 'synthesis_audit']);
  assert.deepEqual(recorded[0].inputTokens, 20000);
  assert.deepEqual(recorded[0].reasoningTokens, 1500);
  assert.deepEqual(recorded[1].attemptNo, 2);
  assert.deepEqual(recorded[2].inputTokens, null);
  assert.ok(recorded.every((row) => row.researchSnapshotId === 'snap-1' && row.promptVersion === 'report-v2/test' && row.passed === true));
});

test('telemetry persistence never throws, even when the database is unavailable', async () => {
  const failing = { from: () => { throw new Error('db unavailable'); } } as any;
  await persistResearchGenerationAttempt({
    organizationId: 'org-1', userId: 'user-1', researchSnapshotId: 'snap-1', stage: 'sequence_editorial',
  }, failing);
  const rejecting = { from: () => ({ insert: async () => ({ error: new Error('insert failed') }) }) } as any;
  await persistResearchGenerationAttempt({
    organizationId: 'org-1', userId: 'user-1', researchSnapshotId: 'snap-1', stage: 'sequence_editorial',
  }, rejecting);
});

test('telemetry persistence writes one row per attempt with identifiers', async () => {
  const inserted: any[] = [];
  const client = { from: (table: string) => {
    assert.equal(table, 'research_generation_attempts');
    return { insert: async (row: any) => { inserted.push(row); return { error: null }; } };
  } } as any;
  await persistResearchGenerationAttempt({
    organizationId: 'org-1', userId: 'user-1', researchSnapshotId: 'snap-1',
    stage: 'sequence_editorial', model: 'gpt-5.6-luna', promptVersion: 'research-sequence/editorial/1',
    inputTokens: 4100, outputTokens: 120, reasoningTokens: 30, passed: true,
  }, client);
  assert.equal(inserted.length, 1);
  assert.deepEqual(inserted[0], {
    organization_id: 'org-1', user_id: 'user-1', research_snapshot_id: 'snap-1',
    stage: 'sequence_editorial', attempt_no: 1, label: null, model: 'gpt-5.6-luna',
    prompt_version: 'research-sequence/editorial/1', input_tokens: 4100, output_tokens: 120,
    reasoning_tokens: 30, passed: true,
  });
});
