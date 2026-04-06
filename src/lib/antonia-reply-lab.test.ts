import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_REPLY_SAFETY_SCENARIOS, buildDefaultReplySafetyConfig, runReplySafetyLab } from '@/lib/antonia-reply-lab';

test('reply safety lab built-in suite passes with default safe config', () => {
  const run = runReplySafetyLab({ config: buildDefaultReplySafetyConfig() });

  assert.equal(run.summary.total, DEFAULT_REPLY_SAFETY_SCENARIOS.length);
  assert.equal(run.summary.failed, 0);
  assert.equal(run.summary.passRate, 100);
  assert.equal(run.summary.safeToPromote, true);
});

test('reply safety lab blocks promotion if safe config is degraded', () => {
  const run = runReplySafetyLab({
    config: {
      ...buildDefaultReplySafetyConfig(),
      replyAutopilotMode: 'full_auto',
      replyApprovalMode: 'disabled',
      allowReplyAttachments: true,
      replyMaxAutoTurns: 4,
    },
  });

  assert.ok(run.summary.failed > 0);
  assert.equal(run.summary.safeToPromote, false);
});
