// Copies a year's Plan Anual de Compras from ChileCompra to Storage, as CSV parts under 15 MB, for «Demanda futura»:
// ChileCompra's CloudFront blocks the Google Cloud networks where the app runs, so the server reads this copy instead
// (src/lib/server/commercial-opportunities/purchase-plan.ts). Run it from a network ChileCompra lets through, once the
// year's plan is out and then every month or so (bodies change their plans along the year).
//
// Usage: node scripts/mirror-purchase-plan.mjs <year> [--zip path/to/pacorganismos_<year>.zip] [--dry-run]
// Reads SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY from the environment; never prints them.
import fs from 'node:fs';
import JSZip from 'jszip';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'opportunity-documents';
const PART_BYTES = 14 * 1024 * 1024;
const args = process.argv.slice(2);
const year = Number(args[0]);
const zipPath = args.includes('--zip') ? args[args.indexOf('--zip') + 1] : null;
const dryRun = args.includes('--dry-run');
if (!Number.isInteger(year) || year < 2015 || year > 2100) { console.error('Uso: node scripts/mirror-purchase-plan.mjs <año> [--zip archivo.zip] [--dry-run]'); process.exit(1); }

const bytes = zipPath ? fs.readFileSync(zipPath) : await (async () => {
  const response = await fetch(`https://pac-files.da.mercadopublico.cl/${year}/pacorganismos_${year}.zip`);
  if (!response.ok) throw new Error(`ChileCompra respondió ${response.status} (${response.headers.get('server') || 's/servidor'}). Prueba desde otra red o con --zip.`);
  return Buffer.from(await response.arrayBuffer());
})();
const zip = await JSZip.loadAsync(bytes);
const file = Object.values(zip.files).find(entry => !entry.dir && /\.csv$/i.test(entry.name));
if (!file) throw new Error('El ZIP no trae un CSV.');
const text = Buffer.from(await file.async('uint8array'));
if (!/institucion_nombre;rut_institucion;codigo_producto;descripcion_producto/.test(text.subarray(0, 400).toString('utf8'))) throw new Error('El CSV no tiene el encabezado esperado.');

// Parts cut at a line break; the server reads them in order as one stream, so a line never needs to fit in one part.
const parts = [];
for (let start = 0; start < text.length;) {
  let end = Math.min(start + PART_BYTES, text.length);
  if (end < text.length) { const nl = text.lastIndexOf(0x0a, end); if (nl > start) end = nl + 1; }
  parts.push(text.subarray(start, end)); start = end;
}
const folder = `public-data/purchase-plan/${year}`;
console.log(JSON.stringify({ year, csvMB: +(text.length / 1048576).toFixed(1), parts: parts.map(part => +(part.length / 1048576).toFixed(1)), folder, dryRun }));
if (dryRun) process.exit(0);

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.');
const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET);
for (const [index, part] of parts.entries()) {
  const name = `${folder}/part-${String(index + 1).padStart(3, '0')}.csv`;
  const { error } = await bucket.upload(name, part, { contentType: 'text/csv', upsert: true });
  if (error) throw new Error(`No se pudo subir ${name}: ${error.message}`);
  console.log(`subida ${name}`);
}
// Parts left from a longer copy would be read after the new ones.
const { data: listed } = await bucket.list(folder, { limit: 100 });
const stale = (listed || []).map(entry => entry.name).filter(name => /^part-\d{3}\.csv$/.test(name) && Number(name.slice(5, 8)) > parts.length);
if (stale.length) { await bucket.remove(stale.map(name => `${folder}/${name}`)); console.log(`borradas ${stale.length} partes antiguas`); }
console.log('listo');
