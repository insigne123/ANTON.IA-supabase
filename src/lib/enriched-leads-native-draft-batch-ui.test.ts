import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/app/(app)/saved/leads/enriched/Client.tsx', 'utf8');
const opportunities = readFileSync('src/app/(app)/saved/opportunities/enriched/page.tsx', 'utf8');
const sequence = readFileSync('src/app/(app)/contact/sequence/page.tsx', 'utf8');
const report = readFileSync('src/components/research/NativeResearchReport.tsx', 'utf8');

test('enriched leads opens the research workspace rather than starting its own drafting flow', () => {
  assert.match(source, /openResearchWorkspace\(\[e\.id\]\)/);
  assert.match(source, />Contactar<\/Button>/);
  assert.match(source, /openResearchWorkspace\(selectedToContact\)/);
  assert.doesNotMatch(source, /fetch\('\/api\/native-drafts'/);
  assert.doesNotMatch(source, /createNativeDraftBatch\(/);
  assert.match(opportunities, /researched \? 'Contactar' : 'Investigar'/);
  assert.doesNotMatch(opportunities, /fetch\('\/api\/native-drafts'/);
});

test('the report offers follow-up count, style and AI-or-custom guidance before preparing drafts', () => {
  assert.match(report, /Seguimientos/);
  assert.match(report, /Plantilla o estilo/);
  assert.match(report, /Que la IA elija según la investigación/);
  assert.match(report, /Dar mis indicaciones/);
  assert.match(report, /Sin seguimientos/);
  assert.match(report, /Días de envío/);
  assert.match(report, /Día de envío del correo/);
  assert.match(report, /Los días deben aumentar de un correo al siguiente/);
  assert.match(report, /Preparar borradores/);
  assert.doesNotMatch(report, /sticky bottom-0/);
});

test('the research sequence edits each existing email with optimistic version checks', () => {
  assert.match(sequence, /key=\{slot\.draftId\}/);
  assert.match(sequence, /method: 'PATCH'/);
  assert.match(sequence, /expectedVersionId: saved\.versionId/);
  assert.match(sequence, /response\.status === 409/);
  assert.match(sequence, /Guardar cambios/);
});
