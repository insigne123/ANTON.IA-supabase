import { z } from 'genkit';

import { getOpenAiModelsForTier } from '@/ai/model-router';
import { generateStructuredWithTelemetry } from '@/ai/openai-json';
import type { AuthContext } from '@/lib/server/auth-utils';
import { buildOpenAiTelemetry } from '@/lib/server/suplia-observability';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import {
  DEFAULT_SUPLIA_CONTEXT_COMPACT_THRESHOLD_TOKENS,
  DEFAULT_SUPLIA_CONTEXT_RECENT_MESSAGE_COUNT,
  buildSupliaPromptConversationContext,
  estimateSupliaMessagesTokens,
  estimateSupliaTokens,
  getSupliaCompactionFromMetadata,
  getSupliaMessagesNeedingCompaction,
  type SupliaConversationCompaction,
  type SupliaPromptConversationContext,
} from '@/lib/suplia/conversation-context';
import type { SupliaConversation, SupliaMessage } from '@/lib/suplia/types';

const SUMMARY_CHUNK_TOKEN_LIMIT = 60_000;

const ConversationSummarySchema = z.object({
  summary: z.string(),
  durableFacts: z.array(z.string()).default([]),
  openThreads: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  userPreferences: z.array(z.string()).default([]),
  unresolvedQuestions: z.array(z.string()).default([]),
});

type ConversationCompactionTelemetry = ReturnType<typeof buildOpenAiTelemetry>;

function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function getSupliaContextCompactThresholdTokens() {
  return envNumber('SUPLIA_CONTEXT_COMPACT_THRESHOLD_TOKENS', DEFAULT_SUPLIA_CONTEXT_COMPACT_THRESHOLD_TOKENS);
}

export function getSupliaContextRecentMessageCount() {
  return envNumber('SUPLIA_CONTEXT_RECENT_MESSAGES', DEFAULT_SUPLIA_CONTEXT_RECENT_MESSAGE_COUNT);
}

function formatMessageForSummary(message: SupliaMessage) {
  return [
    `id: ${message.id}`,
    `created_at: ${message.createdAt || ''}`,
    `role: ${message.role}`,
    'content:',
    message.content || '',
  ].join('\n');
}

function chunkMessagesByTokenBudget(messages: SupliaMessage[], tokenBudget: number) {
  const chunks: SupliaMessage[][] = [];
  let current: SupliaMessage[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const messageTokens = Math.max(1, estimateSupliaTokens(formatMessageForSummary(message)));
    if (current.length > 0 && currentTokens + messageTokens > tokenBudget) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(message);
    currentTokens += messageTokens;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

function formatStructuredSummary(output: z.infer<typeof ConversationSummarySchema>) {
  const lines = [output.summary.trim()].filter(Boolean);
  const sections: Array<[string, string[]]> = [
    ['Hechos duraderos', output.durableFacts],
    ['Hilos abiertos', output.openThreads],
    ['Decisiones tomadas', output.decisions],
    ['Preferencias del usuario', output.userPreferences],
    ['Preguntas pendientes', output.unresolvedQuestions],
  ];

  for (const [label, items] of sections) {
    const cleanItems = items.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12);
    if (cleanItems.length) {
      lines.push('', `${label}:`, ...cleanItems.map((item) => `- ${item}`));
    }
  }

  return lines.join('\n').slice(0, 40_000);
}

async function summarizeConversationChunk(params: {
  existingSummary: string | null;
  chunk: SupliaMessage[];
}) {
  const prompt = `
Resume esta conversacion para que SUPL.IA pueda continuarla despues de compactar contexto.

Reglas:
- Conserva hechos importantes, decisiones, preferencias del usuario, artifacts mencionados, tareas abiertas y aprobaciones pendientes.
- No inventes informacion.
- No incluyas chain-of-thought.
- Escribe en espanol claro y compacto.
- Devuelve JSON estricto.

Resumen acumulado anterior:
${params.existingSummary || 'No hay resumen previo.'}

Mensajes a incorporar:
${params.chunk.map(formatMessageForSummary).join('\n\n---\n\n')}
`;

  const generated = await generateStructuredWithTelemetry({
    prompt,
    schema: ConversationSummarySchema,
    temperature: 0.15,
    openAiModels: getOpenAiModelsForTier('balanced'),
  });

  return {
    summary: formatStructuredSummary(generated.data),
    telemetry: buildOpenAiTelemetry({
      modelTier: 'balanced',
      modelName: generated.telemetry.modelName,
      usage: generated.telemetry.usage,
      durationMs: generated.telemetry.durationMs,
    }),
  };
}

export async function ensureSupliaPromptConversationContext(params: {
  auth: AuthContext;
  conversation: SupliaConversation;
  messages: SupliaMessage[];
}): Promise<{
  promptContext: SupliaPromptConversationContext;
  compaction: SupliaConversationCompaction | null;
  telemetry: ConversationCompactionTelemetry[];
}> {
  const thresholdTokens = getSupliaContextCompactThresholdTokens();
  const recentMessageCount = getSupliaContextRecentMessageCount();
  const tokenEstimate = estimateSupliaMessagesTokens(params.messages);
  let compaction = getSupliaCompactionFromMetadata(params.conversation.metadata);
  const telemetry: ConversationCompactionTelemetry[] = [];

  if (tokenEstimate > thresholdTokens) {
    const messagesToCompact = getSupliaMessagesNeedingCompaction(params.messages, compaction, recentMessageCount);
    if (messagesToCompact.length > 0) {
      let summary = compaction?.summary || null;
      const chunks = chunkMessagesByTokenBudget(messagesToCompact, SUMMARY_CHUNK_TOKEN_LIMIT);

      for (const chunk of chunks) {
        const result = await summarizeConversationChunk({ existingSummary: summary, chunk });
        summary = result.summary;
        telemetry.push(result.telemetry);
      }

      const lastCompacted = messagesToCompact[messagesToCompact.length - 1];
      compaction = {
        version: 1,
        summary: summary || 'Resumen de conversacion no disponible.',
        compactedThroughMessageId: lastCompacted.id,
        compactedThroughCreatedAt: lastCompacted.createdAt || null,
        sourceMessageCount: params.messages.length,
        sourceTokenEstimate: tokenEstimate,
        updatedAt: new Date().toISOString(),
      };

      const metadata = asRecord(params.conversation.metadata);
      await getSupabaseAdminClient()
        .from('suplia_conversations')
        .update({ metadata: { ...metadata, compaction } })
        .eq('id', params.conversation.id)
        .eq('organization_id', params.auth.organizationId);
    }
  }

  return {
    compaction,
    telemetry,
    promptContext: buildSupliaPromptConversationContext({
      messages: params.messages,
      compaction,
      thresholdTokens,
      recentMessageCount,
    }),
  };
}
