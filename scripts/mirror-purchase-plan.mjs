// Copies a year's Plan Anual de Compras from ChileCompra to Storage, as CSV parts under 15 MB, for «Demanda futura»:
// ChileCompra's CloudFront blocks cloud networks (Google Cloud, where the app runs, and GitHub Actions' Azure), so the
// server reads this copy instead (src/lib/server/commercial-opportunities/purchase-plan.ts). A scheduled Claude Code task
// runs it each month from a network ChileCompra lets through (docs/oportunidades-oferta-y-demanda.md).
//
// No project dependencies, so it runs on a fresh checkout: curl downloads (through the network's proxy, if any), unzip
// reads the ZIP and Storage takes the parts over its REST API.
//
// Usage: node scripts/mirror-purchase-plan.mjs <year> [--zip path/to/pacorganismos_<year>.zip] [--dry-run]
// Reads SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY from the environment; never prints them.
// A year ChileCompra has not published yet ends with {"published":false} and changes nothing.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BUCKET = 'opportunity-documents';
const PART_BYTES = 14 * 1024 * 1024;
const args = process.argv.slice(2);
const year = Number(args[0]);
const dryRun = args.includes('--dry-run');
let zipPath = args.includes('--zip') ? args[args.indexOf('--zip') + 1] : null;
if (!Number.isInteger(year) || year < 2015 || year > 2100) { console.error('Uso: node scripts/mirror-purchase-plan.mjs <año> [--zip archivo.zip] [--dry-run]'); process.exit(1); }

if (!zipPath) {
  zipPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pac-')), `pacorganismos_${year}.zip`);
  const answer = execFileSync('curl', ['-sS', '-o', zipPath, '-w', '%{http_code} %header{server}', '--max-time', '300',
    `https://pac-files.da.mercadopublico.cl/${year}/pacorganismos_${year}.zip`]).toString().trim();
  const [status, ...server] = answer.split(' ');
  // S3 answers 403 «AccessDenied» for a file that does not exist; CloudFront's own 403 is a blocked network.
  if (status === '404' || (status === '403' && /AmazonS3/i.test(server.join(' ')))) { console.log(JSON.stringify({ year, published: false })); process.exit(0); }
  if (status !== '200') throw new Error(`ChileCompra respondió ${status} (${server.join(' ') || 's/servidor'}): esta red está bloqueada o el archivo cambió. Prueba desde otra red o con --zip.`);
}
const text = execFileSync('unzip', ['-p', zipPath, '*.csv'], { maxBuffer: 256 * 1024 * 1024 });
if (!/institucion_nombre;rut_institucion;codigo_producto;descripcion_producto/.test(text.subarray(0, 400).toString('utf8'))) throw new Error('El CSV no tiene el encabezado esperado.');

// Parts cut at a line break; the server reads them in order as one stream, so a line never needs to fit in one part.
const parts = [];
for (let start = 0; start < text.length;) {
  let end = Math.min(start + PART_BYTES, text.length);
  if (end < text.length) { const newline = text.lastIndexOf(0x0a, end); if (newline > start) end = newline + 1; }
  parts.push(text.subarray(start, end)); start = end;
}
const folder = `public-data/purchase-plan/${year}`;
console.log(JSON.stringify({ year, published: true, csvMB: +(text.length / 1048576).toFixed(1), parts: parts.map(part => +(part.length / 1048576).toFixed(1)), folder, dryRun }));
if (dryRun) process.exit(0);

const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.');
const storage = (route, init) => fetch(`${url}/storage/v1/${route}`, { ...init, headers: { Authorization: `Bearer ${key}`, apikey: key, ...init.headers } });
for (const [index, part] of parts.entries()) {
  const name = `${folder}/part-${String(index + 1).padStart(3, '0')}.csv`;
  const response = await storage(`object/${BUCKET}/${name}`, { method: 'POST', headers: { 'content-type': 'text/csv', 'x-upsert': 'true' }, body: part });
  if (!response.ok) throw new Error(`No se pudo subir ${name}: ${response.status} ${(await response.text()).slice(0, 200)}`);
  console.log(`subida ${name}`);
}
// Parts left from a longer copy would be read after the new ones.
const listed = await storage(`object/list/${BUCKET}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefix: folder, limit: 100 }) });
const names = listed.ok ? (await listed.json()).map(entry => entry.name) : [];
const stale = names.filter(name => /^part-\d{3}\.csv$/.test(name) && Number(name.slice(5, 8)) > parts.length);
if (stale.length) {
  const removed = await storage(`object/${BUCKET}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: stale.map(name => `${folder}/${name}`) }) });
  console.log(removed.ok ? `borradas ${stale.length} partes antiguas` : `no se pudieron borrar ${stale.length} partes antiguas: ${removed.status}`);
}
console.log('listo');
