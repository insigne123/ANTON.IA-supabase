export type ReportModelTier = 'fast' | 'balanced' | 'reasoning';

export function getReportModels(_tier: ReportModelTier): string[] {
  return ['gpt-5.6-luna'];
}

export function reportGenerationOptions(tier: ReportModelTier) {
  return {
    provider: 'openai',
    openAiModels: getReportModels(tier),
    allowDefaultModelFallback: false,
    timeoutMs: 75_000,
    maxOutputTokens: 6_000,
    reasoningEffort: 'low',
    maxAttempts: 1,
  } as const;
}
