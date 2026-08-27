const FULLENRICH_BULK_ENRICHMENT_URL = 'https://app.fullenrich.com/api/v2/contact/enrich/bulk';
const MAX_CONTACTS_PER_BATCH = 100;

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
    ...(!linkedinUrl && companyDomain ? { company_domain: companyDomain } : {}),
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
        contacts,
        webhook_url: input.webhookUrl,
        webhook_events: { contact_finished: input.webhookUrl },
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
