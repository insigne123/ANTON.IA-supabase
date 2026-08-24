// LEGACY: usado solo si USE_APIFY="true"
import { getBrowserStorage } from './browser-storage';

const KEY = 'leadflow-search-runs';

export type SavedRun = {
  runId: string;
  datasetId: string;
  startedAt: string;      // ISO
  params?: Record<string, unknown>;
  lastStatus?: string;    // RUNNING | SUCCEEDED | FAILED | ABORTED | ...
};

function load(): SavedRun[] {
  const storage = getBrowserStorage();
  if (!storage) return [];
  try { return JSON.parse(storage.getItem(KEY) || '[]'); } catch { return []; }
}
function save(all: SavedRun[]) {
  const storage = getBrowserStorage();
  if (!storage) return;
  storage.setItem(KEY, JSON.stringify(all));
  // disparar evento para otras pestañas
  try { window.dispatchEvent(new StorageEvent('storage', { key: KEY } as any)); } catch {}
}

export function addRun(run: SavedRun) {
  const all = load().filter(r => r.runId !== run.runId); // idempotente
  all.unshift(run);
  save(all);
  return run;
}

export function updateRun(runId: string, patch: Partial<SavedRun>) {
  const all = load();
  const i = all.findIndex(r => r.runId === runId);
  if (i >= 0) { all[i] = { ...all[i], ...patch }; save(all); }
}

export function removeRun(runId: string) {
  const all = load().filter(r => r.runId !== runId);
  save(all);
}

export function getRuns(): SavedRun[] {
  return load();
}

export function getLastPending(): SavedRun | null {
  const all = load();
  const pending = all.find(r => !['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(r.lastStatus || ''));
  return pending || null;
}
