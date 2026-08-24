import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const functionsSource = readFileSync('functions/index.ts', 'utf8');

function sourceBlock(startMarker: string, endMarker: string) {
  const start = functionsSource.indexOf(startMarker);
  const end = functionsSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Could not find source block for ${startMarker}`);
  return functionsSource.slice(start, end);
}

test('Firebase report generation persists a reviewable report without an outbound dispatch', () => {
  const reportGeneration = sourceBlock('// --- 7. EXECUTE REPORT GENERATION ---', 'async function executeLegacyContact');

  assert.match(reportGeneration, /sent_to: \[\]/);
  assert.match(reportGeneration, /status: 'review_required'/);
  assert.doesNotMatch(reportGeneration, /\/api\/contact\/send|notification_email|sent_to: targetEmails/);
});
