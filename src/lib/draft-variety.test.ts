import assert from 'node:assert/strict';
import test from 'node:test';
import { DRAFT_CLOSING_FORMS, DRAFT_INTRODUCTION_FORMS, draftVarietyIndex, draftVarietySeed } from './draft-variety';

test('each recipient keeps its own form, and a campaign spreads over all of them', () => {
  const seed = draftVarietySeed({ recipient: { email: 'ana@acme.example', displayName: 'Ana Pérez' }, company: { name: 'Acme' } });
  assert.equal(draftVarietyIndex(seed, 4), draftVarietyIndex(seed, 4));
  const picked = new Set(Array.from({ length: 40 }, (_, index) => draftVarietyIndex(draftVarietySeed({ recipient: { email: `persona${index}@acme.example` }, company: { name: 'Acme' } }), DRAFT_CLOSING_FORMS.length)));
  assert.equal(picked.size, DRAFT_CLOSING_FORMS.length);
  assert.ok(DRAFT_INTRODUCTION_FORMS.length >= 3);
  assert.equal(draftVarietyIndex('x', 0), 0);
});
