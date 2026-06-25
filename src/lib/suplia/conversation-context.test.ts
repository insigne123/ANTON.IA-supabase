import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSupliaPromptConversationContext,
  estimateSupliaMessagesTokens,
  getSupliaMessagesNeedingCompaction,
  type SupliaConversationCompaction,
} from './conversation-context';
import type { SupliaMessage } from './types';

function message(index: number, content: string): SupliaMessage {
  return {
    id: `msg-${index}`,
    conversationId: 'conversation-1',
    role: index % 2 === 0 ? 'assistant' : 'user',
    content,
    metadata: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  };
}

test('keeps full conversation while token estimate is below threshold', () => {
  const messages = [message(1, 'hola'), message(2, 'respuesta breve')];
  const context = buildSupliaPromptConversationContext({ messages, thresholdTokens: 1000 });

  assert.equal(context.mode, 'full');
  assert.equal(context.messages.length, 2);
  assert.equal(context.messages[0].content, 'hola');
});

test('uses compaction summary and recent messages above threshold', () => {
  const messages = Array.from({ length: 8 }, (_, index) => message(index + 1, `contenido ${index + 1} ${'x'.repeat(200)}`));
  const compaction: SupliaConversationCompaction = {
    version: 1,
    summary: 'Resumen acumulado de la conversacion anterior.',
    compactedThroughMessageId: 'msg-5',
    compactedThroughCreatedAt: messages[4].createdAt,
  };
  const context = buildSupliaPromptConversationContext({ messages, compaction, thresholdTokens: 10, recentMessageCount: 3 });

  assert.equal(context.mode, 'compacted');
  assert.equal(context.summary, compaction.summary);
  assert.deepEqual(context.messages.map((item) => item.content), messages.slice(5).map((item) => item.content));
  assert.equal(context.omittedMessageCount, 5);
});

test('selects only new older messages for incremental compaction', () => {
  const messages = Array.from({ length: 10 }, (_, index) => message(index + 1, `mensaje ${index + 1}`));
  const compaction: SupliaConversationCompaction = {
    version: 1,
    summary: 'Resumen previo.',
    compactedThroughMessageId: 'msg-4',
    compactedThroughCreatedAt: messages[3].createdAt,
  };

  const toCompact = getSupliaMessagesNeedingCompaction(messages, compaction, 3);

  assert.deepEqual(toCompact.map((item) => item.id), ['msg-5', 'msg-6', 'msg-7']);
});

test('estimates token count from message content', () => {
  const messages = [message(1, 'x'.repeat(400))];
  assert.ok(estimateSupliaMessagesTokens(messages) >= 100);
});
