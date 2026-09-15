import { z } from 'zod';

const cell = z.union([z.string(), z.number(), z.null()]).optional();
const rowSchema = z.object({ id: z.string().uuid(), name: cell, title: cell, company: cell, email: cell, status: cell, industry: cell, location: cell }).strip();
const resultSchema = z.object({ items: z.array(rowSchema).max(20), scope: z.literal('own_saved_contacts') });
const columns = ['id', 'name', 'title', 'company', 'email', 'status', 'industry', 'location'] as const;

function csvCell(value: unknown) {
  const text = String(value ?? '');
  // Quote CSV grammar and neutralize spreadsheet formulas/control prefixes.
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Export only observed records, never model-authored tables. */
export function buildCoworkLeadCsv(observations: unknown[]) {
  const rows = new Map<string, z.infer<typeof rowSchema>>();
  for (const observation of observations) {
    if (!observation || typeof observation !== 'object') continue;
    const payload = observation as Record<string, unknown>;
    if (payload.action !== 'leads.search' && payload.action !== 'leads.get') continue;
    const parsed = resultSchema.safeParse(payload.result);
    if (!parsed.success) continue;
    for (const row of parsed.data.items) rows.set(row.id, row);
  }
  if (!rows.size) return null;
  return '\uFEFF' + [columns.map(csvCell).join(','), ...[...rows.values()].map(row => columns.map(column => csvCell(row[column])).join(','))].join('\r\n');
}
