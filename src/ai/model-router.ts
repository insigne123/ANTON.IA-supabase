import type { SupliaMessage } from '@/lib/suplia/types';

export type OpenAiModelTier = 'fast' | 'balanced' | 'orchestrator' | 'reasoning' | 'critical';
export type AiModelProvider = 'openai' | 'glm';

const DEFAULT_FAST_MODEL = 'gpt-5.4-nano';
const DEFAULT_BALANCED_MODEL = 'gpt-5.4-mini';
const DEFAULT_ORCHESTRATOR_MODEL = 'gpt-5.4-mini';
const DEFAULT_REASONING_MODEL = 'gpt-5.4';
const DEFAULT_CRITICAL_MODEL = 'gpt-5.5';
const DEFAULT_LEGACY_FALLBACK_MODEL = 'gpt-4o-mini';
const DEFAULT_GLM_MODEL = 'glm-5.2';

function env(name: string) {
  return String(process.env[name] || '').trim();
}

function compactModels(models: Array<string | null | undefined>) {
  return Array.from(new Set(models.map((model) => String(model || '').trim()).filter(Boolean)));
}

export function getAiModelProvider(): AiModelProvider {
  const provider = (env('SUPLIA_AI_PROVIDER') || env('AI_PROVIDER')).toLowerCase();
  if (provider === 'glm' || provider === 'zhipu' || provider === 'bigmodel' || provider === 'zai' || provider === 'z.ai') {
    return 'glm';
  }
  return 'openai';
}

function getGlmModelForTier(tier: OpenAiModelTier) {
  const globalModel = env('SUPLIA_GLM_MODEL') || env('GLM_MODEL') || DEFAULT_GLM_MODEL;

  if (tier === 'fast') {
    return env('SUPLIA_GLM_FAST_MODEL') || env('GLM_FAST_MODEL') || globalModel;
  }

  if (tier === 'balanced') {
    return env('SUPLIA_GLM_BALANCED_MODEL') || env('GLM_BALANCED_MODEL') || globalModel;
  }

  if (tier === 'reasoning') {
    return env('SUPLIA_GLM_REASONING_MODEL') || env('GLM_REASONING_MODEL') || globalModel;
  }

  if (tier === 'critical') {
    return env('SUPLIA_GLM_CRITICAL_MODEL') || env('GLM_CRITICAL_MODEL') || globalModel;
  }

  return env('SUPLIA_GLM_ORCHESTRATOR_MODEL') || env('GLM_ORCHESTRATOR_MODEL') || globalModel;
}

export function getOpenAiModelForTier(tier: OpenAiModelTier) {
  if (getAiModelProvider() === 'glm') {
    return getGlmModelForTier(tier);
  }

  if (tier === 'fast') {
    return env('SUPLIA_OPENAI_FAST_MODEL') || env('OPENAI_FAST_MODEL') || DEFAULT_FAST_MODEL;
  }

  if (tier === 'balanced') {
    return env('SUPLIA_OPENAI_BALANCED_MODEL') || env('OPENAI_BALANCED_MODEL') || DEFAULT_BALANCED_MODEL;
  }

  if (tier === 'reasoning') {
    return env('SUPLIA_OPENAI_REASONING_MODEL') || env('OPENAI_REASONING_MODEL') || DEFAULT_REASONING_MODEL;
  }

  if (tier === 'critical') {
    return env('SUPLIA_OPENAI_CRITICAL_MODEL') || env('OPENAI_CRITICAL_MODEL') || DEFAULT_CRITICAL_MODEL;
  }

  return env('SUPLIA_OPENAI_ORCHESTRATOR_MODEL') || env('OPENAI_ORCHESTRATOR_MODEL') || DEFAULT_ORCHESTRATOR_MODEL;
}

export function getOpenAiModelsForTier(tier: OpenAiModelTier) {
  if (getAiModelProvider() === 'glm') {
    const fallback = env('SUPLIA_GLM_FALLBACK_MODEL') || env('GLM_FALLBACK_MODEL') || env('SUPLIA_GLM_MODEL') || env('GLM_MODEL') || DEFAULT_GLM_MODEL;
    return compactModels([
      getOpenAiModelForTier(tier),
      tier === 'critical' ? getGlmModelForTier('reasoning') : null,
      tier === 'critical' || tier === 'reasoning' ? getGlmModelForTier('orchestrator') : null,
      tier === 'critical' || tier === 'reasoning' || tier === 'orchestrator' ? getGlmModelForTier('balanced') : null,
      fallback,
      DEFAULT_GLM_MODEL,
    ]);
  }

  const fallback = env('SUPLIA_OPENAI_FALLBACK_MODEL') || env('OPENAI_FALLBACK_MODEL') || DEFAULT_BALANCED_MODEL;
  const legacyFallback = env('SUPLIA_OPENAI_LEGACY_FALLBACK_MODEL') || env('OPENAI_LEGACY_FALLBACK_MODEL') || DEFAULT_LEGACY_FALLBACK_MODEL;
  const globalDefault = env('OPENAI_MODEL') || DEFAULT_BALANCED_MODEL;

  return compactModels([
    getOpenAiModelForTier(tier),
    tier === 'critical' ? getOpenAiModelForTier('reasoning') : null,
    tier === 'critical' || tier === 'reasoning' ? getOpenAiModelForTier('orchestrator') : null,
    tier === 'critical' || tier === 'reasoning' || tier === 'orchestrator' ? getOpenAiModelForTier('balanced') : null,
    fallback,
    globalDefault,
    legacyFallback,
  ]);
}

export function selectSupliaModelTier(params: { message: string; messages: SupliaMessage[] }): OpenAiModelTier {
  const message = params.message.toLowerCase();
  const recentText = params.messages.slice(-6).map((item) => item.content).join(' ').toLowerCase();
  const text = `${message} ${recentText}`;

  const highRiskAction = /\b(envia\s+(?:una\s+)?campana|envia\s+(?:a\s+)?todos|enviar\s+(?:a\s+)?todos|contacta\s+(?:a\s+)?todos|mass\s?send|bulk|masivo|masiva|full\s?auto|automaticamente|automáticamente|sin\s+aprobar|compliance|privacidad|legal|baja|unsubscribe|dominio\s+bloqueado|bloqueado)\b/i.test(text);
  const needsTools = /\b(envia|enviar|manda|mandar|contacta|contactar|apollo|pdl|crm|lead|leads|campana|campaña|prospect|prospectar|seguimiento|follow\s?up|pipeline|mision|misión|automatiza|automatizar|busca|buscar|investiga|investigar)\b/i.test(text);
  const needsReasoning = /\b(estrategia|plan|prioriza|priorizar|recomienda|recomendar|orquesta|orquestar|decide|decidir|analiza|analizar|segmenta|segmentar|score|scoring|icp|riesgo|compliance)\b/i.test(text);
  const longContext = params.message.length > 700 || params.messages.length > 8;

  if (highRiskAction) return 'critical';
  if (needsReasoning || longContext) return 'reasoning';
  if (needsTools) return 'orchestrator';
  if (params.message.length > 220) return 'balanced';
  return 'fast';
}
