export type CoworkExecutionMode = 'approval' | 'autonomous';

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
  };
}

export function assertCoworkModeAvailable(mode: CoworkExecutionMode, enabled: boolean) {
  if (mode === 'autonomous' && !enabled) throw new Error('COWORK_AUTONOMY_UNAVAILABLE');
}
