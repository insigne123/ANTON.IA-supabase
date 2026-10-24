// The filters of «Oportunidades» in its address: a link opens the same view («las licitaciones de salud por revisar») and the browser's
// back button returns to the filter before. Words a person reads (vista=lista, etapa=review, fuente=tender, q=…, rubro=aseo, orden=amount),
// and only what differs from the default, so the plain page keeps its plain address. Pure: the page and the tests share it.
import { LIST_VIEWS } from './list-stages';
import { parsePrioritySort, type PrioritySort } from './priority';
import { isOpportunitySource, parseCategories, type OpportunityCategory, type OpportunitySource } from './workspace-radar';

export type WorkspaceView = 'pipeline' | 'list' | 'market' | 'tasks' | 'assistant';
export type WorkspaceUrlState = { view: WorkspaceView; filter: string; source: OpportunitySource; query: string; categories: OpportunityCategory[]; sort: PrioritySort };
const VIEW_WORDS: Record<WorkspaceView, string> = { pipeline: 'embudo', list: 'lista', market: 'mercado', tasks: 'tareas', assistant: 'asistente' };
/** The part of an opportunity a link opens on (the emails of a note that names someone and of tasks given): «seccion=tareas». */
const SECTION_WORDS: Record<string, string> = { informe: 'summary', postular: 'apply', documentos: 'documents', tareas: 'tasks', actividad: 'activity' };
/** The member's «Presentadas y cerradas» is read on the page from everything of theirs (member-work.ts). */
const FILTERS: readonly string[] = [...LIST_VIEWS, 'done'];
export const WORKSPACE_URL_DEFAULTS: WorkspaceUrlState = { view: 'pipeline', filter: 'recommended', source: 'all', query: '', categories: [], sort: 'priority' };

/** What an address asks for; anything unknown is the default. */
export function readWorkspaceUrl(search: string): WorkspaceUrlState & { op: string | null; section: string | null } {
  const params = new URLSearchParams(search);
  const view = (Object.entries(VIEW_WORDS).find(([, word]) => word === params.get('vista'))?.[0] ?? WORKSPACE_URL_DEFAULTS.view) as WorkspaceView;
  const filter = params.get('etapa') || '';
  const source = params.get('fuente');
  return {
    view, filter: FILTERS.includes(filter) ? filter : WORKSPACE_URL_DEFAULTS.filter,
    source: isOpportunitySource(source) ? source : 'all', query: (params.get('q') || '').slice(0, 200),
    categories: parseCategories(params.get('rubro')), sort: parsePrioritySort(params.get('orden')), op: params.get('op'),
    section: SECTION_WORDS[params.get('seccion') || ''] ?? null,
  };
}

/** The address of a state: the path with only what is not the default, and the open opportunity last. */
export function workspaceUrl(pathname: string, state: WorkspaceUrlState, op: string | null = null) {
  const params = new URLSearchParams();
  if (state.view !== WORKSPACE_URL_DEFAULTS.view) params.set('vista', VIEW_WORDS[state.view]);
  if (state.filter !== WORKSPACE_URL_DEFAULTS.filter) params.set('etapa', state.filter);
  if (state.source !== 'all') params.set('fuente', state.source);
  if (state.query.trim()) params.set('q', state.query.trim().slice(0, 200));
  if (state.categories.length) params.set('rubro', state.categories.join(','));
  if (state.sort !== 'priority') params.set('orden', state.sort);
  if (op) params.set('op', op);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
