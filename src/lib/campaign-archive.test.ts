import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { campaignArchiveMetrics, campaignArchiveTypeLabel, campaignRunLabel } from './campaign-archive';

test('each archived campaign counts what it reached, crossed with the contact history', () => {
  const campaigns = [
    { id: 'a', sentRecords: { l1: { lastStepIdx: 0, lastSentAt: '2026-08-01' }, l2: { lastStepIdx: 1, lastSentAt: '2026-08-03' }, gone: { lastStepIdx: 0, lastSentAt: '2026-08-01' } } },
    { id: 'b', sentRecords: undefined },
  ];
  const contacted = [
    { leadId: 'l1', openedAt: '2026-08-02', clickedAt: '2026-08-02' },
    { id: 'l2', status: 'replied' as const },
  ];
  assert.deepEqual(campaignArchiveMetrics(campaigns, contacted), {
    a: { sent: 3, opened: 1, replied: 1, clicked: 1 },
    b: { sent: 0, opened: 0, replied: 0, clicked: 0 },
  });
  assert.equal(campaignArchiveTypeLabel('reconnection'), 'Reconexión');
  assert.equal(campaignArchiveTypeLabel('follow_up'), 'Seguimiento');
  assert.equal(campaignRunLabel(null), 'Sin revisiones');
  assert.equal(campaignRunLabel('idle'), 'Sin destinatarios elegibles');
});

test('the archive is read-only: no editor, no send buttons that do nothing, deleting asks first', () => {
  const page = readFileSync('src/app/(app)/campaigns/history/page.tsx', 'utf8');
  for (const gone of ['sendBulk', 'sendFollowUpNow', 'saveCampaign', 'togglePause', 'generate-campaign', 'Revisar y activar', 'Nueva campaña']) {
    assert.ok(!page.includes(gone), `${gone} is gone`);
  }
  assert.match(page, /Archivo de solo lectura/);
  assert.match(page, /useConfirm\(\)/);
  assert.match(page, /tone: 'danger'/);
  assert.match(page, /back=\{\{ href: '\/campaigns', label: 'Campañas' \}\}/);
});
