import assert from 'node:assert/strict';
import test from 'node:test';

import { createResearchWorkspaceHandoff } from '@/lib/research-workspace-handoff';

test('creates a bounded handoff with lead identifiers only', () => {
  const result = createResearchWorkspaceHandoff({
    source: 'enriched-leads',
    leadIds: [' lead-ana ', 'lead-bruno'],
    createdAt: 1_700_000_000_000,
  });

  assert.deepEqual(result, {
    ok: true,
    handoff: {
      version: 1,
      source: 'enriched-leads',
      leadIds: ['lead-ana', 'lead-bruno'],
      refresh: false,
      createdAt: 1_700_000_000_000,
    },
  });
});

test('preserves an explicit refresh request for an existing report', () => {
  const result = createResearchWorkspaceHandoff({
    source: 'enriched-leads',
    leadIds: ['lead-ana'],
    refresh: true,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.handoff.refresh, true);
});

test('rejects oversized or duplicate handoffs instead of dropping selected leads', () => {
  const tooMany = createResearchWorkspaceHandoff({
    source: 'enriched-opportunities',
    leadIds: Array.from({ length: 51 }, (_, index) => `lead-${index}`),
  });
  const duplicate = createResearchWorkspaceHandoff({
    source: 'enriched-opportunities',
    leadIds: ['lead-ana', 'lead-ana'],
  });

  assert.equal(tooMany.ok, false);
  assert.equal(duplicate.ok, false);
});
