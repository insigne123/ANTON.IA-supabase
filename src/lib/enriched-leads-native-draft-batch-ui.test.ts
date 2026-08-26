import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/app/(app)/saved/leads/enriched/Client.tsx', 'utf8');

test('enriched leads exposes native multi-draft selection on desktop and mobile', () => {
  assert.match(source, /Seleccionar todos para crear borradores/);
  assert.match(source, /Seleccionar \$\{e\.fullName \|\| 'lead'\} para crear un borrador/);
  assert.match(source, />Borrador<\/span>/);
  assert.match(source, /Crear borradores \(\$\{contactCount\}\)/);
  assert.match(source, /createNativeDraftBatch\(\{/);
});

test('bulk native drafting keeps review and approval before sending', () => {
  assert.match(source, /Nada se envía automáticamente/);
  assert.match(source, /Revisar y contactar/);
  assert.match(source, /Cada borrador requiere revisión y aprobación antes del envío/);
  assert.doesNotMatch(source, /function sendBulk\(/);
});
