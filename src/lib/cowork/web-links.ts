// The links of an answer that Cowork wrote after reading the web: each one has to come from somewhere the agent actually looked. A model that
// remembers a plausible address instead of copying it from a result hands the person a dead link with a source's authority, so the answer is
// checked before it is delivered. Pure.
import type { CoworkAnswer } from './agent-loop';

const LINK = /https?:\/\/[^\s<>()\[\]"'`]+/gi;
const TRAILING = /[.,;:!?»”’*_)\]]+$/;

/** The site of an address without its «www.», or null when it is not one. */
export function coworkLinkHost(link: string): string | null {
  try {
    const url = new URL(link.replace(TRAILING, ''));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname.toLowerCase().replace(/^www\./, '') : null;
  } catch { return null; }
}

/** Every address written in a value (text or any data), by site. */
function hostsIn(value: unknown): Set<string> {
  const hosts = new Set<string>();
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  for (const match of text.matchAll(LINK)) {
    const host = coworkLinkHost(match[0]);
    if (host) hosts.add(host);
  }
  return hosts;
}

/**
 * The links of the answer whose site appears nowhere in what the turn looked at: the pages of its searches and readings, the other
 * observations, the conversation, what the person wrote and what Cowork knows of them. A link to a site that was seen passes even if its
 * path was not (a page of the same company), so a correct answer is rarely held back; the check is for the address made up out of nothing.
 */
export function coworkUnseenLinks(answer: Pick<CoworkAnswer, 'reply' | 'document' | 'question'>, seen: unknown[]): string[] {
  const known = new Set<string>();
  for (const value of seen) for (const host of hostsIn(value)) known.add(host);
  const unseen: string[] = [];
  for (const text of [answer.reply, answer.document?.content, answer.question]) {
    for (const match of (text ?? '').matchAll(LINK)) {
      const link = match[0].replace(TRAILING, '');
      const host = coworkLinkHost(link);
      if (host && !known.has(host) && !unseen.includes(link)) unseen.push(link);
    }
  }
  return unseen.slice(0, 5);
}
