import { createHash } from 'node:crypto';
import { collectCoworkLeadRows } from '@/lib/cowork/lead-export';
import type { CoworkEvent } from '@/lib/cowork/contracts';
import { buildCoworkFile, CoworkExportError } from './file-exports';

/** Deterministic pilot: one observed population in an editable report, PDF and spreadsheet.
 * No refresh, database, model, provider, public deployment or invented business claims. */
export async function buildCoworkMarketingReport(events: CoworkEvent[], scope: { runId: string; organizationId: string; userId: string }) {
  const observations = events.filter(event => event.kind === 'tool.completed').map(event => event.payload);
  const rows = collectCoworkLeadRows(observations);
  if (!rows.length) throw new CoworkExportError('Este trabajo no tiene contactos observados para preparar el informe.', 404);
  const withEmail = rows.filter(row => String(row.email || '').trim()).length;
  const observed = observations.filter(item => ['leads.search', 'leads.get', 'prospecting.search'].includes(String(item?.action)));
  const snapshot = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  const tableCell = (value: unknown) => String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
  const content = [`# Contactos del trabajo`, '', '## Alcance',
    'Informe sobre los contactos observados en este trabajo. No equivale a toda la organización ni confirma permiso o disponibilidad para enviar.',
    '', `- Contactos observados: ${rows.length}`, `- Con correo registrado: ${withEmail}`, `- Sin correo registrado: ${rows.length - withEmail}`,
    '', '## Próxima decisión', 'Revisar el encaje, relación previa y canal de cada contacto antes de preparar mensajes. Tener correo no equivale a estar listo para enviar.',
    '', '## Contactos', '| Persona | Cargo | Empresa | Correo registrado |', '|---|---|---|---|',
    ...rows.map(row => `| ${tableCell(row.name)} | ${tableCell(row.title)} | ${tableCell(row.company)} | ${row.email ? 'Sí' : 'No'} |`)].join('\n');
  const completed = { sequence: 2147483647, kind: 'run.completed', payload: { reply: 'Informe sobre los contactos observados.',
    document: { title: 'Informe de contactos', content } }, created_at: events.at(-1)?.created_at || '' } as CoworkEvent;
  const frozen = [...events.filter(event => event.kind !== 'run.completed'), completed];
  const files = await Promise.all((['pdf', 'docx', 'xlsx', 'md'] as const).map(format => buildCoworkFile(frozen, format)));
  files.push({ filename: 'calculadora-esfuerzo.html', mime: 'text/html; charset=utf-8',
    bytes: new TextEncoder().encode(buildCoworkCalculator('Calculadora de esfuerzo del trabajo', `Este informe contiene ${rows.length} contactos observados. Define tus tiempos para comparar esfuerzo; no se han medido resultados del servicio.`)) });
  const manifest = { version: 1, resultId: `${scope.runId}:marketing-report:${snapshot}`, scope,
    data: { snapshot, observedRows: rows.length, withEmail, populationTotal: null, completePopulation: false,
      sources: observed.map(item => ({ action: item?.action, input: item?.input, scope: (item?.result as { scope?: unknown })?.scope })) },
    primary: files.find(file => file.filename.endsWith('.pdf'))!.filename,
    files: files.map(file => ({ name: file.filename, size: file.bytes.length, sha256: createHash('sha256').update(file.bytes).digest('hex') })),
    checks: { formats: 'generated', rendered: 'not_measured', semantic: 'not_measured' } };
  return { files, manifest };
}

/** Small, self-contained miniapp. Theme values mirror existing ANTON.IA tokens; all business values are supplied by the user. */
export function buildCoworkCalculator(title: string, context: string) {
  const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
<style>:root{color-scheme:light dark;--bg:hsl(0 0% 100%);--text:hsl(222.2 47.4% 11.2%);--muted:hsl(215 16.3% 46.9%);--panel:hsl(210 40% 98%);--border:hsl(214.3 31.8% 91.4%);--accent:hsl(217.2 91.2% 45%);--on:hsl(210 40% 98%)}
@media(prefers-color-scheme:dark){:root{--bg:hsl(222.2 84% 4.9%);--text:hsl(213 31% 91%);--muted:hsl(215 20.2% 65.1%);--panel:hsl(222 47% 9%);--border:hsl(217.2 32.6% 17.5%);--accent:hsl(217.2 91.2% 59.8%);--on:hsl(222.2 84% 4.9%)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,sans-serif}main{max-width:800px;margin:auto;padding:clamp(20px,5vw,48px)}h1{font-size:clamp(26px,5vw,38px);line-height:1.15;letter-spacing:-.025em}p{color:var(--muted)}form,section{border:1px solid var(--border);border-radius:16px;background:var(--panel);padding:24px;margin-top:24px}label{display:block;font-weight:600;margin-bottom:6px}input,button{font:inherit;border-radius:10px}input{width:100%;padding:10px;border:1px solid var(--border);background:var(--bg);color:var(--text)}.fields{display:grid;grid-template-columns:1fr 1fr;gap:20px}button{min-height:44px;margin-top:20px;padding:10px 18px;background:var(--accent);color:var(--on);border:0;font-weight:600;cursor:pointer}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}output{font-size:28px;font-weight:700;display:block}small{display:block;color:var(--muted);margin-top:4px}@media(max-width:540px){.fields{grid-template-columns:1fr}form,section{padding:18px}}</style></head><body><main><h1>${escape(title)}</h1><p>${escape(context)}</p><p>Introduce tus supuestos. El resultado es una estimación de esfuerzo, no una promesa de rendimiento del servicio.</p>
<form id="estimate"><div class="fields"><div><label for="count">Personas o registros</label><input required id="count" type="number" min="0" max="1000000" step="1"></div><div><label for="manual">Minutos actuales por registro</label><input required id="manual" type="number" min="0" max="1440" step="any"></div><div><label for="assisted">Minutos estimados por registro</label><input required id="assisted" type="number" min="0" max="1440" step="any"></div><div><label for="setup">Horas de preparación</label><input required id="setup" type="number" min="0" max="10000" step="any"><small>Incluye configuración y revisión inicial.</small></div></div><button type="submit">Calcular esfuerzo</button></form>
<section aria-labelledby="result-title"><h2 id="result-title">Resultado estimado</h2><output id="result" role="status" aria-live="polite">Completa los supuestos para calcular.</output><p id="explanation">Fórmula: registros × (minutos actuales − minutos estimados) ÷ 60 − preparación. Un resultado negativo indica horas adicionales.</p></section></main>
<script>document.getElementById('estimate').addEventListener('submit',event=>{event.preventDefault();const values=['count','manual','assisted','setup'].map(id=>Number(document.getElementById(id).value));if(!values.every(Number.isFinite))return;const [count,manual,assisted,setup]=values;const hours=count*(manual-assisted)/60-setup;document.getElementById('result').textContent=new Intl.NumberFormat('es-CL',{maximumFractionDigits:2}).format(hours)+' horas de diferencia';});</script></body></html>`;
}
