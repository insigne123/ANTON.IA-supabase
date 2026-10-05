'use client';

import { useEffect, useState } from 'react';

// One question per page load: the switch only changes with a deploy.
let answer: Promise<boolean> | null = null;

/** Whether the pipeline shows and saves the value of each deal (CRM_DEAL_VALUES_ENABLED); false while it is not known. */
export function useCrmDealValues() {
  const [enabled, setEnabled] = useState(false);
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
