// How «Tabla de datos» sorts (Plan 9, PR-15). Before, any column whose key contained «at» sorted as a date, and «status»
// contains it: sorting by state compared NaN and left the rows in a random order.
import type { ColumnKey, UnifiedRow, UnifiedStatus } from './unified-sheet-types';

const DATE_KEYS = new Set<ColumnKey>(['createdAt', 'updatedAt', 'nextActionDueAt']);

/** The order a contact moves through, so «Estado» sorts by progress and not by its label. */
export const STATUS_ORDER: Record<UnifiedStatus, number> = { saved: 0, enriched: 1, sent: 2, read: 3, opened: 3, clicked: 4, replied: 5, archived: 6 };

const timeOf = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const time = new Date(value as string | number).getTime();
  return Number.isFinite(time) ? time : null;
};

const isEmpty = (value: unknown) => value === null || value === undefined || String(value).trim() === '';

/** Rows compared by one column; empty values always go last, whatever the direction. */
export function compareSheetRows(a: UnifiedRow, b: UnifiedRow, key: ColumnKey, direction: 'asc' | 'desc') {
  const multiplier = direction === 'asc' ? 1 : -1;
  if (key === 'status') return ((STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)) * multiplier;
  const aValue = a[key as keyof UnifiedRow];
  const bValue = b[key as keyof UnifiedRow];
  if (DATE_KEYS.has(key)) {
    const aTime = timeOf(aValue);
    const bTime = timeOf(bValue);
    if (aTime === null && bTime === null) return 0;
    if (aTime === null) return 1;
    if (bTime === null) return -1;
    return (aTime - bTime) * multiplier;
  }
  if (isEmpty(aValue) && isEmpty(bValue)) return 0;
  if (isEmpty(aValue)) return 1;
  if (isEmpty(bValue)) return -1;
  return String(aValue).localeCompare(String(bValue), 'es', { numeric: true, sensitivity: 'base' }) * multiplier;
}
