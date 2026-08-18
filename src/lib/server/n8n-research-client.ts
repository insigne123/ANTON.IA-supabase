export type N8nResearchFetch = typeof fetch;

export type N8nResearchRequest = {
  webhook: string;
  headers: Record<string, string>;
  payload: Record<string, any>;
  useSocialContext: boolean;
  timeoutMs: number;
};

export type N8nResearchResult = {
  response: Response;
  usedSocialContext: boolean;
  fellBackToNonSocial: boolean;
};

export class N8nResearchRequestError extends Error {
  readonly kind: 'timeout' | 'network';

  constructor(kind: 'timeout' | 'network', cause?: unknown) {
    super(kind === 'timeout' ? 'timeout' : String((cause as any)?.message || 'fetch_failed'));
    this.name = 'N8nResearchRequestError';
    this.kind = kind;
    if (cause !== undefined) (this as any).cause = cause;
  }
}

function canFallBackFromSocialHttpFailure(status: number) {
  return status === 429 || (status >= 500 && status <= 599 && status !== 504);
}

async function fetchN8nOnce(
  request: N8nResearchRequest,
  useSocialContext: boolean,
  fetchImpl: N8nResearchFetch,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

  try {
    return await fetchImpl(request.webhook, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({
        ...request.payload,
        use_social_context: useSocialContext,
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new N8nResearchRequestError('timeout', error);
    throw new N8nResearchRequestError('network', error);
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestN8nResearch(
  request: N8nResearchRequest,
  dependencies: { fetch?: N8nResearchFetch } = {},
): Promise<N8nResearchResult> {
  const fetchImpl = dependencies.fetch || fetch;
  const firstResponse = await fetchN8nOnce(request, request.useSocialContext, fetchImpl);

  if (!request.useSocialContext || !canFallBackFromSocialHttpFailure(firstResponse.status)) {
    return {
      response: firstResponse,
      usedSocialContext: request.useSocialContext,
      fellBackToNonSocial: false,
    };
  }

  const fallbackResponse = await fetchN8nOnce(request, false, fetchImpl);
  return {
    response: fallbackResponse,
    usedSocialContext: false,
    fellBackToNonSocial: true,
  };
}
