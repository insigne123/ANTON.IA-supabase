'use client';

import { useEffect, useState } from 'react';

// One question per page load: the switch only changes with a deploy.
let answer: Promise<boolean> | null = null;

/**
 * Whether the pipeline shows and saves the value of each deal (CRM_DEAL_VALUES_ENABLED); null while it is not known yet,
 * so the page can wait and read its rows once. A failed question counts as off.
 */
export function useCrmDealValues() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    answer ||= fetch('/api/crm/deal-values', { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : { enabled: false }))
      .then(data => data?.enabled === true)
      .catch(() => { answer = null; return false; });
    void answer.then(value => { if (active) setEnabled(value); });
    return () => { active = false; };
  }, []);
  return enabled;
}
