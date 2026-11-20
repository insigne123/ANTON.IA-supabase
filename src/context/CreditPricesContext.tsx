'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { authenticatedApiFetch } from '@/lib/authenticated-api-fetch';
import { DEFAULT_CREDIT_PRICES, creditPricesOf, type CreditPrices } from '@/lib/credit-prices';

const CreditPricesContext = createContext<CreditPrices>(DEFAULT_CREDIT_PRICES);

const key = (organizationId: string) => `anton:credit-prices:${organizationId}`;

/** The last prices seen for the workspace in this tab, so the buttons do not show the default first on every screen. */
function remembered(organizationId: string): CreditPrices | null {
  try {
    const stored = window.sessionStorage.getItem(key(organizationId));
    return stored ? creditPricesOf(JSON.parse(stored)) : null;
  } catch { return null; }
}

/**
 * What an email and a phone cost in the workspace the person has open (src/lib/credit-prices.ts), for every button that looks
 * a contact up. Read once per workspace from /api/credits/prices; while it loads, or if it cannot be read, the buttons say the
 * default. What is charged never depends on this: the server counts with the organization's prices.
 */
export function CreditPricesProvider({ children }: { children: ReactNode }) {
  const { organizationId } = useAuth();
  const [prices, setPrices] = useState<CreditPrices>(DEFAULT_CREDIT_PRICES);
  useEffect(() => {
    if (!organizationId) { setPrices(DEFAULT_CREDIT_PRICES); return; }
    let shown = true;
    setPrices(remembered(organizationId) ?? DEFAULT_CREDIT_PRICES);
    authenticatedApiFetch('/api/credits/prices', { cache: 'no-store', headers: { 'x-organization-id': organizationId } })
      .then(response => (response.ok ? response.json() : null))
      .then(body => {
        if (!shown || !body?.prices) return;
        const next = creditPricesOf(body.prices);
        setPrices(next);
        try { window.sessionStorage.setItem(key(organizationId), JSON.stringify(next)); } catch { /* the tab keeps them in memory */ }
      })
      .catch(() => undefined);
    return () => { shown = false; };
  }, [organizationId]);
  return <CreditPricesContext.Provider value={prices}>{children}</CreditPricesContext.Provider>;
}

/** The workspace's prices; the default outside the app's shell. */
export const useCreditPrices = () => useContext(CreditPricesContext);
