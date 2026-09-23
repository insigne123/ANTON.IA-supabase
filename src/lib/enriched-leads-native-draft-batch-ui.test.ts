import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/app/(app)/saved/leads/enriched/Client.tsx', 'utf8');
const opportunities = readFileSync('src/app/(app)/saved/opportunities/enriched/page.tsx', 'utf8');
const sequence = readFileSync('src/app/(app)/contact/sequence/page.tsx', 'utf8');

test('enriched leads opens the research workspace rather than starting its own drafting flow', () => {
  assert.match(source, /openResearchWorkspace\(\[e\.id\]\)/);
  assert.match(source, /Preparar en Investigación/);
  assert.match(source, /openResearchWorkspace\(selectedToContact\)/);
  assert.doesNotMatch(source, /fetch\('\/api\/native-drafts'/);
  assert.doesNotMatch(source, /createNativeDraftBatch\(/);
  assert.match(opportunities, /researched \? 'Preparar en Investigación' : 'Investigar'/);
  assert.doesNotMatch(opportunities, /fetch\('\/api\/native-drafts'/);
});

test('the research sequence edits each existing email with optimistic version checks', () => {
  assert.match(sequence, /key=\{slot\.draftId\}/);
  assert.match(sequence, /method: 'PATCH'/);
  assert.match(sequence, /expectedVersionId: saved\.versionId/);
  assert.match(sequence, /response\.status === 409/);
  assert.match(sequence, /Guardar cambios/);
});
