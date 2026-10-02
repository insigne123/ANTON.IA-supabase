'use client';

import { useEffect, useState } from 'react';
import type { TeamLocks } from '@/lib/server/team-locks';

/**
 * Team locks for the people on screen (Plan 5, PR-9b). Reads once per distinct set of people; without collaboration, or
 * if the read fails, there is nothing to show and the screen works as before.
 */
export function useTeamLocks(input: { emails?: string[]; providerIds?: string[]; linkedinUrls?: string[] }): TeamLocks | null {
  const [locks, setLocks] = useState<TeamLocks | null>(null);
  const emails = [...new Set((input.emails || []).filter(Boolean))].sort().slice(0, 200);
  const providerIds = [...new Set((input.providerIds || []).filter(Boolean))].sort().slice(0, 200);
  const linkedinUrls = [...new Set((input.linkedinUrls || []).filter(Boolean))].sort().slice(0, 200);
  const key = JSON.stringify([emails, providerIds, linkedinUrls]);
  useEffect(() => {
    const [nextEmails, nextProviderIds, nextLinkedinUrls] = JSON.parse(key) as string[][];
    if (!nextEmails.length && !nextProviderIds.length && !nextLinkedinUrls.length) { setLocks(null); return; }
    const controller = new AbortController();
    fetch('/api/team-locks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', signal: controller.signal,
      body: JSON.stringify({ emails: nextEmails, providerIds: nextProviderIds, linkedinUrls: nextLinkedinUrls }),
    })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (!controller.signal.aborted) setLocks(data && data.enabled ? data as TeamLocks : null); })
      .catch(() => { if (!controller.signal.aborted) setLocks(null); });
    return () => controller.abort();
  }, [key]);
  return locks;
}
