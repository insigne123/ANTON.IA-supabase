// The web for the agent: search and page reading are tools the API runs on its side, so the harness only offers them, keeps count of what
// they cost and reads what they did from the response. Pure: no SDK. The blocks themselves (the call, its result, the code that filters
// it) are not touched here: they go back with the conversation as they came.
import type { ContentBlock, ServerBlock, ServerToolSpec, Usage } from './types';

export const WEB_SEARCH_TOOL = 'web_search_20260209';
export const WEB_FETCH_TOOL = 'web_fetch_20260209';
/** The same tools without dynamic filtering: the model reads the results as they come and asks for the next search itself, instead of writing code that loops over searches. */
export const WEB_SEARCH_BASIC_TOOL = 'web_search_20250305';
export const WEB_FETCH_BASIC_TOOL = 'web_fetch_20250910';

export type WebSettings = {
  /** Searches and page reads a whole run may make. */
  searches: number;
  fetches: number;
  /** Pages that never feed the agent. */
  blockedDomains?: string[];
  /** Where the person is, so «licitaciones» finds Chile's and not the world's. */
  country?: string;
  timezone?: string;
  /** Tokens of a page that reach the model. */
  maxPageTokens?: number;
  /**
   * Searches or reads one call may make. Without it a call may spend the whole budget at once, and a model that asks for six searches
   * together never gets to look at the first results before the rest. With it the rest waits for the next call, which has seen them.
   */
  perCall?: number;
  /**
   * The basic tools, without the code that filters results. The model of the dynamic ones writes a loop of searches and, when the loop fails,
   * runs it again: it burns the searches of its budget on retries and ends «out of searches» after one real query (23 Oct, Enaex, three of
   * three runs). For a task that is a few searches and reading what they return, the basic ones are enough and cost fewer tokens.
   */
  basic?: boolean;
};

/**
 * The tools to offer now. Their definitions stay the same from one call to the next (the model's cache starts with them), so a limit is
 * not lowered as the run spends it: a tool is offered whole until its budget is spent, and then it is not offered.
 */
export function webToolSpecs(web: WebSettings, spent: Pick<Usage, 'webSearches' | 'webFetches'> = {}): ServerToolSpec[] {
  const specs: ServerToolSpec[] = [];
  // With a limit per call the definition does change as the budget is spent; the cache of the tool list matters less to a run of a few calls.
  const allowed = (budget: number, used: number | undefined) => (web.perCall ? Math.max(1, Math.min(web.perCall, budget - (used ?? 0))) : budget);
  if (web.searches > 0 && (spent.webSearches ?? 0) < web.searches) {
    specs.push({
      type: web.basic ? WEB_SEARCH_BASIC_TOOL : WEB_SEARCH_TOOL, name: 'web_search', max_uses: allowed(web.searches, spent.webSearches),
      ...(web.blockedDomains?.length ? { blocked_domains: web.blockedDomains } : {}),
      ...(web.country ? { user_location: { type: 'approximate', country: web.country, ...(web.timezone ? { timezone: web.timezone } : {}) } } : {}),
    });
  }
  if (web.fetches > 0 && (spent.webFetches ?? 0) < web.fetches) {
    specs.push({
      type: web.basic ? WEB_FETCH_BASIC_TOOL : WEB_FETCH_TOOL, name: 'web_fetch', max_uses: allowed(web.fetches, spent.webFetches),
      ...(web.blockedDomains?.length ? { blocked_domains: web.blockedDomains } : {}),
      ...(web.maxPageTokens ? { max_content_tokens: web.maxPageTokens } : {}),
    });
  }
  return specs;
}

export type WebSource = { title: string; url: string; age?: string };

/** One search or one page read the API made during a call, as the person would describe it. */
export type WebAction = {
  id: string;
  tool: 'web_search' | 'web_fetch';
  /** The query that was searched, or the address that was read. */
  input: string;
  ok: boolean;
  /** Search: the pages it found. Read: the page itself. */
  sources: WebSource[];
  /** A read page: the beginning of its text, for whoever has to check what the answer says against it. */
  excerpt?: string;
  /** Why it failed, in the API's own words. */
  error?: string;
};

const EXCERPT_CHARS = 1_500;
const asRecord = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null);
const text = (value: unknown) => (typeof value === 'string' ? value : '');

function searchResult(content: unknown): Pick<WebAction, 'ok' | 'sources' | 'error'> {
  if (Array.isArray(content)) {
    const sources = content.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item && text(item.url)))
      .map(item => ({ title: text(item.title).trim() || text(item.url), url: text(item.url), ...(text(item.page_age) ? { age: text(item.page_age) } : {}) }));
    return { ok: true, sources };
  }
  return { ok: false, sources: [], error: text(asRecord(content)?.error_code) || 'unavailable' };
}

function fetchResult(content: unknown): Pick<WebAction, 'ok' | 'sources' | 'error' | 'excerpt'> {
  const result = asRecord(content);
  if (!result || result.type !== 'web_fetch_result') return { ok: false, sources: [], error: text(result?.error_code) || 'unavailable' };
  const document = asRecord(result.content);
  const source = asRecord(document?.source);
  const body = text(source?.data);
  return {
    ok: true,
    sources: [{ title: text(document?.title).trim() || text(result.url), url: text(result.url), ...(text(result.retrieved_at) ? { age: text(result.retrieved_at) } : {}) }],
    ...(body ? { excerpt: body.slice(0, EXCERPT_CHARS) } : {}),
  };
}

/** The searches and page reads in a response, in the order they were made, each with what came back. The code the API runs to filter
 * them is not an action of the person's: it stays out. `onlyDone` leaves out a call whose result has not arrived yet (blocks seen while the
 * response is still being written); at the end of the response such a call is a failure, not a pending one. */
export function webActions(content: ContentBlock[], options: { onlyDone?: boolean } = {}): WebAction[] {
  const results = new Map<string, ServerBlock>();
  for (const block of content) {
    if (block.type !== 'web_search_tool_result' && block.type !== 'web_fetch_tool_result') continue;
    const id = block.tool_use_id;
    if (typeof id === 'string') results.set(id, block);
  }
  const actions: WebAction[] = [];
  for (const block of content) {
    if (block.type !== 'server_tool_use') continue;
    const call = block as { id?: unknown; name?: unknown; input?: unknown };
    const tool = call.name === 'web_search' || call.name === 'web_fetch' ? call.name : null;
    if (!tool || typeof call.id !== 'string') continue;
    const input = asRecord(call.input);
    const result = results.get(call.id);
    if (!result && options.onlyDone) continue;
    const outcome = !result ? { ok: false, sources: [], error: 'no_result' } : tool === 'web_search' ? searchResult(result.content) : fetchResult(result.content);
    actions.push({ id: call.id, tool, input: text(tool === 'web_search' ? input?.query : input?.url).trim(), ...outcome });
  }
  return actions;
}

/** A line for the trace: what was done and how it went. */
export function describeWebAction(action: WebAction): string {
  const what = action.tool === 'web_search' ? `Búsqueda «${action.input}»` : `Lectura de ${action.input}`;
  if (!action.ok) return `${what}: no se pudo (${action.error ?? 'sin respuesta'})`;
  return action.tool === 'web_search' ? `${what}: ${action.sources.length} resultado${action.sources.length === 1 ? '' : 's'}` : `${what}: leída`;
}
