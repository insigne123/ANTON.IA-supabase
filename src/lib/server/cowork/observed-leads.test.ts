import test from 'node:test';
import assert from 'node:assert/strict';
import { observedCoworkLeadIds } from './observed-leads';

test('the people of a recommendation count as seen for a batch, like those of a search (Plan 15)', () => {
  const ids = observedCoworkLeadIds([
    { kind: 'tool.completed', payload: { action: 'leads.recommend', result: { top: [{ leadId: 'lead-1', name: 'Valentina' }, { leadId: 'lead-2' }, { name: 'sin id' }] } } },
    { kind: 'tool.completed', payload: { action: 'lists.review_contact', result: { items: [{ leadId: 'lead-3' }] } } },
    { kind: 'tool.failed', payload: { action: 'leads.recommend', result: { top: [{ leadId: 'lead-9' }] } } },
  ]);
  assert.deepEqual([...ids].sort(), ['lead-1', 'lead-2', 'lead-3']);
});
