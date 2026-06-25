export type SupliaToolLeasePolicy = {
  resourceKey: string;
  maxConcurrent: number;
  ttlSeconds: number;
};

function envInt(env: Record<string, string | undefined>, key: string, fallback: number, min = 1, max = 100) {
  const parsed = Number(env[key]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

function clean(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function providerFromInput(input: Record<string, unknown>, fallback = 'auto') {
  const provider = clean(input.provider || input.providerUsed);
  if (provider === 'apollo' || provider === 'pdl' || provider === 'gmail' || provider === 'outlook') return provider;
  return fallback;
}

export function getSupliaToolLeasePolicy(
  toolName: string,
  input: Record<string, unknown> = {},
  env: Record<string, string | undefined> = process.env,
): SupliaToolLeasePolicy | null {
  const ttlSeconds = envInt(env, 'SUPLIA_TOOL_LEASE_TTL_SECONDS', 120, 15, 900);

  if (toolName === 'prospecting.search_companies' || toolName === 'prospecting.search_people') {
    const provider = providerFromInput(input, 'apollo');
    const maxConcurrent = provider === 'pdl'
      ? envInt(env, 'SUPLIA_PDL_CONCURRENCY_PER_ORG', 2, 1, 10)
      : envInt(env, 'SUPLIA_APOLLO_CONCURRENCY_PER_ORG', 1, 1, 10);
    return { resourceKey: `provider:${provider}`, maxConcurrent, ttlSeconds };
  }

  if (toolName === 'lead.enrich' || toolName === 'lead.enrich_batch') {
    const provider = providerFromInput(input, 'pdl');
    const maxConcurrent = provider === 'apollo'
      ? envInt(env, 'SUPLIA_APOLLO_CONCURRENCY_PER_ORG', 1, 1, 10)
      : envInt(env, 'SUPLIA_PDL_CONCURRENCY_PER_ORG', 2, 1, 10);
    return { resourceKey: `provider:${provider}`, maxConcurrent, ttlSeconds };
  }

  if (toolName === 'email.bulk_send') {
    return {
      resourceKey: 'email:bulk_send',
      maxConcurrent: envInt(env, 'SUPLIA_BULK_SEND_CONCURRENCY_PER_ORG', 1, 1, 5),
      ttlSeconds,
    };
  }

  if (toolName === 'email.send' || toolName === 'thread.reply_send') {
    const provider = providerFromInput(input, 'auto');
    return {
      resourceKey: `email:${provider}`,
      maxConcurrent: envInt(env, 'SUPLIA_EMAIL_CONCURRENCY_PER_ORG', 1, 1, 10),
      ttlSeconds,
    };
  }

  if (
    toolName === 'gmail.search_messages' ||
    toolName === 'gmail.get_message' ||
    toolName === 'gmail.get_thread' ||
    toolName === 'gmail.search_threads' ||
    toolName === 'gmail.find_contacted_leads'
  ) {
    return {
      resourceKey: 'gmail:read',
      maxConcurrent: envInt(env, 'SUPLIA_GMAIL_READ_CONCURRENCY_PER_ORG', 1, 1, 5),
      ttlSeconds,
    };
  }

  return null;
}

export function getSupliaStepTimeoutMs(env: Record<string, string | undefined> = process.env) {
  return envInt(env, 'SUPLIA_STEP_TIMEOUT_MS', 120000, 5000, 900000);
}
