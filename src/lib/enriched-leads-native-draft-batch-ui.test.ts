import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/app/(app)/saved/leads/enriched/Client.tsx', 'utf8');
const sequence = readFileSync('src/app/(app)/contact/sequence/page.tsx', 'utf8');
const report = readFileSync('src/components/research/NativeResearchReport.tsx', 'utf8');

test('the prepared sequence lets the user change follow-up days without rewriting emails', () => {
  assert.match(sequence, /sequence-day-/);
  assert.match(sequence, /Día de envío del correo/);
  assert.match(sequence, /offsets: days/);
  assert.match(sequence, /los correos ya escritos se conservan/);
  assert.match(sequence, /Los días deben aumentar de un correo al siguiente/);
  assert.match(sequence, /Guardando días/);
  assert.doesNotMatch(sequence, /Guardar días/);
});

test('enriched leads opens the research workspace rather than starting its own drafting flow', () => {
  assert.match(source, /openResearchWorkspace\(\[lead\.id\]\)/);
  assert.match(source, />Escribir<\/Button>/, 'the row action that writes is «Escribir»');
  assert.match(source, /openResearchWorkspace\(selectedLeads\.filter/, 'the action bar opens the workspace with the selection');
  assert.doesNotMatch(source, /fetch\('\/api\/native-drafts'/);
  assert.doesNotMatch(source, /createNativeDraftBatch\(/);
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
