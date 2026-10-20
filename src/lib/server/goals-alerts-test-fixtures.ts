/**
 * The tables in memory, with the query methods «Metas semanales» and «Avisos» use (server/weekly-goals.ts and
 * server/daily-alerts.ts). A table listed in `missing` answers as not created yet; `unique` names the columns of a
 * table's unique key, so a second insert answers 23505 as Postgres does. An update followed by `select` answers the rows
 * it changed, as PostgREST does.
 */
export function memory(seed: Record<string, any[]>, options: { missing?: string[]; unique?: Record<string, string[]> } = {}) {
  const tables: Record<string, any[]> = { weekly_goals: [], daily_alerts: [], ...seed };
  const calls: Array<{ table: string; kind: string; values?: any }> = [];
  let serial = 0;
  const value = (row: any, key: string) => key.split('->').reduce((current, part) => current?.[part.replace(/^>/, '')], row);
  const from = (name: string) => {
    const filters: Array<(row: any) => boolean> = [];
    let action: { kind: string; values?: any; conflict?: string[] } = { kind: 'select' };
    let one: 'single' | 'maybe' | null = null; let limit = Infinity; let range: [number, number] | null = null; let returning = false;
    const run = () => {
      if (options.missing?.includes(name)) return { data: null, error: { code: '42P01', message: 'missing' } };
      const rows = tables[name] ||= [];
      if (action.kind !== 'select') calls.push({ table: name, kind: action.kind, values: action.values });
      if (action.kind === 'insert' || action.kind === 'upsert') {
        const values = (Array.isArray(action.values) ? action.values : [action.values]).map((item: any) => ({ id: `${name}-${++serial}`, created_at: new Date().toISOString(), ...item }));
        const written: any[] = [];
        for (const item of values) {
          const keys = action.conflict || options.unique?.[name];
          const clash = keys && rows.find(row => keys.every(key => (row[key] ?? null) === (item[key] ?? null)));
          if (clash && action.kind === 'insert') return { data: null, error: { code: '23505', message: 'duplicate' } };
          if (clash) { Object.assign(clash, item, { id: clash.id }); written.push(clash); continue; }
          rows.push(item); written.push(item);
        }
        return { data: one ? written[0] ?? null : written, error: null };
      }
      const found = rows.filter(row => filters.every(filter => filter(row)));
      if (action.kind === 'update') { found.forEach(row => Object.assign(row, action.values)); return { data: returning ? found : null, error: null }; }
      if (action.kind === 'delete') { tables[name] = rows.filter(row => !found.includes(row)); return { data: null, error: null }; }
      const page = range ? found.slice(range[0], range[1] + 1) : found.slice(0, limit);
      if (one === 'single') return page.length ? { data: page[0], error: null } : { data: null, error: { code: 'PGRST116' } };
      if (one === 'maybe') return { data: page[0] ?? null, error: null };
      return { data: page, error: null };
    };
    const time = (at: unknown) => Date.parse(String(at));
    const chain: any = {
      select: () => { if (action.kind === 'update') returning = true; return chain; },
      insert: (values: any) => { action = { kind: 'insert', values }; return chain; },
      upsert: (values: any, upsertOptions: any) => { action = { kind: 'upsert', values, conflict: upsertOptions?.onConflict?.split(',') }; return chain; },
      update: (values: any) => { action = { kind: 'update', values }; return chain; },
      delete: () => { action = { kind: 'delete' }; return chain; },
      eq: (key: string, expected: any) => { filters.push(row => String(value(row, key)) === String(expected)); return chain; },
      neq: (key: string, expected: any) => { filters.push(row => String(value(row, key)) !== String(expected)); return chain; },
      in: (key: string, values: any[]) => { filters.push(row => values.includes(value(row, key))); return chain; },
      gte: (key: string, bound: any) => { filters.push(row => value(row, key) != null && time(value(row, key)) >= time(bound)); return chain; },
      lt: (key: string, bound: any) => { filters.push(row => value(row, key) != null && time(value(row, key)) < time(bound)); return chain; },
      not: (key: string, operator = 'is', expected: any = null) => {
        if (operator === 'in') {
          const list = String(expected).replace(/^\(|\)$/g, '').split(',').filter(Boolean);
          filters.push(row => !list.includes(String(value(row, key))));
        } else filters.push(row => value(row, key) != null);
        return chain;
      },
      order: () => chain,
      limit: (n: number) => { limit = n; return chain; },
      range: (fromIndex: number, toIndex: number) => { range = [fromIndex, toIndex]; return chain; },
      single: () => { one = 'single'; return chain; },
      maybeSingle: () => { one = 'maybe'; return chain; },
      then: (resolve: any, reject: any) => Promise.resolve().then(run).then(resolve, reject),
    };
    return chain;
  };
  return { tables, calls, client: { from } as any };
}
