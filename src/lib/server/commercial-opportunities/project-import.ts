import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { matchProject, parseSeiaRows, type ProjectProfile } from '@/lib/commercial-opportunities/projects';
import { projectOpportunityRow, projectSignalRow, type ProjectOpportunityRow, type ProjectSignalRow } from '@/lib/commercial-opportunities/records';
import { HiringSyncError, type HiringStore } from './sync';

/**
 * The SEIA export uploaded by the person (plan 8, phase 3, PR-3e): read in memory (never stored), matched against the
 * profile and saved as «project» opportunities with their evidence. One upload is one run with source «seia».
 */
export const PROJECT_FILE_LIMITS = { bytes: 10 * 1024 * 1024, rows: 60_000 } as const;
export type ProjectStore = Pick<HiringStore, 'finishRun'> & {
  startRun(input: { source: 'seia'; status: 'running' }): Promise<string>;
  existingKeys(keys: string[]): Promise<Set<string>>;
  saveOpportunities(rows: ProjectOpportunityRow[]): Promise<Map<string, string>>;
  saveSignals(rows: ProjectSignalRow[]): Promise<void>;
};

/** CSV (any delimiter, with or without BOM) or Excel .xlsx to rows keyed by their header. The old .xls is not opened. */
export function readProjectFile(file: { name: string; bytes: Uint8Array }): Array<Record<string, unknown>> {
  if (file.bytes.byteLength > PROJECT_FILE_LIMITS.bytes) throw new HiringSyncError('El archivo pasa de 10 MB: exporta solo las regiones o los sectores que te interesan.', 413);
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'csv' || extension === 'txt') {
    const content = new TextDecoder('utf-8').decode(file.bytes).replace(/^﻿/, '');
    const parsed = Papa.parse<Record<string, unknown>>(content, { header: true, skipEmptyLines: true, delimiter: '', preview: PROJECT_FILE_LIMITS.rows });
    return parsed.data;
  }
  if (extension === 'xlsx') {
    try {
      const book = XLSX.read(file.bytes, { type: 'array', sheetRows: PROJECT_FILE_LIMITS.rows + 1, cellDates: false });
      const sheet = book.Sheets[book.SheetNames[0]];
      return sheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: '' }) : [];
    } catch {
      throw new HiringSyncError('No se pudo abrir el Excel: puede estar dañado o protegido. Exporta el mapa del SEIA en CSV.', 400);
    }
  }
  throw new HiringSyncError('Sube el archivo del mapa del SEIA en CSV (o Excel .xlsx).', 415);
}

export async function importSeiaFile(input: {
  store: ProjectStore; profile: ProjectProfile & { id: string }; organizationId: string; file: { name: string; bytes: Uint8Array }; now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  const rows = readProjectFile(input.file);
  const { projects, skipped, missingColumns } = parseSeiaRows(rows);
  if (missingColumns.length) throw new HiringSyncError(`El archivo no trae la columna «${missingColumns[0]}». Exporta desde el mapa de proyectos del SEIA, sin cambiar las columnas.`, 400);
  if (!projects.length) throw new HiringSyncError('El archivo no trae proyectos.', 400);
  const runId = await input.store.startRun({ source: 'seia', status: 'running' });
  try {
    const matched = projects.flatMap(project => {
      const match = matchProject(project, input.profile, now);
      return match ? [{ project, row: projectOpportunityRow(project, match, { organizationId: input.organizationId, profileId: input.profile.id }, now) }] : [];
    });
    // An id repeated in the file is one project: the last row wins.
    const unique = [...new Map(matched.map(item => [item.row.dedupe_key, item])).values()];
    const existing = unique.length ? await input.store.existingKeys(unique.map(item => item.row.dedupe_key)) : new Set<string>();
    const ids = unique.length ? await input.store.saveOpportunities(unique.map(item => item.row)) : new Map<string, string>();
    const signals = unique.flatMap(item => {
      const opportunityId = ids.get(item.row.dedupe_key);
      return opportunityId ? [projectSignalRow(item.project, { organizationId: input.organizationId, opportunityId }, now)] : [];
    });
    if (signals.length) await input.store.saveSignals(signals);
    const created = unique.filter(item => !existing.has(item.row.dedupe_key)).length;
    await input.store.finishRun(runId, { status: 'succeeded', fetched: projects.length, created, updated: unique.length - created, costUsd: 0, error: null,
      finishedAt: new Date().toISOString() });
    return { status: 'done' as const, read: projects.length, skipped, matched: unique.length, created };
  } catch (error) {
    await input.store.finishRun(runId, { status: 'failed', fetched: projects.length, created: 0, updated: 0, costUsd: 0,
      error: `No se pudo guardar: ${error instanceof Error ? error.message : 'error'}`.slice(0, 300), finishedAt: new Date().toISOString() }).catch(() => undefined);
    throw error;
  }
}
