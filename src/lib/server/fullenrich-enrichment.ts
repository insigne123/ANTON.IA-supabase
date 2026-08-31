const FULLENRICH_BULK_ENRICHMENT_URL = 'https://app.fullenrich.com/api/v2/contact/enrich/bulk';
const MAX_CONTACTS_PER_BATCH = 100;
const MAX_RESULT_BYTES = 10_000_000;

export const FULLENRICH_CONTACT_FIELDS = [
  'contact.work_emails',
  'contact.phones',
] as const;

export type FullEnrichContactField = typeof FULLENRICH_CONTACT_FIELDS[number];

export type FullEnrichBulkContact = {
  linkedinUrl?: string;
  firstName?: string;
  lastName?: string;
  companyDomain?: string;
  companyName?: string;
  enrichFields?: readonly FullEnrichContactField[];
  custom: Record<string, string>;
};

export class FullEnrichEnrichmentError extends Error {
  constructor(
    readonly status: 429 | 502 | 503 | 504,
    readonly code: 'FULLENRICH_API_KEY_NOT_CONFIGURED' | 'FULLENRICH_ENRICHMENT_RATE_LIMITED' | 'FULLENRICH_ENRICHMENT_UPSTREAM_ERROR' | 'FULLENRICH_ENRICHMENT_TIMEOUT' | 'FULLENRICH_ENRICHMENT_INVALID_RESPONSE',
    readonly providerOutcomeUnknown: boolean,
  ) {
    super(code);
  }
}

export type FullEnrichBulkEnrichmentResult =
  | { kind: 'ready'; rawBody: Buffer }
  | { kind: 'in_progress' }
  | { kind: 'not_found' }
  | { kind: 'terminal_failure'; providerStatus: 'CREDITS_INSUFFICIENT' }
  | { kind: 'retryable_error'; errorCode: string };

function text(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function validLinkedinUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && /(^|\.)linkedin\.com$/i.test(parsed.hostname)
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function validDomain(value: string | undefined) {
  const candidate = text(value, 253)?.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!candidate || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(candidate)) {
    return undefined;
  }
  return candidate.startsWith('www.') ? candidate.slice(4) : candidate;
}

export function validateFullEnrichBulkContact(contact: FullEnrichBulkContact) {
  const linkedinUrl = validLinkedinUrl(contact.linkedinUrl);
  const firstName = text(contact.firstName, 100);
  const lastName = text(contact.lastName, 100);
  const companyDomain = validDomain(contact.companyDomain);
  const companyName = text(contact.companyName, 200);
  const enrichFields = contact.enrichFields?.length
    ? [...new Set(contact.enrichFields)]
    : [...FULLENRICH_CONTACT_FIELDS];

  if (enrichFields.length === 0 || !enrichFields.every((field) => FULLENRICH_CONTACT_FIELDS.includes(field))) {
    return null;
  }
  if (!linkedinUrl && !(firstName && lastName && (companyDomain || companyName))) {
    return null;
  }

  return {
    ...(linkedinUrl ? { linkedin_url: linkedinUrl } : {}),
    ...(!linkedinUrl && firstName ? { first_name: firstName } : {}),
    ...(!linkedinUrl && lastName ? { last_name: lastName } : {}),
    ...(!linkedinUrl && companyDomain ? { domain: companyDomain } : {}),
    ...(!linkedinUrl && companyName ? { company_name: companyName } : {}),
    enrich_fields: enrichFields,
    custom: contact.custom,
  };
}

export function resolveFullEnrichWebhookUrl(environment: Record<string, string | undefined> = process.env) {
  const base = String(
    environment.FULLENRICH_WEBHOOK_BASE_URL
    || environment.CANONICAL_APP_URL
    || environment.NEXT_PUBLIC_APP_URL
    || environment.NEXT_PUBLIC_BASE_URL
    || '',
  ).trim();
  if (!base) return null;

  try {
    const url = new URL('/api/webhooks/fullenrich', base);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !host || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function timeoutMs(environment: Record<string, string | undefined> = process.env) {
  const configured = Number(environment.FULLENRICH_ENRICHMENT_TIMEOUT_MS);
  return Number.isFinite(configured)
    ? Math.max(1_000, Math.min(60_000, Math.floor(configured)))
    : 20_000;
}

function enrichmentId(value: unknown) {
  const candidate = text(value, 200);
  return candidate && /^[A-Za-z0-9_.:-]+$/.test(candidate) ? candidate : null;
}

async function providerErrorCode(response: Response) {
  try {
    const payload = await response.json();
    return text(payload?.code, 100)?.toLowerCase() || '';
  } catch {
    return '';
  }
}

async function providerStatus(response: Response) {
  try {
    const payload = await response.json();
    return text(payload?.status, 64)?.toUpperCase() || '';
  } catch {
    return '';
  }
}

export async function submitFullEnrichBulkEnrichment(input: {
  apiKey: string;
  webhookUrl: string;
  contacts: readonly FullEnrichBulkContact[];
  environment?: Record<string, string | undefined>;
}): Promise<{ enrichmentId: string }> {
  const apiKey = String(input.apiKey || '').trim();
  if (!apiKey) {
    throw new FullEnrichEnrichmentError(503, 'FULLENRICH_API_KEY_NOT_CONFIGURED', false);
  }
  if (input.contacts.length === 0 || input.contacts.length > MAX_CONTACTS_PER_BATCH) {
    throw new FullEnrichEnrichmentError(502, 'FULLENRICH_ENRICHMENT_UPSTREAM_ERROR', false);
  }

  const contacts = input.contacts.map(validateFullEnrichBulkContact);
  if (contacts.some((contact) => contact === null)) {
    throw new FullEnrichEnrichmentError(502, 'FULLENRICH_ENRICHMENT_UPSTREAM_ERROR', false);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs(input.environment));
  try {
    const response = await fetch(FULLENRICH_BULK_ENRICHMENT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({
        name: `ANTON.IA enrichment ${new Date().toISOString()}`,
        webhook_url: input.webhookUrl,
        webhook_events: { contact_finished: input.webhookUrl },
        data: contacts,
      }),
      signal: controller.signal,
    });

    if (response.status === 429) {
      throw new FullEnrichEnrichmentError(429, 'FULLENRICH_ENRICHMENT_RATE_LIMITED', false);
    }
    if (!response.ok) {
      throw new FullEnrichEnrichmentError(502, 'FULLENRICH_ENRICHMENT_UPSTREAM_ERROR', false);
    }

    let payload: any;
    try {
      payload = await response.json();
    } catch {
      throw new FullEnrichEnrichmentError(502, 'FULLENRICH_ENRICHMENT_INVALID_RESPONSE', true);
    }
    const id = enrichmentId(payload?.enrichment_id);
    if (!id) {
      throw new FullEnrichEnrichmentError(502, 'FULLENRICH_ENRICHMENT_INVALID_RESPONSE', true);
    }
    return { enrichmentId: id };
  } catch (error) {
    if (error instanceof FullEnrichEnrichmentError) throw error;
    if (controller.signal.aborted || (error as { name?: string } | null)?.name === 'AbortError') {
      throw new FullEnrichEnrichmentError(504, 'FULLENRICH_ENRICHMENT_TIMEOUT', true);
    }
    throw new FullEnrichEnrichmentError(502, 'FULLENRICH_ENRICHMENT_UPSTREAM_ERROR', true);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Retrieves only a completed FullEnrich batch. Callers must not add
 * `forceResults`: partial results can incorrectly finalize a pending contact.
 */
export async function fetchFullEnrichBulkEnrichmentResult(input: {
  apiKey: string;
  enrichmentId: string;
  environment?: Record<string, string | undefined>;
}): Promise<FullEnrichBulkEnrichmentResult> {
  const apiKey = String(input.apiKey || '').trim();
  const id = enrichmentId(input.enrichmentId);
  if (!apiKey || !id) return { kind: 'retryable_error', errorCode: 'FULLENRICH_RESULT_REQUEST_INVALID' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs(input.environment));
  try {
    const response = await fetch(`${FULLENRICH_BULK_ENRICHMENT_URL}/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Cache-Control': 'no-store',
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    if (response.status === 402) {
      return await providerStatus(response) === 'CREDITS_INSUFFICIENT'
        ? { kind: 'terminal_failure', providerStatus: 'CREDITS_INSUFFICIENT' }
        : { kind: 'retryable_error', errorCode: 'FULLENRICH_RESULT_PAYMENT_REQUIRED' };
    }
    if (response.status === 400) {
      const code = await providerErrorCode(response);
      return code === 'error.enrichment.in_progress'
        ? { kind: 'in_progress' }
        : { kind: 'retryable_error', errorCode: 'FULLENRICH_RESULT_BAD_REQUEST' };
    }
    if (response.status === 404) return { kind: 'not_found' };
    if (response.status === 429) return { kind: 'retryable_error', errorCode: 'FULLENRICH_RESULT_RATE_LIMITED' };
    if (!response.ok) return { kind: 'retryable_error', errorCode: 'FULLENRICH_RESULT_UPSTREAM_ERROR' };

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_RESULT_BYTES) {
      return { kind: 'retryable_error', errorCode: 'FULLENRICH_RESULT_TOO_LARGE' };
    }
    const rawBody = Buffer.from(await response.arrayBuffer());
    if (rawBody.length > MAX_RESULT_BYTES) {
      return { kind: 'retryable_error', errorCode: 'FULLENRICH_RESULT_TOO_LARGE' };
    }
    return { kind: 'ready', rawBody };
  } catch (error) {
    if (controller.signal.aborted || (error as { name?: string } | null)?.name === 'AbortError') {
      return { kind: 'retryable_error', errorCode: 'FULLENRICH_RESULT_TIMEOUT' };
    }
    return { kind: 'retryable_error', errorCode: 'FULLENRICH_RESULT_UPSTREAM_ERROR' };
  } finally {
    clearTimeout(timeout);
  }
}
