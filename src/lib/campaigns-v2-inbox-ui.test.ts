import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { campaignInboxItemAction } from './campaigns-v2-inbox-ui';

const inboxComponent = readFileSync('src/components/campaigns-v2/CampaignReviewInbox.tsx', 'utf8');

test('Campaign V2 inbox only opens compose for explicit review and send states', () => {
  assert.deepEqual(campaignInboxItemAction('ready_to_prepare'), { kind: 'prepare', label: 'Preparar borrador' });
  assert.deepEqual(campaignInboxItemAction('review_required'), { kind: 'open', label: 'Revisar correo' });
  assert.deepEqual(campaignInboxItemAction('approved'), { kind: 'open', label: 'Revisar y enviar' });
  assert.deepEqual(campaignInboxItemAction('pending_initial_send', 'send'), { kind: 'open', label: 'Revisar y enviar' });
  assert.deepEqual(campaignInboxItemAction('dispatch_pending'), { kind: 'open', label: 'Retomar envío' });
  assert.deepEqual(campaignInboxItemAction('deferred'), { kind: 'open', label: 'Retomar envío' });

  for (const state of ['drafting', 'sending', 'failed', 'unknown', 'blocked', 'unexpected']) {
    assert.equal(campaignInboxItemAction(state).kind, 'none', state);
  }
  assert.equal(campaignInboxItemAction('pending_initial_send', 'review').kind, 'none');
  assert.equal(campaignInboxItemAction('not_due', 'resolve').kind, 'none');
});

test('not-due rows close immediately after a successful stop and then refresh in the background', () => {
  assert.match(inboxComponent, /normalizedState\(item\.state\) === 'not_due'/);
  assert.match(inboxComponent, /stopFirstContactFollowUpPlan\(\{/);
  const close = inboxComponent.indexOf('setStopCandidate((current)');
  const refresh = inboxComponent.indexOf('void loadInbox({ background: true })', close);
  assert.ok(close >= 0 && refresh > close);
  assert.doesNotMatch(inboxComponent, /await loadInbox\(\)/);
  assert.match(inboxComponent, /<AlertDialog/);
  assert.match(inboxComponent, /Puedes cerrar este cuadro/);
  assert.match(inboxComponent, /campaignInboxItemAction\(item\.state, item\.nextAction\)/);
});

test('inbox validates complete shared pages and exposes every cursor through Load more', () => {
  assert.match(inboxComponent, /CampaignV2InboxResponseSchema\.safeParse\(payload\)/);
  assert.match(inboxComponent, /type CampaignV2InboxResponse/);
  assert.match(inboxComponent, /type CampaignV2InboxItem/);
  assert.match(inboxComponent, /type CampaignV2InboxPage/);
  assert.match(inboxComponent, /cursor=\$\{encodeURIComponent\(options\.cursor\)\}/);
  assert.match(inboxComponent, /loadInbox\(\{ append: true, cursor: page\.nextCursor \}\)/);
  assert.match(inboxComponent, /Cargar más/);
  assert.match(inboxComponent, /El resumen y los filtros corresponden a los/);
  assert.match(inboxComponent, /Aún puede haber más resultados por cargar/);
  assert.doesNotMatch(inboxComponent, /truncated|Mostramos hasta 100 elementos/);
});

test('inbox keeps filtered and row action states accessible without blocking unrelated rows', () => {
  assert.match(inboxComponent, /aria-pressed=\{filter === 'pending'\}/);
  assert.match(inboxComponent, /bg-background text-foreground shadow-sm ring-1 ring-border/);
  assert.match(inboxComponent, /Mostrando \{filteredItems\.length\}/);
  assert.match(inboxComponent, /role="status" aria-live="polite"/);
  assert.match(inboxComponent, /aria-busy=\{rowBusy\}/);
  assert.match(inboxComponent, /disabled=\{rowBusy\}/);
  assert.doesNotMatch(inboxComponent, /disabled=\{Boolean\(workingStepId \|\| stoppingEnrollmentId\)\}/);
  assert.match(inboxComponent, /para \$\{recipient\}/);
});

test('stop dialog preserves dismissal, destructive contrast, focus defaults, and mobile scrolling', () => {
  assert.match(inboxComponent, /<AlertDialogCancel className="min-h-11">/);
  assert.match(inboxComponent, /bg-red-700 text-white hover:bg-red-800/);
  assert.doesNotMatch(inboxComponent, /focus-visible:ring-destructive/);
  assert.match(inboxComponent, /max-h-\[calc\(100dvh-2rem\)\]/);
  assert.match(inboxComponent, /overflow-y-auto overscroll-contain/);
  assert.match(inboxComponent, /\[overflow-wrap:anywhere\]/);
  assert.match(inboxComponent, /CAMPAIGN_V2_INBOX_CURSOR_INVALID:/);
  assert.match(inboxComponent, /CAMPAIGN_V2_STOP_FAILED:/);
  assert.match(inboxComponent, /onCloseAutoFocus/);
  assert.match(inboxComponent, /requestSequence\.current/);
  assert.match(inboxComponent, /CAMPAIGN_V2_INBOX_CURSOR_INVALID/);
});
