// Reoon Email Verifier, "power" mode: asks the company's mail server whether the mailbox exists, without sending mail.
// https://www.reoon.com/articles/api-documentation-of-reoon-email-verifier/
import { signalProviderOutage } from '@/lib/server/provider-outage';

const REOON_VERIFY_URL = 'https://emailverifier.reoon.com/api/v1/verify';

export type ReoonStatus =
  | 'safe'
  | 'invalid'
  | 'disabled'
  | 'disposable'
  | 'inbox_full'
  | 'catch_all'
  | 'role_account'
  | 'spamtrap'
  | 'unknown';

const STATUSES = new Set<ReoonStatus>([
  'safe', 'invalid', 'disabled', 'disposable', 'inbox_full', 'catch_all', 'role_account', 'spamtrap', 'unknown',
]);

export class ReoonError extends Error {
  /** fatal: Reoon refuses the account (key, credits) or asks to slow down, so this run tries no other address. */
  constructor(readonly code: string, readonly fatal: boolean) {
    super(code);
    this.name = 'ReoonError';
  }
}

export async function verifyEmailWithReoon(
  email: string,
  options: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<ReoonStatus> {
  const url = new URL(REOON_VERIFY_URL);
  url.searchParams.set('email', email);
  url.searchParams.set('key', options.apiKey);
  url.searchParams.set('mode', 'power');
  let response: Response;
  try {
    response = await (options.fetchImpl || fetch)(url, {
      headers: { Accept: 'application/json' },
      // Power mode waits on the company's mail server and can take from seconds to over a minute.
      signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
      cache: 'no-store',
    });
  } catch {
    throw new ReoonError('reoon_unreachable', false);
  }
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  const reason = String(body?.reason || '').toLowerCase();
  if (response.status === 401 || response.status === 402 || response.status === 403
    || /\b(api )?key\b|credit|balance|quota|inactive|suspend/.test(reason)) {
    signalProviderOutage('reoon', response.status === 402 || /credit|balance|quota/.test(reason) ? 'empty' : 'refused', reason || `HTTP ${response.status}`);
    throw new ReoonError('reoon_account_refused', true);
  }
  if (response.status === 429) throw new ReoonError('reoon_rate_limited', true);
  if (!response.ok || body?.status === 'error') throw new ReoonError('reoon_error', false);
  const status = String(body?.status || '').toLowerCase() as ReoonStatus;
  return STATUSES.has(status) ? status : 'unknown';
}
