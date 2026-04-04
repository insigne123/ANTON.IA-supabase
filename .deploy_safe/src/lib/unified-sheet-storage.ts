// src/lib/unified-sheet-storage.ts
import type { ColumnDef, ColumnKey, UnifiedRow } from './unified-sheet-types';

const SCHEMA_KEY = 'leadflow-sheet-columns-v1';
const CUSTOM_DATA_KEY = 'leadflow-sheet-custom-v1';
const COLUMNS_VERSION_KEY = 'unified_sheet_columns_v';
const CURRENT_COLUMNS_VERSION = 2;


export function defaultColumns(): ColumnDef[] {
  const cols: ColumnDef[] = [
    { key: 'name', label: 'Nombre', visible: true, width: 240, editable: false },
    { key: 'email', label: 'Email', visible: true, width: 240, editable: false }, // <-- NUEVA por defecto
    { key: 'company', label: 'Empresa', visible: true, width: 220, editable: false },
    { key: 'title', label: 'Cargo', visible: true, width: 220, editable: false },
    { key: 'status', label: 'Estado', visible: true, width: 140, editable: false },
    { key: 'stage', label: 'Stage', visible: true, width: 160, editable: true },
    { key: 'owner', label: 'Owner', visible: true, width: 140, editable: true },
    { key: 'notes', label: 'Notas', visible: true, width: 320, editable: true },
    { key: 'kind', label: 'Tipo', visible: false, width: 110 },
    // { key: 'source', label: 'Fuente', visible: false, width: 110 },
    { key: 'createdAt', label: 'Creado', visible: false, width: 160 },
    // { key: 'sentAt', label: 'Enviado', visible: false, width: 160 },
    // { key: 'repliedAt', label: 'Respondido', visible: false, width: 160 },
    { key: 'updatedAt', label: 'Última act.', visible: false, width: 160 },
    { key: 'linkedinUrl', label: 'LinkedIn', visible: false, width: 160 },
  ];
  return cols;
}

export function saveColumns(cols: ColumnDef[]) {
  try {
    localStorage.setItem(SCHEMA_KEY, JSON.stringify(cols));
    localStorage.setItem(COLUMNS_VERSION_KEY, String(CURRENT_COLUMNS_VERSION));
  } catch (e) {
    console.error('[sheet] saveColumns error', e);
  }
}

export function loadColumns(): ColumnDef[] {
  try {
    const raw = localStorage.getItem(SCHEMA_KEY);
    const version = Number(localStorage.getItem(COLUMNS_VERSION_KEY) || '0');
    let cols: ColumnDef[] = raw ? (JSON.parse(raw) as ColumnDef[]) : [...defaultColumns()];

    // Migración: asegurar columna "email"
    const hasEmail = cols.some((c) => c.key === 'email');
    if (!hasEmail) {
      const emailCol: ColumnDef = { key: 'email', label: 'Email', visible: true, width: 240, editable: false };
      const nameIdx = cols.findIndex((c) => c.key === 'name');
      if (nameIdx >= 0) cols.splice(nameIdx + 1, 0, emailCol);
      else cols.unshift(emailCol);
    }

    if (version < CURRENT_COLUMNS_VERSION || !hasEmail) {
      // Persistimos migración para no rehacerla en cada carga
      saveColumns(cols);
    }

    return cols;
  } catch (e) {
    console.warn('[sheet] loadColumns fallo; uso DEFAULT_COLUMNS', e);
    saveColumns(defaultColumns());
    return [...defaultColumns()];
  }
}

export type CustomData = Partial<Pick<UnifiedRow, 'stage' | 'owner' | 'notes'>>;


export function getCustom(gid: string): CustomData | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const all = JSON.parse(localStorage.getItem(CUSTOM_DATA_KEY) || '{}');
    return all[gid];
  } catch { return undefined; }
}

export function setCustom(gid: string, patch: CustomData) {
  if (typeof window === 'undefined') return;
  const all = JSON.parse(localStorage.getItem(CUSTOM_DATA_KEY) || '{}');
  all[gid] = { ...(all[gid] || {}), ...patch };
  localStorage.setItem(CUSTOM_DATA_KEY, JSON.stringify(all));
}

export function bulkSetCustom(rows: UnifiedRow[]) {
  if (typeof window === 'undefined') return;
  const all = JSON.parse(localStorage.getItem(CUSTOM_DATA_KEY) || '{}');
  for (const r of rows) {
    const customData: CustomData = {};
    if (r.stage) customData.stage = r.stage;
    if (r.owner) customData.owner = r.owner;
    if (r.notes) customData.notes = r.notes;
    if (Object.keys(customData).length > 0) all[r.gid] = { ...(all[r.gid] || {}), ...customData };
  }
  localStorage.setItem(CUSTOM_DATA_KEY, JSON.stringify(all));
}
