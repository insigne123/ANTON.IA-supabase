// src/lib/unified-sheet-storage.ts
import type { ColumnDef, ColumnKey, UnifiedRow } from './unified-sheet-types';
import { getBrowserStorage } from './browser-storage';

const SCHEMA_KEY = 'leadflow-sheet-columns-v1';
const CUSTOM_DATA_KEY = 'leadflow-sheet-custom-v1';
const COLUMNS_VERSION_KEY = 'unified_sheet_columns_v';
const CURRENT_COLUMNS_VERSION = 4;


export function defaultColumns(): ColumnDef[] {
  const cols: ColumnDef[] = [
    { key: 'name', label: 'Nombre', visible: true, width: 240, editable: false },
    { key: 'email', label: 'Email', visible: true, width: 240, editable: false }, // <-- NUEVA por defecto
    { key: 'company', label: 'Empresa', visible: true, width: 220, editable: false },
    { key: 'title', label: 'Cargo', visible: true, width: 220, editable: false },
    { key: 'industry', label: 'Industria', visible: true, width: 180, editable: false },
    { key: 'createdAt', label: 'Captación', visible: true, width: 160, editable: false },
    { key: 'status', label: 'Estado', visible: true, width: 140, editable: false },
    { key: 'stage', label: 'Etapa', visible: false, width: 160, editable: true },
    { key: 'owner', label: 'Responsable', visible: false, width: 160, editable: true },
    { key: 'notes', label: 'Notas', visible: false, width: 320, editable: true },
    { key: 'kind', label: 'Tipo', visible: false, width: 110 },
    { key: 'source', label: 'Fuente', visible: false, width: 120 },
    { key: 'updatedAt', label: 'Última act.', visible: false, width: 160 },
    { key: 'linkedinUrl', label: 'LinkedIn', visible: false, width: 160 },
    { key: 'nextAction', label: 'Próximo paso', visible: false, width: 220, editable: true },
    { key: 'nextActionType', label: 'Tipo de paso', visible: false, width: 150, editable: true },
    { key: 'nextActionDueAt', label: 'Próxima fecha', visible: false, width: 170, editable: true },
    { key: 'autopilotStatus', label: 'Autopilot', visible: false, width: 160, editable: true },
    { key: 'lastAutopilotEvent', label: 'Último evento', visible: false, width: 220, editable: true },
    { key: 'meetingLink', label: 'Link reunión', visible: false, width: 220, editable: true },
  ];
  return cols;
}

export function saveColumns(cols: ColumnDef[]) {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storage.setItem(SCHEMA_KEY, JSON.stringify(cols));
    storage.setItem(COLUMNS_VERSION_KEY, String(CURRENT_COLUMNS_VERSION));
  } catch (e) {
    console.error('[sheet] saveColumns error', e);
  }
}

export function loadColumns(): ColumnDef[] {
  const storage = getBrowserStorage();
  if (!storage) return [...defaultColumns()];
  try {
    const raw = storage.getItem(SCHEMA_KEY);
    const version = Number(storage.getItem(COLUMNS_VERSION_KEY) || '0');
    let cols: ColumnDef[] = raw ? (JSON.parse(raw) as ColumnDef[]) : [...defaultColumns()];

    // Migraciones de columnas visibles
  const hasEmail = cols.some((c) => c.key === 'email');
  const ensureColumn = (column: ColumnDef, afterKey?: ColumnKey) => {
      if (cols.some((c) => c.key === column.key)) return;
      const afterIdx = afterKey ? cols.findIndex((c) => c.key === afterKey) : -1;
      if (afterIdx >= 0) cols.splice(afterIdx + 1, 0, column);
      else cols.push(column);
    };
    if (!hasEmail) {
      const emailCol: ColumnDef = { key: 'email', label: 'Email', visible: true, width: 240, editable: false };
      const nameIdx = cols.findIndex((c) => c.key === 'name');
      if (nameIdx >= 0) cols.splice(nameIdx + 1, 0, emailCol);
      else cols.unshift(emailCol);
    }

    ensureColumn({ key: 'industry', label: 'Industria', visible: true, width: 180, editable: false }, 'title');
    ensureColumn({ key: 'createdAt', label: 'Captación', visible: true, width: 160, editable: false }, 'industry');
    ensureColumn({ key: 'source', label: 'Fuente', visible: false, width: 120 }, 'kind');
    ensureColumn({ key: 'nextAction', label: 'Próximo paso', visible: false, width: 220, editable: true }, 'notes');
    ensureColumn({ key: 'nextActionType', label: 'Tipo de paso', visible: false, width: 150, editable: true }, 'nextAction');
    ensureColumn({ key: 'nextActionDueAt', label: 'Próxima fecha', visible: false, width: 170, editable: true }, 'nextActionType');
    ensureColumn({ key: 'autopilotStatus', label: 'Autopilot', visible: false, width: 160, editable: true }, 'nextActionDueAt');
    ensureColumn({ key: 'lastAutopilotEvent', label: 'Último evento', visible: false, width: 220, editable: true }, 'autopilotStatus');
    ensureColumn({ key: 'meetingLink', label: 'Link reunión', visible: false, width: 220, editable: true }, 'lastAutopilotEvent');

    if (version < 4) {
      cols = cols.map((column) => {
        if (column.key === 'stage') return { ...column, label: 'Etapa', visible: false };
        if (column.key === 'owner') return { ...column, label: 'Responsable', visible: false };
        if (column.key === 'notes') return { ...column, visible: false };
        return column;
      });
    }

    cols = cols.filter((column, index, arr) => arr.findIndex((item) => item.key === column.key) === index);

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

export type CustomData = Partial<Pick<
  UnifiedRow,
  | 'stage'
  | 'owner'
  | 'notes'
  | 'nextAction'
  | 'nextActionType'
  | 'nextActionDueAt'
  | 'autopilotStatus'
  | 'lastAutopilotEvent'
  | 'meetingLink'
>>;


export function getCustom(gid: string): CustomData | undefined {
  const storage = getBrowserStorage();
  if (!storage) return undefined;
  try {
    const all = JSON.parse(storage.getItem(CUSTOM_DATA_KEY) || '{}');
    return all[gid];
  } catch { return undefined; }
}

export function setCustom(gid: string, patch: CustomData) {
  const storage = getBrowserStorage();
  if (!storage) return;
  const all = JSON.parse(storage.getItem(CUSTOM_DATA_KEY) || '{}');
  all[gid] = { ...(all[gid] || {}), ...patch };
  storage.setItem(CUSTOM_DATA_KEY, JSON.stringify(all));
}

export function bulkSetCustom(rows: UnifiedRow[]) {
  const storage = getBrowserStorage();
  if (!storage) return;
  const all = JSON.parse(storage.getItem(CUSTOM_DATA_KEY) || '{}');
  for (const r of rows) {
    const customData: CustomData = {};
    if (r.stage) customData.stage = r.stage;
    if (r.owner) customData.owner = r.owner;
    if (r.notes) customData.notes = r.notes;
    if (r.nextAction) customData.nextAction = r.nextAction;
    if (r.nextActionType) customData.nextActionType = r.nextActionType;
    if (r.nextActionDueAt) customData.nextActionDueAt = r.nextActionDueAt;
    if (r.autopilotStatus) customData.autopilotStatus = r.autopilotStatus;
    if (r.lastAutopilotEvent) customData.lastAutopilotEvent = r.lastAutopilotEvent;
    if (r.meetingLink) customData.meetingLink = r.meetingLink;
    if (Object.keys(customData).length > 0) all[r.gid] = { ...(all[r.gid] || {}), ...customData };
  }
  storage.setItem(CUSTOM_DATA_KEY, JSON.stringify(all));
}
