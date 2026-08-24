import { createHash } from 'node:crypto';

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizeDomain(value: unknown) {
  const raw = normalize(value);
  if (!raw) return '';

  try {
    const url = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/:].*$/, '');
  }
}

export function buildN8nResearchRequestIdempotencyKey(input: {
  userId: string;
  organizationId: string;
  leadRef?: string | null;
  email?: string | null;
  companyDomain?: string | null;
  clientKey?: string | null;
  freshnessBucket: string | number;
}) {
  const seed = JSON.stringify([
    'n8n-research-request/v1',
    normalize(input.userId),
    normalize(input.organizationId),
    normalize(input.leadRef),
    normalize(input.email),
    normalizeDomain(input.companyDomain),
    normalize(input.clientKey),
    normalize(input.freshnessBucket),
  ]);
  return `research:n8n:v1:${createHash('sha256').update(seed).digest('hex')}`;
}
