export const LEGACY_RUNTIME_RETIRED = 'LEGACY_RUNTIME_RETIRED';

const retiredRuntimes = {
  'n8n-research': 'The legacy n8n research endpoint has been retired. Use the native research workflow.',
  'serpapi-account': 'The legacy SerpAPI account endpoint has been retired. Organization credits remain available from persisted data.',
} as const;

export type RetiredLegacyRuntime = keyof typeof retiredRuntimes;

export function retiredLegacyRuntimeResponse(runtime: RetiredLegacyRuntime): Response {
  return Response.json({
    error: LEGACY_RUNTIME_RETIRED,
    runtime,
    message: retiredRuntimes[runtime],
  }, {
    status: 410,
    headers: {
      'Cache-Control': 'no-store',
      'Deprecation': 'true',
      'X-Legacy-Runtime': runtime,
    },
  });
}
