'use client';

import { useEffect, useState } from 'react';
import { authenticatedApiFetch } from '@/lib/authenticated-api-fetch';
import { leadFitKey, type LeadFitLead, type LeadFitStage } from '@/lib/lead-fit/core';
import type { LeadFitPerson } from '@/lib/server/lead-fit';

export type LeadFitView = {
  results: Record<string, LeadFitPerson>;
  /** Estimates still on their way for these people. */
  pending: Set<string>;
  needsProfile: boolean;
  limited: boolean;
  failed: boolean;
};

const EMPTY: LeadFitView = { results: {}, pending: new Set(), needsProfile: false, limited: false, failed: false };

/**
 * «Probabilidad de calce» for the people on screen (src/app/api/leads/fit): the kept estimates and new ones for the people
 * whose facts changed, one request per stage and page. Without an answer there is nothing to show and the page works as before.
 */
export function useLeadFit(items: Array<{ stage: LeadFitStage; lead: LeadFitLead }>, enabled = true): LeadFitView {
  const [view, setView] = useState<LeadFitView>(EMPTY);
  const groups = new Map<LeadFitStage, LeadFitLead[]>();
  for (const item of items.slice(0, 100)) {
    if (!leadFitKey(item.lead)) continue;
    groups.set(item.stage, [...(groups.get(item.stage) || []), item.lead]);
  }
  const request = enabled ? JSON.stringify([...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) : '[]';

  useEffect(() => {
    const parsed = JSON.parse(request) as Array<[LeadFitStage, LeadFitLead[]]>;
    if (!parsed.length) { setView(EMPTY); return; }
    const controller = new AbortController();
    const keys = parsed.flatMap(([, leads]) => leads.map(lead => leadFitKey(lead)!).filter(Boolean));
    setView(current => ({ ...current, pending: new Set(keys) }));
    Promise.all(parsed.map(([stage, leads]) => authenticatedApiFetch('/api/leads/fit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ stage, leads: leads.slice(0, 50), score: true }),
    }).then(response => response.ok ? response.json() : null).catch(() => null)))
      .then(answers => {
        if (controller.signal.aborted) return;
        const next: LeadFitView = { results: {}, pending: new Set(), needsProfile: false, limited: false, failed: false };
        for (const answer of answers) {
          if (!answer) { next.failed = true; continue; }
          for (const [key, person] of Object.entries((answer.results || {}) as Record<string, LeadFitPerson>)) {
            next.results[key] = { ...(next.results[key] || {}), ...person };
          }
          next.needsProfile ||= Boolean(answer.needsProfile);
          next.limited ||= Boolean(answer.limited);
          next.failed ||= Boolean(answer.failed);
        }
        setView(next);
      });
    return () => controller.abort();
  }, [request]);
  return view;
}
