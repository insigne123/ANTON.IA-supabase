// Builds the audit datasets from the domain files in this folder. Each file default-exports `(ctx) => ({ tables, rpc?,
// embeds?, storage? })` and may export `keepInEmpty`, the tables an empty organization still has (itself, its members, profiles).
// `full` merges every domain; `empty` keeps only those tables, so each page shows its empty state.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeContext } from './ids.mjs';
import { personas as buildPersonas } from './people.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKIP = new Set(['index.mjs', 'ids.mjs']);

/** The ids of the screen guides (src/lib/onboarding/product-tour.ts), read from the code so new guides are covered. */
function pageGuideIds() {
  const source = readFileSync(path.join(HERE, '../../../src/lib/onboarding/product-tour.ts'), 'utf8');
  const section = source.slice(source.indexOf('export const PAGE_GUIDES'));
  return [...section.slice(0, section.indexOf('\n];')).matchAll(/^\s*\{ id: '([\w-]+)', title:/gm)].map(match => match[1]);
}

export async function buildDatasets({ ownerEmail, now = Date.now() }) {
  const ctx = makeContext({ ownerEmail, now, pageGuideIds: pageGuideIds() });
  const full = { tables: {}, rpc: {}, embeds: {}, storage: {} };
  const keep = new Set();
  const files = readdirSync(HERE).filter(file => file.endsWith('.mjs') && !SKIP.has(file)).sort();
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(HERE, file)).href);
    const part = mod.default(ctx);
    for (const [table, rows] of Object.entries(part.tables || {})) {
      if (full.tables[table]) throw new Error(`La tabla ${table} se define en dos archivos de datos (${file}).`);
      full.tables[table] = rows;
    }
    Object.assign(full.rpc, part.rpc || {});
    Object.assign(full.storage, part.storage || {});
    for (const [table, rules] of Object.entries(part.embeds || {})) full.embeds[table] = { ...(full.embeds[table] || {}), ...rules };
    for (const table of mod.keepInEmpty || []) keep.add(table);
  }
  const empty = { tables: Object.fromEntries([...keep].map(table => [table, full.tables[table] || []])), rpc: full.rpc, embeds: full.embeds, storage: {} };
  return { ctx, datasets: { full, empty }, personas: buildPersonas(ctx) };
}
