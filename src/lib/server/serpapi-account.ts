type SerpApiAccountStatus = {
  configured: boolean;
  totalSearchesLeft: number | null;
  planSearchesLeft: number | null;
  extraCredits: number | null;
  thisMonthUsage: number | null;
  accountRateLimitPerHour: number | null;
  planName: string | null;
  accountEmail: string | null;
};

function getSerpApiApiKey() {
  const candidates = [
    process.env.SERPAPI_API_KEY,
    process.env.SERP_API_KEY,
    process.env.SERPAPI_KEY,
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim();
    if (normalized) return normalized;
  }

  return '';
}

function toNullableNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getSerpApiAccountStatus(): Promise<SerpApiAccountStatus> {
  const apiKey = getSerpApiApiKey();
  if (!apiKey) {
    return {
      configured: false,
      totalSearchesLeft: null,
      planSearchesLeft: null,
      extraCredits: null,
      thisMonthUsage: null,
      accountRateLimitPerHour: null,
      planName: null,
      accountEmail: null,
    };
  }

  const url = `https://serpapi.com/account.json?api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String(payload?.error || payload?.message || `SERPAPI_ACCOUNT_${res.status}`));
  }

  return {
    configured: true,
    totalSearchesLeft: toNullableNumber(payload?.total_searches_left),
    planSearchesLeft: toNullableNumber(payload?.plan_searches_left),
    extraCredits: toNullableNumber(payload?.extra_credits),
    thisMonthUsage: toNullableNumber(payload?.this_month_usage),
    accountRateLimitPerHour: toNullableNumber(payload?.account_rate_limit_per_hour),
    planName: String(payload?.plan_name || '').trim() || null,
    accountEmail: String(payload?.account_email || '').trim() || null,
  };
}

export function getAvailableSerpApiCredits(account: SerpApiAccountStatus) {
  return account.totalSearchesLeft ?? account.planSearchesLeft ?? account.extraCredits ?? 0;
}
