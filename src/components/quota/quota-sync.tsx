'use client';

import { useEffect } from 'react';

import type { QuotaKind } from '@/lib/quota-client';
import { setClientQuotaSnapshot } from '@/lib/quota-client';

type QuotaStatus = {
  resource: QuotaKind;
  count: number;
  limit: number;
};

async function syncQuota(signal?: AbortSignal) {
  try {
    const res = await fetch('/api/quota/status', {
      method: 'GET',
      cache: 'no-store',
      signal,
    });

    if (!res.ok) return;

    const data = await res.json().catch(() => null);
    const statuses = Array.isArray(data?.statuses) ? data.statuses as QuotaStatus[] : [];
    for (const status of statuses) {
      if (!status?.resource) continue;
      setClientQuotaSnapshot(status.resource, { count: status.count, limit: status.limit });
    }
  } catch {
    // A cancelled navigation is expected; focus or the next mount will retry.
  }
}

export default function QuotaSync() {
  useEffect(() => {
    const abort = new AbortController();
    void syncQuota(abort.signal);

    const handleFocus = () => { void syncQuota(); };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void syncQuota();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      abort.abort();
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return null;
}
