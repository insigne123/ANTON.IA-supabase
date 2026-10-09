// Deterministic deliverables, no env loading, model, authentication or production calls.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildCoworkMarketingReport, buildCoworkCalculator } from '../src/lib/server/cowork/marketing-deliverables';
import type { CoworkEvent } from '../src/lib/cowork/contracts';
const directory = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
if (!directory) throw new Error('Explicit --output directory required');
const id = '00000000-0000-4000-8000-000000000001';
const rows = Array.from({ length: 45 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  name: `Contacto de demostración ${i + 1}`, title: i % 2 ? 'Operaciones' : 'Selección', company: `Empresa demo ${i + 1}`, email: i < 30 ? `demo${i}@example.test` : null }));
const events = [{ sequence: 1, kind: 'tool.completed', payload: { action: 'leads.search', input: 'demo',
  result: { scope: 'own_saved_contacts', items: rows, total: 45, truncated: false } }, created_at: '2026-10-09T00:00:00Z' }] as CoworkEvent[];
const kit = await buildCoworkMarketingReport(events, { runId: id, userId: id, organizationId: id });
mkdirSync(directory, { recursive: true });
for (const file of kit.files) writeFileSync(path.join(directory, file.filename), file.bytes);
writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(kit.manifest, null, 2)}\n`);
writeFileSync(path.join(directory, 'calculadora.html'), buildCoworkCalculator('Calculadora de esfuerzo comercial', 'Piloto de demostración de ANTON.IA. Los valores los defines tú; no utiliza información de clientes reales.'));
console.log(JSON.stringify({ directory, formats: kit.files.map(file => ({ name: file.filename, bytes: file.bytes.length })), observedRows: 45, withEmail: 30, authenticated: false, remoteExecutor: false }));
