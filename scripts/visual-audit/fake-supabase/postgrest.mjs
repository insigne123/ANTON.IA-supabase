// A small PostgREST stand-in for the visual audit: enough of the query language that supabase-js 2.x sends for the app to
// render its pages against fixture rows. Pure functions over an in-memory store: no network, no files.
import { randomUUID } from 'node:crypto';

const OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'cs', 'cd', 'ov', 'fts', 'plfts', 'phfts', 'wfts', 'match', 'imatch'];
const CONDITION = new RegExp(`^(.+?)\\.(not\\.)?(${OPERATORS.join('|')})\\.([\\s\\S]*)$`);

export function createStore(tables = {}) {
  return { tables: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, structuredClone(rows)])), log: [] };
}

/** A value inside a row by column or JSON path: `data`, `data->key`, `data->>key`, `a->b->>c`. */
export function getPath(row, key) {
  const parts = key.split(/->>?/);
  let value = row?.[parts[0]];
  for (const part of parts.slice(1)) {
    if (value == null) return undefined;
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return undefined; } }
    value = value[part];
  }
  if (key.includes('->>') && value != null && typeof value === 'object') return JSON.stringify(value);
  return value;
}

const unquote = value => (value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).replace(/\\(.)/g, '$1') : value);

/** Split on commas that are outside parentheses, braces and double quotes. */
export function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\\' && quoted) { current += char + (text[i + 1] ?? ''); i++; continue; }
    if (char === '"') quoted = !quoted;
    if (!quoted && (char === '(' || char === '{')) depth++;
    if (!quoted && (char === ')' || char === '}')) depth--;
    if (char === ',' && depth === 0 && !quoted) { parts.push(current); current = ''; continue; }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function comparable(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = String(value);
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}
function compare(a, b) {
  const x = comparable(a);
  const y = comparable(b);
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return String(x).localeCompare(String(y));
}
const likeRegex = (pattern, flags) => new RegExp(`^${unquote(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*').replace(/_/g, '.')}$`, flags);
const parseList = raw => splitTopLevel(raw.replace(/^[({]/, '').replace(/[)}]$/, '')).map(item => unquote(item.trim()));
const toArray = value => (Array.isArray(value) ? value : typeof value === 'string' && value.startsWith('{') ? parseList(value) : value == null ? [] : [value]);

/** Whether a row value passes one operator. `raw` is the text after the operator, as PostgREST receives it. */
export function testOperator(value, operator, raw) {
  switch (operator) {
    case 'eq': return value != null && String(comparable(value)) === String(comparable(unquote(raw)));
    case 'neq': return value != null && !(String(comparable(value)) === String(comparable(unquote(raw))));
    case 'gt': return value != null && compare(value, unquote(raw)) > 0;
    case 'gte': return value != null && compare(value, unquote(raw)) >= 0;
    case 'lt': return value != null && compare(value, unquote(raw)) < 0;
    case 'lte': return value != null && compare(value, unquote(raw)) <= 0;
    case 'like': return value != null && likeRegex(raw, 's').test(String(value));
    case 'ilike': return value != null && likeRegex(raw, 'si').test(String(value));
    case 'match': return value != null && new RegExp(unquote(raw)).test(String(value));
    case 'imatch': return value != null && new RegExp(unquote(raw), 'i').test(String(value));
    case 'is': {
      if (raw === 'null') return value === null || value === undefined;
      if (raw === 'not_null') return value !== null && value !== undefined;
      if (raw === 'true') return value === true;
      if (raw === 'false') return value === false;
      if (raw === 'unknown') return value === null || value === undefined;
      return false;
    }
    case 'in': return value != null && parseList(raw).some(item => String(comparable(item)) === String(comparable(value)));
    case 'cs': {
      if (raw.startsWith('{') && !raw.startsWith('{"') || raw === '{}') { const want = parseList(raw); const have = toArray(value).map(String); return want.every(item => have.includes(item)); }
      try { return containsJson(value, JSON.parse(raw)); } catch { return false; }
    }
    case 'cd': { const allowed = parseList(raw); return toArray(value).every(item => allowed.includes(String(item))); }
    case 'ov': { const want = parseList(raw); return toArray(value).some(item => want.includes(String(item))); }
    default: return true; // text search operators: the audit has no full-text index.
  }
}
function containsJson(have, want) {
  if (typeof have === 'string') { try { have = JSON.parse(have); } catch { return false; } }
  if (Array.isArray(want)) return Array.isArray(have) && want.every(item => have.some(entry => containsJson(entry, item) || entry === item));
  if (want && typeof want === 'object') return !!have && typeof have === 'object' && Object.entries(want).every(([key, value]) => containsJson(have[key], value));
  return have === want;
}

/** One `column.op.value` condition, with the `not.` prefix. */
export function parseCondition(text) {
  const match = text.match(CONDITION);
  if (!match) return null;
  return { column: match[1], negate: !!match[2], operator: match[3], raw: match[4] };
}

/** The tree of an `or=(…)` / `and=(…)` expression. */
export function parseLogic(kind, inner) {
  return { kind, items: splitTopLevel(inner).map(part => {
    const trimmed = part.trim();
    const nested = trimmed.match(/^(not\.)?(and|or)\(([\s\S]*)\)$/);
    if (nested) return { ...parseLogic(nested[2], nested[3]), negate: !!nested[1] };
    return parseCondition(trimmed);
  }).filter(Boolean) };
}
function testNode(row, node) {
  if (node.kind) {
    const results = node.items.map(item => testNode(row, item));
    const value = node.kind === 'and' ? results.every(Boolean) : results.some(Boolean);
    return node.negate ? !value : value;
  }
  const value = testOperator(getPath(row, node.column), node.operator, node.raw);
  return node.negate ? !value : value;
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
/** The filters of a query string: column filters plus `or` / `and` groups. */
export function parseFilters(search) {
  const filters = [];
  for (const [key, value] of search.entries()) {
    if (RESERVED.has(key) || key.endsWith('.order') || key.endsWith('.limit') || key.endsWith('.offset')) continue;
    if (key === 'or' || key === 'and') { filters.push(parseLogic(key, value.replace(/^\(/, '').replace(/\)$/, ''))); continue; }
    if (key === 'not.or' || key === 'not.and') { filters.push({ ...parseLogic(key.slice(4), value.replace(/^\(/, '').replace(/\)$/, '')), negate: true }); continue; }
    const condition = parseCondition(`${key}.${value}`);
    if (condition) filters.push(condition);
  }
  return filters;
}
export const matches = (row, filters) => filters.every(node => testNode(row, node));

/** `order=a.desc.nullslast,b->>c.asc` as comparators. */
export function parseOrder(text) {
  if (!text) return [];
  return splitTopLevel(text).map(spec => {
    const parts = spec.split('.');
    let nulls = null;
    let ascending = true;
    while (parts.length > 1 && ['asc', 'desc', 'nullsfirst', 'nullslast'].includes(parts[parts.length - 1])) {
      const flag = parts.pop();
      if (flag === 'desc') ascending = false;
      if (flag === 'asc') ascending = true;
      if (flag === 'nullsfirst') nulls = 'first';
      if (flag === 'nullslast') nulls = 'last';
    }
    return { column: parts.join('.'), ascending, nulls: nulls ?? (ascending ? 'last' : 'first') };
  });
}
export function sortRows(rows, order) {
  if (!order.length) return rows;
  return [...rows].sort((a, b) => {
    for (const { column, ascending, nulls } of order) {
      const x = getPath(a, column);
      const y = getPath(b, column);
      if (x == null && y == null) continue;
      if (x == null) return nulls === 'first' ? -1 : 1;
      if (y == null) return nulls === 'first' ? 1 : -1;
      const diff = compare(x, y);
      if (diff) return ascending ? diff : -diff;
    }
    return 0;
  });
}

/** The select list: plain columns, aliases (`alias:data->>key`) and embeds (`alias:table!fk(cols)`, `table(cols)`). */
export function parseSelect(text = '*') {
  return splitTopLevel(text.replace(/\s+/g, '')).map(item => {
    const embed = item.match(/^(?:([\w]+):)?([\w]+)(?:!([\w]+))?(?:!inner|!left)?\(([\s\S]*)\)$/);
    if (embed) return { kind: 'embed', alias: embed[1] || embed[2], target: embed[2], hint: embed[3] || null, select: embed[4] };
    const alias = item.match(/^([\w]+):([\s\S]+?)(?:::\w+)?$/);
    if (alias && !alias[2].includes('(')) return { kind: 'alias', alias: alias[1], column: alias[2] };
    return { kind: 'column', column: item.replace(/::\w+$/, '') };
  });
}

const singular = name => name.replace(/ies$/, 'y').replace(/s$/, '');
/** How an embed joins. Explicit rules first; then `user_id → profiles.id`; then the usual `<table>_id` conventions. */
function resolveEmbed(store, table, item, embeds) {
  const rule = embeds?.[table]?.[item.alias] || embeds?.[table]?.[item.target];
  if (rule) return rule;
  const tables = store.tables;
  if (tables[item.target]) {
    const target = item.target;
    if (target === 'profiles') return { table: 'profiles', local: item.hint && item.hint !== 'profiles' ? item.hint : 'user_id', foreign: 'id', many: false };
    const forward = `${singular(target)}_id`;
    const sample = (tables[table] || [])[0] || {};
    if (forward in sample) return { table: target, local: forward, foreign: 'id', many: false };
    return { table: target, local: 'id', foreign: `${singular(table)}_id`, many: true };
  }
  // `alias:fk_column(cols)`: the column names the foreign key; profiles is by far the most common target.
  if (item.target.endsWith('_id')) return { table: 'profiles', local: item.target, foreign: 'id', many: false };
  return null;
}
function project(store, table, rows, selectText, embeds, log) {
  const items = parseSelect(selectText);
  if (!items.some(item => item.kind !== 'column')) return rows;
  return rows.map(row => {
    const out = { ...row };
    for (const item of items) {
      if (item.kind === 'alias') out[item.alias] = getPath(row, item.column) ?? null;
      if (item.kind !== 'embed') continue;
      const rule = resolveEmbed(store, table, item, embeds);
      if (!rule) { log?.({ kind: 'embed-unknown', table, embed: item.alias }); out[item.alias] = null; continue; }
      const related = (store.tables[rule.table] || []).filter(other => other[rule.foreign] != null && String(other[rule.foreign]) === String(row[rule.local]));
      const projected = project(store, rule.table, related, item.select, embeds, log);
      out[item.alias] = rule.many ? projected : projected[0] ?? null;
    }
    return out;
  });
}

const now = () => new Date().toISOString();
function withDefaults(row) {
  return { id: randomUUID(), created_at: now(), updated_at: now(), ...row };
}

/**
 * One REST request against the store. Returns `{ status, body, headers }` the HTTP layer sends as is.
 * `prefer` and `accept` are the request headers; `range` the optional Range header.
 */
export function handleRest({ store, method, table, search, body, prefer = '', accept = '', range = '', embeds = {}, onLog }) {
  const log = entry => { store.log.push(entry); onLog?.(entry); };
  const known = table in store.tables;
  if (!known) log({ kind: 'table-unfixtured', table, method });
  const rows = store.tables[table] || [];
  const filters = parseFilters(search);
  const wantsObject = accept.includes('vnd.pgrst.object');
  const representation = prefer.includes('return=representation');
  const countMode = /count=(exact|planned|estimated)/.test(prefer);
  const contentRange = (offset, length, total) => (length ? `${offset}-${offset + length - 1}/${countMode ? total : '*'}` : `*/${countMode ? total : '*'}`);
  const objectResponse = list => {
    if (list.length === 1) return { status: 200, body: list[0] };
    return { status: 406, body: { code: 'PGRST116', details: `The result contains ${list.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' } };
  };

  if (method === 'GET' || method === 'HEAD') {
    let list = sortRows(rows.filter(row => matches(row, filters)), parseOrder(search.get('order')));
    const total = list.length;
    let offset = Number(search.get('offset') || 0);
    let limit = search.has('limit') ? Number(search.get('limit')) : null;
    const rangeMatch = range.match(/^(\d+)-(\d+)?$/);
    if (rangeMatch) { offset = Number(rangeMatch[1]); if (rangeMatch[2]) limit = Number(rangeMatch[2]) - offset + 1; }
    list = list.slice(offset, limit === null ? undefined : offset + limit);
    const projected = project(store, table, list, search.get('select') || '*', embeds, log);
    const headers = { 'content-range': contentRange(offset, projected.length, total) };
    if (method === 'HEAD') return { status: 200, body: undefined, headers };
    if (wantsObject) return { ...objectResponse(projected), headers };
    return { status: 200, body: projected, headers };
  }

  if (method === 'POST') {
    const incoming = (Array.isArray(body) ? body : [body]).filter(Boolean);
    if (!store.tables[table]) store.tables[table] = [];
    const target = store.tables[table];
    const conflict = (search.get('on_conflict') || 'id').split(',');
    const upsert = prefer.includes('resolution=merge-duplicates');
    const ignore = prefer.includes('resolution=ignore-duplicates');
    const written = [];
    for (const raw of incoming) {
      const existing = (upsert || ignore) ? target.find(row => conflict.every(column => raw[column] !== undefined && String(row[column]) === String(raw[column]))) : null;
      if (existing && ignore) continue;
      if (existing) { Object.assign(existing, raw, { updated_at: now() }); written.push(existing); continue; }
      const row = withDefaults(raw);
      target.push(row);
      written.push(row);
    }
    log({ kind: 'write', method, table, rows: written.length });
    if (!representation) return { status: 201, body: undefined };
    const projected = project(store, table, written, search.get('select') || '*', embeds, log);
    return wantsObject ? objectResponse(projected) : { status: 201, body: projected };
  }

  if (method === 'PATCH') {
    const changed = rows.filter(row => matches(row, filters));
    for (const row of changed) Object.assign(row, body || {});
    log({ kind: 'write', method, table, rows: changed.length });
    if (!representation) return { status: 204, body: undefined };
    const projected = project(store, table, changed, search.get('select') || '*', embeds, log);
    return wantsObject ? objectResponse(projected) : { status: 200, body: projected };
  }

  if (method === 'DELETE') {
    const removed = rows.filter(row => matches(row, filters));
    if (store.tables[table]) store.tables[table] = rows.filter(row => !removed.includes(row));
    log({ kind: 'write', method, table, rows: removed.length });
    if (!representation) return { status: 204, body: undefined };
    return wantsObject ? objectResponse(removed) : { status: 200, body: removed };
  }

  return { status: 405, body: { message: `Method ${method} not supported by the audit stand-in` } };
}
