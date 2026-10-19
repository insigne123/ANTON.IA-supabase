#!/usr/bin/env node
// «Mercado público» (propuestas 9, 10 y 11): loads ChileCompra's monthly files of tenders and offers into the compact
// tables of 20261019120000_public_procurement.sql, and ages them (12 months with every bid, then winners, then long
// contracts, then out). Without project dependencies (curl, unzip and the Supabase REST API), so it runs in a fresh clone,
// like scripts/mirror-purchase-plan.mjs.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… node scripts/load-public-procurement.mjs
//     [--months=2026-9,2026-8]   only these months (with the scope the plan gives them)
//     [--zip-dir=dir]            read {año}-{mes}.zip from here instead of downloading
//     [--max-db-mb=420]          stop before the database passes this size (free plan: 500 MB)
//     [--dry-run]                read and count, write nothing
//
// By default it follows the plan: first re-scopes or deletes the months that aged, then loads the months never loaded and
// reloads the last 3 (their tenders change state).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aggregateMonth, monthPlan } from './public-procurement/aggregate.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => { const [key, ...rest] = arg.replace(/^--/, '').split('='); return [key, rest.length ? rest.join('=') : true]; }));
const DRY = Boolean(args['dry-run']);
const URL_BASE = 'https://transparenciachc.blob.core.windows.net/lic-da';
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const MAX_DB_BYTES = Number(args['max-db-mb'] || 420) * 1024 * 1024;
const log = (message) => process.stdout.write(`[mercado] ${message}\n`);

if (!DRY && (!SUPABASE_URL || !KEY)) { console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.'); process.exit(2); }

const headers = (extra = {}) => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...extra });
async function rest(method, pathAndQuery, body, extra = {}) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { method, headers: headers(extra), body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.ok) { const text = await response.text(); return text ? JSON.parse(text) : null; }
    const detail = (await response.text()).slice(0, 400);
    if (attempt >= 4 || ![408, 429, 500, 502, 503, 504].includes(response.status)) throw new Error(`${method} ${pathAndQuery.split('?')[0]} ${response.status}: ${detail}`);
    await new Promise(resolve => setTimeout(resolve, attempt * 2000));
  }
}
const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

async function databaseBytes() { return Number(await rest('POST', 'rpc/public_procurement_db_bytes', {})); }

/** The text of a month's CSV, streamed out of the zip in latin1. */
async function* monthText(file) {
  const unzip = spawn('unzip', ['-p', file], { stdio: ['ignore', 'pipe', 'inherit'] });
  const decoder = new TextDecoder('latin1');
  for await (const buffer of unzip.stdout) yield decoder.decode(buffer, { stream: true });
  yield decoder.decode();
  await new Promise((resolve, reject) => unzip.on('close', code => code === 0 ? resolve() : reject(new Error(`unzip ${code}`))));
}

async function download(year, month, dir) {
  const local = args['zip-dir'] ? path.join(String(args['zip-dir']), `${year}-${month}.zip`) : null;
  if (local && existsSync(local)) return { file: local, modified: null, downloaded: false };
  const file = path.join(dir, `${year}-${month}.zip`);
  const url = `${URL_BASE}/${year}-${month}.zip`;
  await new Promise((resolve, reject) => {
    const curl = spawn('curl', ['-sS', '-f', '--retry', '3', '-o', file, url], { stdio: ['ignore', 'inherit', 'inherit'] });
    curl.on('close', code => code === 0 ? resolve() : reject(new Error(`No se pudo descargar ${url} (curl ${code})`)));
  });
  const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
  return { file, modified: head?.headers.get('last-modified') || null, downloaded: true };
}

async function writeMonth(entry, data) {
  for (const batch of chunk(data.agencies, 500)) await rest('POST', 'public_procurement_agencies?on_conflict=id', batch.map(agency => ({ ...agency, updated_at: new Date().toISOString() })), { Prefer: 'resolution=merge-duplicates,return=minimal' });
  const supplierIds = new Map();
  for (const batch of chunk(data.suppliers, 1000)) {
    const rows = await rest('POST', 'public_procurement_suppliers?on_conflict=rut&select=id,rut', batch.map(supplier => ({ ...supplier, updated_at: new Date().toISOString() })),
      { Prefer: 'resolution=merge-duplicates,return=representation' });
    for (const row of rows || []) supplierIds.set(row.rut, row.id);
  }
  for (const batch of chunk(data.tenders, 1000)) await rest('POST', 'public_procurement_tenders?on_conflict=id', batch.map(tender => ({ ...tender, updated_at: new Date().toISOString() })), { Prefer: 'resolution=merge-duplicates,return=minimal' });
  const bids = data.bids.map(bid => ({ tender_id: bid.tenderId, supplier_id: supplierIds.get(bid.rut), offered_amount: bid.offered, awarded_amount: bid.awarded, selected: bid.selected }))
    .filter(bid => bid.tender_id && bid.supplier_id);
  for (const batch of chunk(bids, 2000)) await rest('POST', 'public_procurement_bids?on_conflict=tender_id,supplier_id', batch, { Prefer: 'resolution=merge-duplicates,return=minimal' });
  return bids.length;
}

/** Keeps less of a month that aged: from every bid to the winners, then to the long contracts. */
async function rescope(entry) {
  const month = `source_month=eq.${entry.sourceMonth}`;
  if (entry.scope === 'winners') {
    let offset = 0;
    for (;;) {
      const page = await rest('GET', `public_procurement_tenders?select=id&${month}&order=id&limit=1000&offset=${offset}`);
      if (!page?.length) break;
      for (const ids of chunk(page.map(row => row.id), 200)) await rest('DELETE', `public_procurement_bids?tender_id=in.(${ids.join(',')})&selected=is.false`, undefined, { Prefer: 'return=minimal' });
      if (page.length < 1000) break; offset += 1000;
    }
    await rest('DELETE', `public_procurement_tenders?${month}&status=neq.adjudicada`, undefined, { Prefer: 'return=minimal' });
    await rest('PATCH', `public_procurement_tenders?${month}`, { bids_scope: 'winners', criteria: null }, { Prefer: 'return=minimal' });
  } else if (entry.scope === 'long') {
    await rest('DELETE', `public_procurement_tenders?${month}&or=(duration_months.is.null,duration_months.lt.18)`, undefined, { Prefer: 'return=minimal' });
  }
  await rest('PATCH', `public_procurement_loads?${month}`, { scope: entry.scope, loaded_at: new Date().toISOString() }, { Prefer: 'return=minimal' });
}

async function main() {
  const plan = monthPlan(new Date());
  const wanted = typeof args.months === 'string' ? new Set(args.months.split(',').map(value => value.trim())) : null;
  const loads = DRY ? [] : await rest('GET', 'public_procurement_loads?select=source_month,scope');
  const loaded = new Map((loads || []).map(row => [row.source_month, row.scope]));
  // First what aged (less of it is kept) and what left the plan (out): Postgres reuses that space for the new months.
  if (!wanted) {
    for (const entry of plan) {
      const previous = loaded.get(entry.sourceMonth);
      if (!previous || entry.index <= 2 || previous === entry.scope) continue;
      log(`${entry.year}-${entry.month}: ${previous} → ${entry.scope}`);
      if (!DRY) await rescope(entry);
    }
    const oldest = plan.at(-1).sourceMonth;
    for (const [month] of loaded) if (month < oldest) {
      log(`${month}: fuera del plan, se borra`);
      if (DRY) continue;
      await rest('DELETE', `public_procurement_tenders?source_month=eq.${month}`, undefined, { Prefer: 'return=minimal' });
      await rest('DELETE', `public_procurement_loads?source_month=eq.${month}`, undefined, { Prefer: 'return=minimal' });
    }
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mercado-'));
  try {
    for (const entry of plan) {
      const label = `${entry.year}-${entry.month}`;
      if (wanted && !wanted.has(label)) continue;
      // Never loaded, one of the last three (their tenders change state), or asked for.
      if (!wanted && loaded.has(entry.sourceMonth) && entry.index > 2) continue;
      if (!DRY && await databaseBytes() > MAX_DB_BYTES) { log(`La base supera ${Math.round(MAX_DB_BYTES / 1048576)} MB: me detengo en ${label}.`); break; }
      const started = Date.now();
      const { file, modified, downloaded } = await download(entry.year, entry.month, dir);
      const aggregate = await aggregateMonth(entry.sourceMonth, monthText(file));
      const data = aggregate.forScope(entry.scope);
      let bids = data.bids.length;
      if (!DRY) {
        bids = await writeMonth(entry, data);
        await rest('POST', 'public_procurement_loads?on_conflict=source_month', [{ source_month: entry.sourceMonth, scope: entry.scope, tenders: data.tenders.length, bids, source_modified: modified, loaded_at: new Date().toISOString() }],
          { Prefer: 'resolution=merge-duplicates,return=minimal' });
      }
      log(`${label} (${entry.scope}): ${aggregate.rows} filas → ${data.tenders.length} licitaciones, ${bids} ofertas, ${data.suppliers.length} proveedores, ${Math.round((Date.now() - started) / 1000)} s`);
      // One file of about 15 MB at a time on disk.
      if (downloaded) rmSync(file, { force: true });
    }
    if (!DRY) log(`Base: ${Math.round(await databaseBytes() / 1048576)} MB`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

main().catch(error => { console.error(`[mercado] ${error.message}`); process.exit(1); });
