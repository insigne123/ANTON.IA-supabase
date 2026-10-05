import assert from 'node:assert/strict';
import test from 'node:test';

import { unifiedFailureText } from './unified-sheet-failures';

test('names each failed read as the person knows it, joined in Spanish', () => {
  assert.equal(unifiedFailureText(['saved']), 'No pudimos leer «Por completar».');
  assert.equal(unifiedFailureText(['saved', 'contacted']), 'No pudimos leer «Por completar» y las conversaciones.');
  assert.equal(unifiedFailureText(['enriched', 'opportunities', 'custom']),
    'No pudimos leer «Por escribir», las oportunidades guardadas y las etapas y notas.');
});

test('says nothing when nothing failed and names a repeated source once', () => {
  assert.equal(unifiedFailureText([]), '');
  assert.equal(unifiedFailureText(['custom', 'custom']), 'No pudimos leer las etapas y notas.');
});
