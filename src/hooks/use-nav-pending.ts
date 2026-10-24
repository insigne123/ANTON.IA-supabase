'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { authenticatedApiFetch } from '@/lib/authenticated-api-fetch';

/** What waits for the person in three sections, for the numbers in the menu (APP-23); null shows nothing. */
export type NavPendingCounts = { conversations: number | null; cowork: number | null; opportunities: number | null };

const NONE: NavPendingCounts = { conversations: null, cowork: null, opportunities: null };
/** Read again at most this often when moving between screens or coming back to the tab, and on its own every few minutes. */
const FRESH_MS = 60_000;
const EVERY_MS = 5 * 60_000;
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

/** `route`: the open screen; moving to another one reads again, once the last read is a minute old. */
export function useNavPending(route: string): NavPendingCounts {
  const { user, organizationId } = useAuth();
  const key = user?.id && organizationId ? `${user.id}:${organizationId}` : '';
  const [state, setState] = useState<{ key: string; counts: NavPendingCounts }>({ key: '', counts: NONE });
  const last = useRef({ key: '', at: 0 });

  const refresh = useCallback(async (force = false) => {
    if (!key || !organizationId) return;
    if (!force && last.current.key === key && Date.now() - last.current.at < FRESH_MS) return;
    last.current = { key, at: Date.now() };
    try {
      const response = await authenticatedApiFetch('/api/nav/pending', { cache: 'no-store', headers: { 'x-organization-id': organizationId } });
      if (!response.ok) return;
      const body = await response.json();
      // Another organization chosen meanwhile: this answer is not for the menu on view.
      if (body?.organizationId !== organizationId) return;
      setState({ key, counts: { conversations: count(body.conversations), cowork: count(body.cowork), opportunities: count(body.opportunities) } });
    } catch { /* the menu keeps what it showed */ }
  }, [key, organizationId]);

  useEffect(() => { void refresh(); }, [refresh, route]);
  useEffect(() => {
    const onFocus = () => void refresh();
    const timer = window.setInterval(() => void refresh(true), EVERY_MS);
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  return state.key === key ? state.counts : NONE;
}
