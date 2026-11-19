import type { SupabaseClient } from '@supabase/supabase-js';
import { generateStructured } from '@/ai/openai-json';
import { dayInZone } from '@/lib/admin/chile-time';
import { lacksResearch, type DropItem } from '@/lib/lead-drops';
import { loadCoworkUserContext } from '@/lib/server/cowork/user-context';
import { patchItem } from '@/lib/server/lead-drop-mail';
import { briefNewsLine, dropBriefEnabled, researchDropContact, type DropResearch, type DropResearchInput } from '@/lib/server/lead-drop-research';
import { readDrop } from '@/lib/server/lead-drops';

/**
 * The research of a contact that reached the person without it, done when they open their contacts in the app (19 Nov 2026, the
 * owner: «haz que los mails que mandamos sí tengan investigación en la app»). The web search ran out of credits for two mornings and
 * every contact went out with its emails written but nothing about its company: no «Ahora», no «Cómo abrir», no summary. Nothing
 * tried it again, so those contacts stayed bare for good.
 *
 * `researchDropLate` reads the drop, researches at once the contacts that lack it (lacksResearch), and keeps what it found on each:
 * the brief, the company's summary and facts, and its site when the search had brought none. A contact with nothing to find is
 * marked as tried, so it is not looked for on every visit, and tried again after a day (the search may have been down). The emails
 * are left as they were written: the person may have changed or approved them.
 */

type Client = SupabaseClient;
type Scope = { organizationId: string; userId: string };
type Research = (input: DropResearchInput) => Promise<DropResearch | null>;

/** How many contacts one visit researches: a drop of several, whole. */
export const LATE_RESEARCH_MAX = 10;
/** A drop older than this is not researched on opening: its news would be stale and nobody is writing to it now. */
export const LATE_RESEARCH_DAYS = 14;

/** A contact with what the late research found of it, as `writeDrop` would have kept it. */
export function withLateResearch(item: DropItem, research: DropResearch | null, at: string): DropItem {
  if (item.brief) return item;
  if (!research) return { ...item, researchedAt: at };
  const brief = research.brief;
  const facts = [brief.company, brief.news ? briefNewsLine(brief.news) : null].filter((fact): fact is string => Boolean(fact) && !(item.research || []).includes(fact as string));
  return {
    ...item, brief, researchedAt: at, summary: brief.company ?? item.summary ?? null, research: [...facts, ...(item.research || [])],
    ...(research.domain && !item.domain ? { domain: research.domain, website: item.website ?? `https://${research.domain}` } : {}),
  };
}

export async function researchDropLate(client: Client, scope: Scope, dropId: string, deps: { research?: Research; now?: Date } = {}): Promise<{ researched: number; items: DropItem[] }> {
  const now = deps.now ?? new Date();
  const drop = await readDrop(client, scope, dropId);
  const fresh = drop.drop_date >= dayInZone(new Date(now.getTime() - LATE_RESEARCH_DAYS * 86_400_000));
  const missing = fresh ? drop.items.filter(item => lacksResearch(item, now)).slice(0, LATE_RESEARCH_MAX) : [];
  if (!missing.length || (!deps.research && !dropBriefEnabled())) return { researched: 0, items: drop.items };
  const generate = (options: Parameters<typeof generateStructured>[0]) => generateStructured({ ...options, allowDefaultModelFallback: false, maxAttempts: 1 });
  const research: Research = deps.research ?? (input => researchDropContact(input, { generate: generate as Parameters<typeof researchDropContact>[1]['generate'], now }));
  const context = await loadCoworkUserContext(client, scope, { memories: false, mailbox: false }).catch(() => null);
  const seller = context ? { company: context.companyName, offer: context.offer, services: context.services, proofPoints: context.proofPoints, sector: context.sector } : null;
  const found = await Promise.all(missing.map(item => research({ organizationId: scope.organizationId, seller,
    contact: { title: item.title, company: item.company, domain: item.domain, country: item.country, industry: item.industry } }).catch(() => null)));
  const at = now.toISOString();
  // One at a time, each read again: another button may have written the drop while the web was read.
  for (const [index, item] of missing.entries()) await patchItem(client, scope, dropId, item.leadId, entry => withLateResearch(entry, found[index], at));
  return { researched: found.filter(Boolean).length, items: (await readDrop(client, scope, dropId)).items };
}
