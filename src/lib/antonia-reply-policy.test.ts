import test from 'node:test';
import assert from 'node:assert/strict';

import { decideAutonomousReplyAction } from '@/lib/antonia-reply-policy';

const baseConfig = {
  replyAutopilotEnabled: true,
  replyAutopilotMode: 'auto_safe' as const,
  replyApprovalMode: 'high_risk_only' as const,
  replyMaxAutoTurns: 2,
  autoSendBookingReplies: true,
  bookingLink: 'https://calendly.com/demo/reunion',
  allowReplyAttachments: false,
};

test('auto-sends safe meeting requests', () => {
  const decision = decideAutonomousReplyAction({
    config: baseConfig,
    classification: { intent: 'meeting_request', confidence: 0.98 },
    rawReply: 'Perfecto, me interesa agendar una reunion esta semana.',
    turnCount: 0,
  });

  assert.equal(decision.action, 'send');
  assert.equal(decision.recommendedAction, 'send');
});

test('routes pricing questions to review', () => {
  const decision = decideAutonomousReplyAction({
    config: baseConfig,
    classification: { intent: 'positive', confidence: 0.89 },
    rawReply: 'Antes de seguir, me puedes compartir pricing y estructura de costos?',
    turnCount: 0,
  });

  assert.equal(decision.action, 'review');
  assert.equal(decision.riskFlags.asksPricing, true);
});

test('stops on unsubscribe replies', () => {
  const decision = decideAutonomousReplyAction({
    config: baseConfig,
    classification: { intent: 'unsubscribe', confidence: 0.99 },
    rawReply: 'Por favor no me contacten mas.',
    turnCount: 0,
  });

  assert.equal(decision.action, 'stop');
  assert.equal(decision.shouldGenerateDraft, false);
});

test('shadow mode never auto-sends even if recommended', () => {
  const decision = decideAutonomousReplyAction({
    config: {
      ...baseConfig,
      replyAutopilotMode: 'shadow_mode',
    },
    classification: { intent: 'meeting_request', confidence: 0.97 },
    rawReply: 'Conversemos, tienes link para agendar?',
    turnCount: 0,
  });

  assert.equal(decision.recommendedAction, 'send');
  assert.equal(decision.action, 'draft');
});

test('meeting request stays in draft when auto booking replies are disabled', () => {
  const decision = decideAutonomousReplyAction({
    config: {
      ...baseConfig,
      autoSendBookingReplies: false,
    },
    classification: { intent: 'meeting_request', confidence: 0.97 },
    rawReply: 'Me interesa, puedes compartir un link para coordinar?',
    turnCount: 0,
  });

  assert.equal(decision.action, 'draft');
  assert.equal(decision.recommendedAction, 'draft');
});
