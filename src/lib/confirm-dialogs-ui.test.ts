import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Plan 9: the browser's confirm() blocks the page, cannot be styled and says «Aceptar/Cancelar». These screens ask with
// the app's dialog (useConfirm), which names the action and marks the destructive ones.
const FILES = [
  'src/components/comments-section.tsx',
  'src/components/campaigns/CampaignSequenceEditor.tsx',
  'src/components/campaigns/BulkCampaignWorkspace.tsx',
  'src/app/(app)/contact/compose/page.tsx',
  'src/components/campaigns-v2/FirstContactFollowUpPlan.tsx',
];

test('comments, campaigns and the composer ask with the app dialog, never the browser confirm()', () => {
  for (const file of FILES) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /window\.confirm\(|(^|[^.\w])confirm\('/m, `${file} uses no browser confirm()`);
    assert.match(source, /const confirm = useConfirm\(\);/, `${file} asks through useConfirm`);
    assert.match(source, /tone: 'danger'/, `${file} marks the destructive choice`);
  }
});

test('«Firmas y estilo» asks with the app dialog to archive or publish a template', () => {
  const source = readFileSync('src/components/email-studio/EmailStyleDesigner.tsx', 'utf8');
  assert.match(source, /const confirm = useConfirm\(\);/);
  assert.match(source, /title: '¿Archivar esta plantilla\?'[^}]*tone: 'danger'/);
  assert.match(source, /title: '¿Publicar para tu equipo\?'/);
  assert.doesNotMatch(source, /window\.confirm\('¿(Archivar|Confirmas)/, 'archive and publish leave the browser confirm()');
});
