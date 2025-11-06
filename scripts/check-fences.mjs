// scripts/check-fences.mjs
// Bloquea backticks ``` en archivos de código (fuera de .md/.mdx)

import { readdirSync, statSync, readFileSync } from 'fs';
import { join, extname } from 'path';

const ROOT = process.cwd();
const START = join(ROOT, 'src');
const ALLOWED_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const offenders = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      walk(full);
    } else {
      const ext = extname(full).toLowerCase();
      if (!ALLOWED_EXTS.has(ext)) continue;
      const src = readFileSync(full, 'utf8');
      if (src.includes('```')) offenders.push(full);
    }
  }
}

try { walk(START); } catch (e) {
  console.error(`[check-fences] Error al escanear: ${e?.message || e}`);
  process.exit(1);
}

if (offenders.length) {
  console.error('\n[check-fences] Encontrados bloques ``` en archivos de código:');
  for (const f of offenders) console.error(' - ' + f);
  console.error('\nElimina/comenta esos backticks antes de compilar.');
  process.exit(2);
} else {
  console.log('[check-fences] OK: sin backticks ``` en archivos de código.');
}
