import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import type { ProjectOpportunityRow, ProjectSignalRow } from '@/lib/commercial-opportunities/records';
import { importSeiaFile, readProjectFile, type ProjectStore } from './project-import';

const NOW = '2026-10-02T12:00:00Z';
const PROFILE = { id: 'p1', sectors: ['mineria'], regions: [], minInvestmentUsd: 10_000_000 };
const encoder = new TextEncoder();
const csv = '﻿ID_EXPEDIENTE;NOMBRE_PROYECTO;TITULAR;LETRA_TIPOLOGIA;REGION;ESTADO_EVALUACION;FECHA_PRESENTACION;INVERSION_US\n'
  + '1;Mina Uno;Minera Uno;i;Región de Antofagasta;En Calificación;01/09/2026;300\n'
  + '1;Mina Uno (repetida);Minera Uno;i;Región de Antofagasta;En Calificación;01/09/2026;300\n'
  + '2;Mina Dos;Minera Dos;i;Región de Atacama;Rechazado;01/09/2026;900\n'
  + '3;Parque eólico;Viento SpA;c;Región del Biobío;Aprobado;01/05/2026;200\n';

function memoryStore(existing: string[] = []) {
  const runs: Array<Record<string, unknown>> = [];
  const rows: ProjectOpportunityRow[] = [];
  const signals: ProjectSignalRow[] = [];
  const store: ProjectStore = {
    async startRun(input) { runs.push({ id: 'r1', ...input }); return 'r1'; },
    async finishRun(_id, patch) { Object.assign(runs[0], patch); },
    async existingKeys(keys) { return new Set(keys.filter(key => existing.includes(key))); },
    async saveOpportunities(list) { rows.push(...list); return new Map(list.map(row => [row.dedupe_key, `id-${row.dedupe_key}`])); },
    async saveSignals(list) { signals.push(...list); },
  };
  return { store, runs, rows, signals };
}

test('a CSV with semicolons and a BOM, and an .xlsx, are read the same; an old .xls or a huge file is not', () => {
  const fromCsv = readProjectFile({ name: 'seia.csv', bytes: encoder.encode(csv) });
  assert.equal(fromCsv.length, 4);
  assert.equal(fromCsv[0].NOMBRE_PROYECTO, 'Mina Uno');
  const sheet = XLSX.utils.json_to_sheet([{ NOMBRE_PROYECTO: 'Mina Uno', TITULAR: 'Minera Uno' }]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Proyectos');
  const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  assert.equal(readProjectFile({ name: 'seia.xlsx', bytes })[0].TITULAR, 'Minera Uno');
  assert.throws(() => readProjectFile({ name: 'seia.xls', bytes }), (error: Error & { status?: number }) => error.status === 415);
  assert.throws(() => readProjectFile({ name: 'seia.csv', bytes: new Uint8Array(10 * 1024 * 1024 + 1) }), (error: Error & { status?: number }) => error.status === 413);
});

test('an upload saves the projects that fit once each, with their evidence, as one run', async () => {
  const memory = memoryStore(['1']);
  const result = await importSeiaFile({ store: memory.store, profile: PROFILE, organizationId: 'org', file: { name: 'seia.csv', bytes: encoder.encode(csv) }, now: NOW });
  assert.deepEqual(result, { status: 'done', read: 4, skipped: 0, matched: 1, created: 0 });
  assert.deepEqual(memory.rows.map(row => [row.kind, row.dedupe_key, row.company_name, row.amount, row.currency]), [['project', '1', 'Minera Uno', 300_000_000, 'USD']]);
  assert.equal(memory.rows[0].title, 'Mina Uno (repetida)', 'the last row of a repeated id wins');
  assert.deepEqual(memory.signals.map(signal => [signal.source, signal.external_id, signal.opportunity_id]), [['seia', '1', 'id-1']]);
  assert.deepEqual([memory.runs[0].source, memory.runs[0].status, memory.runs[0].fetched, memory.runs[0].updated], ['seia', 'succeeded', 4, 1]);
});

test('a file without the project name, or without rows, is rejected before saving anything', async () => {
  const memory = memoryStore();
  await assert.rejects(importSeiaFile({ store: memory.store, profile: PROFILE, organizationId: 'org', file: { name: 'x.csv', bytes: encoder.encode('a;b\n1;2\n') }, now: NOW }),
    /no trae la columna «nombre del proyecto»/);
  assert.equal(memory.runs.length, 0);
});
