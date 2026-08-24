import { createHash } from 'node:crypto';

const SERPER_BASE_URL = 'https://google.serper.dev';
const DEFAULT_LANGUAGE = 'es';
const DEFAULT_COUNTRY_CODE = 'cl';
const DEFAULT_RESULT_LIMIT = 8;
const MAX_RESULT_LIMIT = 10;
const MAX_QUERY_LENGTH = 500;
const MAX_LOCATION_LENGTH = 120;
const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 250;

export type SerperSearchKind = 'organic' | 'news';

export type SerperLocalization = {
  language: string;
  countryCode: string;
  location: string | null;
};

export type SerperSearchItem = {
  title: string | null;
  link: string | null;
  snippet: string | null;
  source: string | null;
  date: string | null;
  position: number | null;
};

export type SerperSearchInput = {
  organizationId: string;
  kind: SerperSearchKind;
  query: unknown;
  language?: unknown;
  countryCode?: unknown;
  location?: unknown;
  limit?: unknown;
};

export type NormalizedSerperSearchInput = {
  organizationId: string;
  kind: SerperSearchKind;
  query: string;
  localization: SerperLocalization;
  limit: number;
};

export type SerperSearchResult = {
  provider: 'serper';
  kind: SerperSearchKind;
  query: string;
  localization: SerperLocalization;
  limit: number;
  items: SerperSearchItem[];
  answerBox: { title: string | null; answer: string | null; link: string | null } | null;
  relatedQuestions: string[];
  searchInformation: { totalResults: number | null; timeTakenDisplayed: number | null } | null;
};

type SerperSearchDependencies = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

type SerperErrorCode =
  | 'SERPER_API_KEY_NOT_CONFIGURED'
  | 'SERPER_TENANT_REQUIRED'
  | 'SERPER_QUERY_REQUIRED'
  | 'SERPER_QUERY_TOO_LONG'
  | 'SERPER_TIMEOUT'
  | 'SERPER_NETWORK_ERROR'
  | 'SERPER_INVALID_RESPONSE'
  | 'SERPER_REQUEST_FAILED'
  | `SERPER_HTTP_${number}`;

export class SerperSearchError extends Error {
  readonly code: SerperErrorCode;
  readonly retryable: boolean;

  constructor(code: SerperErrorCode, retryable = false) {
    super(code);
    this.name = 'SerperSearchError';
    this.code = code;
    this.retryable = retryable;
  }
}

function text(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function array(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

function configuredTimeoutMs(dependencies: SerperSearchDependencies) {
  if (dependencies.timeoutMs != null) {
    return clampInt(dependencies.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 15_000);
  }
  return clampInt(process.env.SERPER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 15_000);
}

function configuredMaxRetries(dependencies: SerperSearchDependencies) {
  return clampInt(
    dependencies.maxRetries ?? process.env.SERPER_MAX_RETRIES,
    DEFAULT_MAX_RETRIES,
    0,
    2,
  );
}

function configuredRetryDelayMs(dependencies: SerperSearchDependencies) {
  return clampInt(
    dependencies.retryDelayMs ?? process.env.SERPER_RETRY_DELAY_MS,
    DEFAULT_RETRY_DELAY_MS,
    0,
    2_000,
  );
}

function normalizeLanguage(value: unknown) {
  const normalized = text(value).toLowerCase().replace(/_/g, '-');
  return /^[a-z]{2,3}(?:-[a-z]{2})?$/.test(normalized) ? normalized : DEFAULT_LANGUAGE;
}

function normalizeCountryCode(value: unknown) {
  const normalized = text(value).toLowerCase();
  return /^[a-z]{2}$/.test(normalized) ? normalized : DEFAULT_COUNTRY_CODE;
}

function normalizeLocation(value: unknown) {
  const normalized = text(value);
  return normalized ? normalized.slice(0, MAX_LOCATION_LENGTH) : null;
}

function normalizeQuery(value: unknown) {
  const query = text(value);
  if (!query) throw new SerperSearchError('SERPER_QUERY_REQUIRED');
  if (query.length > MAX_QUERY_LENGTH) throw new SerperSearchError('SERPER_QUERY_TOO_LONG');
  return query;
}

export function normalizeSerperSearchInput(input: SerperSearchInput): NormalizedSerperSearchInput {
  const organizationId = text(input.organizationId);
  if (!organizationId) throw new SerperSearchError('SERPER_TENANT_REQUIRED');

  return {
    organizationId,
    kind: input.kind,
    query: normalizeQuery(input.query),
    localization: {
      language: normalizeLanguage(input.language),
      countryCode: normalizeCountryCode(input.countryCode),
      location: normalizeLocation(input.location),
    },
    limit: clampInt(input.limit, DEFAULT_RESULT_LIMIT, 1, MAX_RESULT_LIMIT),
  };
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function buildSerperCacheKey(input: SerperSearchInput | NormalizedSerperSearchInput) {
  const normalized = 'localization' in input ? input : normalizeSerperSearchInput(input);
  const requestIdentity = JSON.stringify({
    kind: normalized.kind,
    query: normalized.query,
    language: normalized.localization.language,
    countryCode: normalized.localization.countryCode,
    location: normalized.localization.location,
    limit: normalized.limit,
  });

  // Hash both scopes so neither tenant nor query data leaks through cache metadata.
  return `serper:v1:${sha256(normalized.organizationId).slice(0, 24)}:${sha256(requestIdentity).slice(0, 32)}`;
}

function getSerperApiKey() {
  return text(process.env.SERPER_API_KEY);
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 504);
}

function retryDelayFor(response: Response, fallbackMs: number) {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (!Number.isFinite(retryAfter) || retryAfter < 0) return fallbackMs;
  return Math.max(0, Math.min(Math.round(retryAfter * 1_000), 2_000));
}

function toNullableNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeItem(value: unknown): SerperSearchItem | null {
  const item = object(value);
  const title = text(item.title) || null;
  const link = text(item.link || item.url) || null;
  const snippet = text(item.snippet || item.description) || null;
  if (!link || (!title && !snippet)) return null;

  return {
    title,
    link,
    snippet,
    source: text(item.source?.name || item.source || item.displayed_link) || null,
    date: text(item.date) || null,
    position: toNullableNumber(item.position),
  };
}

function normalizePayload(payload: unknown, input: NormalizedSerperSearchInput): SerperSearchResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SerperSearchError('SERPER_INVALID_RESPONSE');
  }
  const source = payload as Record<string, any>;

  const rows = input.kind === 'news' ? array(source.news) : array(source.organic);
  const answerBox = object(source.answerBox || source.answer_box);
  const relatedQuestions = array(source.peopleAlsoAsk || source.relatedQuestions || source.related_questions)
    .map((item) => text(object(item).question || item))
    .filter(Boolean)
    .slice(0, 5);
  const searchInformation = object(source.searchInformation || source.search_information);
  const hasSearchInformation = Object.keys(searchInformation).length > 0;

  return {
    provider: 'serper',
    kind: input.kind,
    query: input.query,
    localization: input.localization,
    limit: input.limit,
    items: rows.map(normalizeItem).filter((item): item is SerperSearchItem => item != null).slice(0, input.limit),
    answerBox: Object.keys(answerBox).length > 0 ? {
      title: text(answerBox.title) || null,
      answer: text(answerBox.answer || answerBox.snippet) || null,
      link: text(answerBox.link) || null,
    } : null,
    relatedQuestions,
    searchInformation: hasSearchInformation ? {
      totalResults: toNullableNumber(searchInformation.totalResults || searchInformation.total_results),
      timeTakenDisplayed: toNullableNumber(searchInformation.timeTakenDisplayed || searchInformation.time_taken_displayed),
    } : null,
  };
}

async function fetchOnce(
  input: NormalizedSerperSearchInput,
  apiKey: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const body: Record<string, unknown> = {
    q: input.query,
    gl: input.localization.countryCode,
    hl: input.localization.language,
    num: input.limit,
  };
  if (input.localization.location) body.location = input.localization.location;

  try {
    return await fetchImpl(`${SERPER_BASE_URL}/${input.kind === 'news' ? 'news' : 'search'}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error: any) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new SerperSearchError('SERPER_TIMEOUT');
    }
    throw new SerperSearchError('SERPER_NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
  }
}

function redactSerperError(error: unknown) {
  if (error instanceof SerperSearchError) return error;
  return new SerperSearchError('SERPER_REQUEST_FAILED');
}

export async function searchSerper(
  request: SerperSearchInput,
  dependencies: SerperSearchDependencies = {},
): Promise<SerperSearchResult> {
  try {
    const input = normalizeSerperSearchInput(request);
    const apiKey = getSerperApiKey();
    if (!apiKey) throw new SerperSearchError('SERPER_API_KEY_NOT_CONFIGURED');

    const fetchImpl = dependencies.fetch || fetch;
    const timeoutMs = configuredTimeoutMs(dependencies);
    const maxRetries = configuredMaxRetries(dependencies);
    const retryDelayMs = configuredRetryDelayMs(dependencies);
    const sleep = dependencies.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const response = await fetchOnce(input, apiKey, timeoutMs, fetchImpl);
      if (response.ok) {
        const payload = await response.json().catch(() => {
          throw new SerperSearchError('SERPER_INVALID_RESPONSE');
        });
        return normalizePayload(payload, input);
      }

      const retryable = isRetryableStatus(response.status);
      if (retryable && attempt < maxRetries) {
        await sleep(retryDelayFor(response, retryDelayMs));
        continue;
      }
      throw new SerperSearchError(`SERPER_HTTP_${response.status}`, retryable);
    }

    throw new SerperSearchError('SERPER_REQUEST_FAILED');
  } catch (error) {
    throw redactSerperError(error);
  }
}

export const serperSearchTestInternals = {
  normalizePayload,
  normalizeSerperSearchInput,
  buildSerperCacheKey,
};
