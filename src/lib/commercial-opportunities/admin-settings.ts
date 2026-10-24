// What the administrators decide for the whole workspace besides the offer and the search (OPP-06, OPP-10): who works what by rule
// («Seguridad → Diego»), so assigning the recommended ones is a confirmation and only the exceptions are thought about, and the
// searches of the list the team keeps, each with whoever wants to hear in the morning of what is new in it («seguir a un organismo» is
// one of them). Kept in opportunity_company_context.admin_settings and read leniently: a rule or a search that no longer reads is left
// out, never an error. Pure: the page, the route and the morning alert share it.
import { z } from 'zod';
import { ADMIN_LIST_VIEWS } from './list-stages';
import { workspaceUrl } from './workspace-url';
import { inCategories, OPPORTUNITY_CATEGORIES, OPPORTUNITY_SOURCES, sourceKinds, type OpportunityCategory, type OpportunitySource } from './workspace-radar';

export const MAX_RULES = 20;
export const MAX_SEARCHES = 20;
const CATEGORY_IDS = OPPORTUNITY_CATEGORIES.map(category => category.id) as [OpportunityCategory, ...OpportunityCategory[]];
const SOURCE_IDS = OPPORTUNITY_SOURCES.map(source => source.id) as [OpportunitySource, ...OpportunitySource[]];
const VIEW_IDS = ADMIN_LIST_VIEWS.map(view => view.id) as [typeof ADMIN_LIST_VIEWS[number]['id'], ...Array<typeof ADMIN_LIST_VIEWS[number]['id']>];
const id = z.string().regex(/^[a-z0-9-]{1,40}$/);

export const assignmentRuleSchema = z.object({
  id,
  /** The line of service (Rubro); null: any. */
  category: z.enum(CATEGORY_IDS).nullable(),
  /** In pesos; an amount in another currency or not said never meets it. Null: any amount. */
  minAmount: z.number().int().positive().nullable(),
  userId: z.string().uuid(),
}).strict();
export type AssignmentRule = z.infer<typeof assignmentRuleSchema>;

export const savedSearchSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  /** The filters of the list, as its address says them (workspace-url.ts). */
  filter: z.enum(VIEW_IDS), source: z.enum(SOURCE_IDS), query: z.string().trim().max(200), categories: z.array(z.enum(CATEGORY_IDS)).max(CATEGORY_IDS.length),
  /** Who hears in the morning alert of the new ones. */
  notify: z.array(z.string().uuid()).max(100),
  createdBy: z.string().uuid(),
}).strict();
export type SavedSearch = z.infer<typeof savedSearchSchema>;
export type AdminSettings = { rules: AssignmentRule[]; searches: SavedSearch[] };

/** What is saved, item by item: a rule or a search that no longer reads (an older shape, a category that left) is passed over. */
export function readAdminSettings(raw: unknown): AdminSettings {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const items = <T>(list: unknown, schema: z.ZodType<T>, max: number) =>
    (Array.isArray(list) ? list : []).flatMap(item => { const parsed = schema.safeParse(item); return parsed.success ? [parsed.data] : []; }).slice(0, max);
  return { rules: items(value.rules, assignmentRuleSchema, MAX_RULES), searches: items(value.searches, savedSearchSchema, MAX_SEARCHES) };
}

type Rated = { title?: string | null; data?: unknown; amount?: number | null; currency?: string | null };
const inPesos = (item: Rated) => (typeof item.amount === 'number' && Number.isFinite(item.amount) && (!item.currency || item.currency === 'CLP') ? item.amount : null);

/**
 * The first rule an opportunity meets, in the order of the list: its line of service (any, when the rule says none) and, when the rule
 * asks for one, an amount in pesos at least that big. A rule for someone who is no longer in the workspace is passed over.
 */
export function ruleFor(item: Rated, rules: readonly AssignmentRule[], memberIds: ReadonlySet<string>) {
  return rules.find(rule => memberIds.has(rule.userId)
    && (!rule.category || inCategories(item, [rule.category]))
    && (rule.minAmount === null || (inPesos(item) ?? -1) >= rule.minAmount)) ?? null;
}

const compactPesos = new Intl.NumberFormat('es-CL', { notation: 'compact', maximumFractionDigits: 1 });
/** «Seguridad → Diego», «Aseo desde $50 M → María», «Todas → Diego». */
export function ruleLabel(rule: Pick<AssignmentRule, 'category' | 'minAmount'>, name: string) {
  const what = rule.category ? OPPORTUNITY_CATEGORIES.find(category => category.id === rule.category)?.label ?? 'Todas' : 'Todas';
  return `${what}${rule.minAmount ? ` desde $${compactPesos.format(rule.minAmount)}` : ''} → ${name}`;
}

export type RuleGroup = { userId: string; name: string; rule: AssignmentRule; ids: string[] };
/**
 * The opportunities a rule gives to someone, by person in the order of the rules: what «Asignarlas» assigns, each person once with all
 * of theirs. Only the ones given (the page passes what nobody works yet).
 */
export function ruleGroups<T extends Rated & { id: string }>(items: readonly T[], rules: readonly AssignmentRule[], members: ReadonlyArray<{ user_id: string; name: string }>): RuleGroup[] {
  const memberIds = new Set(members.map(member => member.user_id));
  const groups = new Map<string, RuleGroup>();
  for (const item of items) {
    const rule = ruleFor(item, rules, memberIds);
    if (!rule) continue;
    const group = groups.get(rule.userId) ?? { userId: rule.userId, name: members.find(member => member.user_id === rule.userId)?.name || 'Integrante', rule, ids: [] };
    group.ids.push(item.id);
    groups.set(rule.userId, group);
  }
  return [...groups.values()].sort((a, b) => rules.indexOf(a.rule) - rules.indexOf(b.rule));
}

export type SearchState = Pick<SavedSearch, 'filter' | 'source' | 'query' | 'categories'>;
const sameWords = (a: string, b: string) => a.trim().toLocaleLowerCase('es') === b.trim().toLocaleLowerCase('es');
/** The same filters, whatever the name: saving it again renames it instead of keeping two. */
export const sameSearch = (a: SearchState, b: SearchState) => a.filter === b.filter && a.source === b.source && sameWords(a.query, b.query)
  && a.categories.length === b.categories.length && a.categories.every(category => b.categories.includes(category));
/** Whether there is anything to save: the plain list is not a search. */
export const isSearch = (state: SearchState) => Boolean(state.query.trim()) || state.source !== 'all' || state.categories.length > 0;

/** A name for what is on screen: the words, the lines of service and the source («“guardias” · Seguridad · Licitaciones»). */
export function searchName(state: SearchState) {
  const parts = [
    state.query.trim() ? `“${state.query.trim().slice(0, 40)}”` : '',
    ...OPPORTUNITY_CATEGORIES.filter(category => state.categories.includes(category.id)).map(category => category.label),
    state.source !== 'all' ? OPPORTUNITY_SOURCES.find(source => source.id === state.source)?.label ?? '' : '',
  ].filter(Boolean);
  return (parts.join(' · ') || 'Todas las oportunidades').slice(0, 80);
}

/** The list with the search's filters: what a chip of «Tus búsquedas» and the morning alert open. */
export const searchHref = (search: SearchState) =>
  workspaceUrl('/opportunities', { view: 'list', filter: search.filter, source: search.source, query: search.query, categories: [...search.categories], sort: 'priority' });

/** «Avisarme de este organismo»: a search by its name over everything, with the person who asks for it told of what is new. */
export const buyerSearch = (buyer: string): SearchState & { name: string } =>
  ({ name: buyer.trim().slice(0, 80), filter: 'all', source: 'all', query: buyer.trim().slice(0, 200), categories: [] });

export type NewOpportunity = { kind: string; title: string; company_name?: string | null; buyer_name?: string | null; deadline_at?: string | null;
  evaluation?: string | null; summary?: string | null };
/**
 * Whether a new opportunity is one the search would show and is worth telling in the morning: its source, its words (in the title, the
 * company or the buyer, as the list looks for them), its line of service; never one the AI left out or one that can no longer be bid.
 * The stage of the search is for the list it opens: what arrives is often still being read by the AI.
 */
export function matchesSearch(item: NewOpportunity, search: SearchState, now: Date) {
  const kinds = sourceKinds(search.source);
  if (kinds.length && !kinds.includes(item.kind)) return false;
  if (item.evaluation === 'excluded') return false;
  if (item.deadline_at && Date.parse(item.deadline_at) <= now.getTime()) return false;
  const words = search.query.trim().toLocaleLowerCase('es');
  if (words && ![item.title, item.company_name, item.buyer_name].some(text => String(text || '').toLocaleLowerCase('es').includes(words))) return false;
  return inCategories({ title: item.title, data: { summary: { text: item.summary || '' } } }, search.categories);
}
