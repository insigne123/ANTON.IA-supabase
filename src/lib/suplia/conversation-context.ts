import type { SupliaMessage } from '@/lib/suplia/types';

export const DEFAULT_SUPLIA_CONTEXT_COMPACT_THRESHOLD_TOKENS = 150_000;
export const DEFAULT_SUPLIA_CONTEXT_RECENT_MESSAGE_COUNT = 12;
export const SUPLIA_CONTEXT_CHARS_PER_TOKEN = 4;

export type SupliaConversationCompaction = {
  version: 1;
  summary: string;
  compactedThroughMessageId?: string | null;
  compactedThroughCreatedAt?: string | null;
  sourceMessageCount?: number | null;
  sourceTokenEstimate?: number | null;
  updatedAt?: string | null;
};

export type SupliaPromptMessage = {
  role: SupliaMessage['role'];
  content: string;
  createdAt?: string | null;
};

export type SupliaPromptConversationContext = {
  mode: 'full' | 'compacted';
  tokenEstimate: number;
  thresholdTokens: number;
  messageCount: number;
  summary?: string | null;
  compactedThroughMessageId?: string | null;
  compactedThroughCreatedAt?: string | null;
  omittedMessageCount?: number;
  messages: SupliaPromptMessage[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function estimateSupliaTokens(text: string) {
  return Math.ceil(String(text || '').length / SUPLIA_CONTEXT_CHARS_PER_TOKEN);
}

export function estimateSupliaMessagesTokens(messages: SupliaMessage[]) {
  return messages.reduce((total, message) => {
    return total + estimateSupliaTokens(`${message.role}\n${message.createdAt || ''}\n${message.content || ''}`);
  }, 0);
}

export function normalizeSupliaConversationCompaction(value: unknown): SupliaConversationCompaction | null {
  const record = asRecord(value);
  const summary = String(record.summary || '').trim();
  if (!summary) return null;

  return {
    version: 1,
    summary,
    compactedThroughMessageId: typeof record.compactedThroughMessageId === 'string' ? record.compactedThroughMessageId : null,
    compactedThroughCreatedAt: typeof record.compactedThroughCreatedAt === 'string' ? record.compactedThroughCreatedAt : null,
    sourceMessageCount: Number.isFinite(Number(record.sourceMessageCount)) ? Number(record.sourceMessageCount) : null,
    sourceTokenEstimate: Number.isFinite(Number(record.sourceTokenEstimate)) ? Number(record.sourceTokenEstimate) : null,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
  };
}

export function getSupliaCompactionFromMetadata(metadata: unknown) {
  return normalizeSupliaConversationCompaction(asRecord(metadata).compaction);
}

export function toSupliaPromptMessages(messages: SupliaMessage[]): SupliaPromptMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content || '',
    createdAt: message.createdAt || null,
  }));
}

function findCompactedIndex(messages: SupliaMessage[], compaction: SupliaConversationCompaction | null) {
  if (!compaction?.compactedThroughMessageId) return -1;
  return messages.findIndex((message) => message.id === compaction.compactedThroughMessageId);
}

export function getSupliaMessagesNeedingCompaction(
  messages: SupliaMessage[],
  compaction: SupliaConversationCompaction | null,
  recentMessageCount = DEFAULT_SUPLIA_CONTEXT_RECENT_MESSAGE_COUNT
) {
  if (messages.length <= 2) return [];

  const recentCount = Math.max(1, Math.min(Math.floor(recentMessageCount || DEFAULT_SUPLIA_CONTEXT_RECENT_MESSAGE_COUNT), messages.length));
  const recentStart = Math.max(0, messages.length - recentCount);
  const compactedIndex = findCompactedIndex(messages, compaction);
  const start = compactedIndex >= 0 ? compactedIndex + 1 : 0;
  const candidates = messages.slice(start, recentStart);

  if (candidates.length > 0) return candidates;

  const fallbackRecentCount = Math.min(4, Math.max(1, messages.length - 1));
  return messages.slice(start, Math.max(start, messages.length - fallbackRecentCount));
}

export function buildSupliaPromptConversationContext(params: {
  messages: SupliaMessage[];
  compaction?: SupliaConversationCompaction | null;
  thresholdTokens?: number;
  recentMessageCount?: number;
}): SupliaPromptConversationContext {
  const thresholdTokens = Math.max(1, Math.floor(params.thresholdTokens || DEFAULT_SUPLIA_CONTEXT_COMPACT_THRESHOLD_TOKENS));
  const recentMessageCount = Math.max(1, Math.floor(params.recentMessageCount || DEFAULT_SUPLIA_CONTEXT_RECENT_MESSAGE_COUNT));
  const messages = params.messages;
  const tokenEstimate = estimateSupliaMessagesTokens(messages);
  const compaction = params.compaction || null;

  if (tokenEstimate <= thresholdTokens && !compaction) {
    return {
      mode: 'full',
      tokenEstimate,
      thresholdTokens,
      messageCount: messages.length,
      messages: toSupliaPromptMessages(messages),
    };
  }

  if (tokenEstimate <= thresholdTokens) {
    return {
      mode: 'full',
      tokenEstimate,
      thresholdTokens,
      messageCount: messages.length,
      messages: toSupliaPromptMessages(messages),
      summary: compaction?.summary || null,
      compactedThroughMessageId: compaction?.compactedThroughMessageId || null,
      compactedThroughCreatedAt: compaction?.compactedThroughCreatedAt || null,
    };
  }

  const compactedIndex = findCompactedIndex(messages, compaction);
  const recentStart = compactedIndex >= 0
    ? compactedIndex + 1
    : Math.max(0, messages.length - recentMessageCount);
  const recentMessages = messages.slice(recentStart);
  const omittedMessageCount = Math.max(0, messages.length - recentMessages.length);

  return {
    mode: 'compacted',
    tokenEstimate,
    thresholdTokens,
    messageCount: messages.length,
    summary: compaction?.summary || null,
    compactedThroughMessageId: compaction?.compactedThroughMessageId || null,
    compactedThroughCreatedAt: compaction?.compactedThroughCreatedAt || null,
    omittedMessageCount,
    messages: toSupliaPromptMessages(recentMessages),
  };
}
