export type CoworkExecutionMode = 'approval' | 'autonomous';

/** New capabilities require an explicit policy decision, never implicit opt-in. */
const AUTOMATIC_EFFECTS = new Set(['save_contact', 'start_research', 'request_draft', 'enrich_contact', 'campaign_create']);

export function coworkEffectCanAutoApprove(mode: CoworkExecutionMode, enabled: boolean, kind: string) {
  return mode === 'autonomous' && enabled && AUTOMATIC_EFFECTS.has(kind);
}

/** Versioned policy for capabilities that actually exist, enforced outside the model. */
export function coworkExecutionPolicy(mode: CoworkExecutionMode, autonomousEnabled: boolean) {
  const autonomous = mode === 'autonomous' && autonomousEnabled;
  return {
    version: 'cowork-execution/v1' as const,
    effectiveMode: autonomous ? 'autonomous' as const : 'approval' as const,
    automaticExternalSearch: autonomous,
    maxExternalSearchesPerRun: 1,
    maxExternalResults: 25,
    noteRequiresApproval: true,
    automaticEffects: autonomous ? [...AUTOMATIC_EFFECTS] : [],
  };
}

export function assertCoworkModeAvailable(mode: CoworkExecutionMode, enabled: boolean) {
  if (mode === 'autonomous' && !enabled) throw new Error('COWORK_AUTONOMY_UNAVAILABLE');
}
