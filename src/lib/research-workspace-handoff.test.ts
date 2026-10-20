import assert from 'node:assert/strict';
import test from 'node:test';

import { createResearchWorkspaceHandoff, startsOnArrival } from '@/lib/research-workspace-handoff';

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
      start: false,
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

test('«Investigar a este contacto» starts the research on arrival, only for people never researched', () => {
  const asked = createResearchWorkspaceHandoff({ source: 'enriched-leads', leadIds: ['lead-ana'], start: true });
  assert.equal(asked.ok, true);
  if (!asked.ok) return;
  assert.equal(asked.handoff.start, true);
  assert.equal(startsOnArrival(asked.handoff, 1, 1), true);
  assert.equal(startsOnArrival(asked.handoff, 0, 1), false, 'already researched or in flight: it opens to read it');
  assert.equal(startsOnArrival(asked.handoff, 1, 2), false, 'some of them researched: the selection is reviewed first');
  const chosen = createResearchWorkspaceHandoff({ source: 'enriched-leads', leadIds: ['lead-ana'] });
  assert.equal(chosen.ok && startsOnArrival(chosen.handoff, 1, 1), false, 'from the list: the person starts it');
  assert.equal(startsOnArrival(null, 1, 1), false);
});
