import type { UnifiedRow } from '@/lib/unified-sheet-types';

// «Tabla de datos» reads a person from up to three places: saved, with their email found, and written to. Listed one row per
// record, someone already in conversation also appeared as a contact to write to, with «Preparar correo» beside their name
// (review of 10 Nov 2026, V6). One row per person: the furthest along, with what was noted on the others.

/** How far along a record is: a conversation beats a contact with email, which beats a saved one. */
const RANK: Record<UnifiedRow['kind'], number> = { contacted: 3, lead_enriched: 2, opportunity: 1, lead_saved: 0 };

/** What a person fills in by hand on a row; a blank on the row that stays takes it from the rows it replaces. */
const NOTED = ['stage', 'owner', 'notes', 'nextAction', 'nextActionType', 'nextActionDueAt', 'meetingLink'] as const;

const personKey = (row: UnifiedRow) => String(row.email || '').trim().toLowerCase();

/**
 * For each email address, only the rows of the kind furthest along; rows without an address stay as they are, and so do two
 * conversations with the same person (each is its own thread). Order is kept.
 */
export function onePerPerson(rows: UnifiedRow[]): UnifiedRow[] {
  const top = new Map<string, number>();
  for (const row of rows) {
    const key = personKey(row);
    if (key) top.set(key, Math.max(top.get(key) ?? -1, RANK[row.kind]));
  }
  // What was noted on a row that goes, for the first row that stays.
  const noted = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = personKey(row);
    if (!key || RANK[row.kind] === top.get(key)) continue;
    const kept = noted.get(key) ?? {};
    for (const field of NOTED) if (kept[field] == null || kept[field] === '') kept[field] = (row as any)[field];
    noted.set(key, kept);
  }
  return rows.flatMap(row => {
    const key = personKey(row);
    if (!key) return [row];
    if (RANK[row.kind] !== top.get(key)) return [];
    const extra = noted.get(key);
    if (!extra) return [row];
    noted.delete(key);
    const merged: any = { ...row };
    for (const field of NOTED) if ((merged[field] == null || merged[field] === '') && extra[field] != null && extra[field] !== '') merged[field] = extra[field];
    return [merged as UnifiedRow];
  });
}
