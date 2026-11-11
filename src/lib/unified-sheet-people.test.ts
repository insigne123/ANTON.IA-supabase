import assert from 'node:assert/strict';
import test from 'node:test';

import { onePerPerson } from '@/lib/unified-sheet-people';
import type { UnifiedRow } from '@/lib/unified-sheet-types';

const row = (gid: string, kind: UnifiedRow['kind'], email: string | null, extra: Partial<UnifiedRow> = {}): UnifiedRow =>
  ({ gid, sourceId: gid.split('|')[1], kind, email, name: 'Andrea Soto', company: 'Retail Andino', hasEmail: Boolean(email), status: kind === 'contacted' ? 'sent' : 'saved', ...extra } as UnifiedRow);

test('a person already in conversation is one row, the conversation, not also a contact to write to (review of 10 Nov 2026, V6)', () => {
  const rows = onePerPerson([
    row('lead_enriched|e-1', 'lead_enriched', 'Andrea.Soto@retail.cl', { stage: 'Calificado', notes: 'Prefiere los martes' }),
    row('lead_saved|s-9', 'lead_saved', null),
    row('lead_saved|s-1', 'lead_saved', 'andrea.soto@retail.cl'),
    row('contacted|c-1', 'contacted', 'andrea.soto@retail.cl', { notes: '' }),
    row('lead_enriched|e-2', 'lead_enriched', 'pablo@logistica.cl'),
  ]);
  assert.deepEqual(rows.map(item => item.gid), ['lead_saved|s-9', 'contacted|c-1', 'lead_enriched|e-2'], 'one row per address, the furthest along; no address, no merge');
  const andrea = rows.find(item => item.gid === 'contacted|c-1')!;
  assert.equal(andrea.kind, 'contacted', 'its one action is «Ver conversación»');
  assert.equal(andrea.stage, 'Calificado', 'the stage noted on the contact is not lost');
  assert.equal(andrea.notes, 'Prefiere los martes', 'nor the note');
});

test('a saved contact whose email was found is the contact with email; what the conversation says wins over what it replaces', () => {
  const rows = onePerPerson([
    row('lead_saved|s-1', 'lead_saved', 'ana@ripley.cl', { owner: 'Diego' }),
    row('lead_enriched|e-1', 'lead_enriched', 'ana@ripley.cl', { owner: 'Camila' }),
  ]);
  assert.deepEqual(rows.map(item => item.gid), ['lead_enriched|e-1']);
  assert.equal(rows[0].owner, 'Camila');
  const untouched = [row('contacted|c-1', 'contacted', 'a@x.cl'), row('contacted|c-2', 'contacted', 'b@x.cl'), row('contacted|c-3', 'contacted', 'a@x.cl')];
  assert.deepEqual(onePerPerson(untouched), untouched, 'different people, and two conversations with the same one, stay as they are');
});
