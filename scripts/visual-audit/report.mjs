// Turns the visits into report.json (everything), report.md (what to fix, by page) and index.html (the screenshots with
// their findings). With a baseline report it also lists what is new and what was resolved.
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const TYPES = {
  pageError: 'Error de página', consoleError: 'console.error', serverError: 'Respuesta ≥ 500', overflow: 'Desborde horizontal',
  axe: 'Accesibilidad (axe)', writeOnLoad: 'Escritura al cargar', external: 'Host externo', access: 'Acceso indebido', unsettled: 'No terminó de cargar',
  status: 'Estado HTTP inesperado', redirect: 'Redirección incorrecta',
};

/** One stable key per finding, so two runs can be compared without looking at pixels. */
export function findingKeys(visit) {
  const base = `${visit.persona}|${visit.dataset}|${visit.path}`;
  return visit.findings.map(finding => `${base}|${finding.width || '*'}|${finding.scheme || '*'}|${finding.type}|${finding.key}`);
}

function loadBaseline(target) {
  if (!target) return null;
  const file = existsSync(target) && statSync(target).isDirectory() ? path.join(target, 'report.json') : target;
  if (!existsSync(file)) throw new Error(`No existe el recorrido base ${file}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

const escapeHtml = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const cell = value => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function writeReports(outDir, run) {
  const baseline = loadBaseline(run.options.baseline);
  const current = new Set(run.visits.flatMap(findingKeys));
  const previous = baseline ? new Set(baseline.visits.flatMap(findingKeys)) : null;
  const diff = previous ? { added: [...current].filter(key => !previous.has(key)).sort(), resolved: [...previous].filter(key => !current.has(key)).sort() } : null;
  const json = { ...run, diff };
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(json, null, 2));

  const counts = {};
  for (const visit of run.visits) for (const finding of visit.findings) counts[finding.type] = (counts[finding.type] || 0) + 1;
  const lines = [
    `# Auditoría visual · ${run.startedAt}`, '',
    `Commit \`${run.head}\` · ${run.visits.length} visitas · ${run.visits.reduce((sum, visit) => sum + visit.shots.length, 0)} capturas · ${Math.round(run.durationMs / 1000)} s`,
    `Personas: ${run.options.personas.join(', ')} · Datos: ${run.options.datasets.join(', ')} · Anchos: ${run.options.widths.join(', ')} · Temas: ${run.options.schemes.join(', ')}`, '',
    '## Resumen', '', '| Tipo | Hallazgos |', '|---|---|',
    ...Object.entries(TYPES).map(([type, label]) => `| ${label} | ${counts[type] || 0} |`), '',
  ];
  if (diff) {
    lines.push('## Comparado con el recorrido base', '', `Nuevos: **${diff.added.length}** · Resueltos: **${diff.resolved.length}**`, '');
    if (diff.added.length) lines.push('### Nuevos', '', ...diff.added.slice(0, 200).map(key => `- \`${key}\``), '');
    if (diff.resolved.length) lines.push('### Resueltos', '', ...diff.resolved.slice(0, 200).map(key => `- \`${key}\``), '');
  }
  lines.push('## Por página', '', '| Página | Persona | Datos | Estado | Hallazgos |', '|---|---|---|---|---|');
  for (const visit of run.visits) {
    const summary = Object.entries(visit.findings.reduce((acc, finding) => ({ ...acc, [finding.type]: (acc[finding.type] || 0) + 1 }), {})).map(([type, count]) => `${TYPES[type] || type}: ${count}`).join(' · ');
    lines.push(`| ${cell(visit.name)} \`${visit.path}\` | ${visit.persona} | ${visit.dataset} | ${visit.status ?? '—'}${visit.finalPath && visit.finalPath !== visit.path ? ` → \`${visit.finalPath}\`` : ''} | ${summary || '—'} |`);
  }
  lines.push('', '## Detalle', '');
  for (const visit of run.visits.filter(item => item.findings.length)) {
    lines.push(`### ${visit.name} · \`${visit.path}\` · ${visit.persona} · ${visit.dataset}`, '');
    for (const finding of visit.findings) lines.push(`- **${TYPES[finding.type] || finding.type}**${finding.width ? ` (${finding.width}px, ${finding.scheme})` : ''}: ${cell(finding.detail)}`);
    lines.push('');
  }
  const globals = run.global;
  lines.push('## Del servidor', '');
  lines.push(`- Tablas sin datos de prueba: ${globals.unfixturedTables.length ? globals.unfixturedTables.map(name => `\`${name}\``).join(', ') : 'ninguna'}`);
  lines.push(`- RPC sin datos de prueba: ${globals.unfixturedRpc.length ? globals.unfixturedRpc.map(name => `\`${name}\``).join(', ') : 'ninguno'}`);
  lines.push(`- Conexiones bloqueadas desde el servidor: ${globals.egress.length ? globals.egress.map(host => `\`${host}\``).join(', ') : 'ninguna'}`);
  lines.push(`- Errores del servidor (stderr, únicos): ${globals.serverErrors.length}`);
  for (const message of globals.serverErrors.slice(0, 40)) lines.push(`  - \`${cell(message.slice(0, 220))}\``);
  writeFileSync(path.join(outDir, 'report.md'), `${lines.join('\n')}\n`);

  const cards = run.visits.map(visit => `
    <section class="visit ${visit.findings.length ? 'has-findings' : ''}">
      <h2>${escapeHtml(visit.name)} <code>${escapeHtml(visit.path)}</code> <span>${escapeHtml(visit.persona)} · ${escapeHtml(visit.dataset)} · ${escapeHtml(visit.status ?? '—')}</span></h2>
      ${visit.findings.length ? `<ul>${visit.findings.map(finding => `<li><b>${escapeHtml(TYPES[finding.type] || finding.type)}</b>${finding.width ? ` (${finding.width}px, ${escapeHtml(finding.scheme)})` : ''}: ${escapeHtml(finding.detail)}</li>`).join('')}</ul>` : '<p class="ok">Sin hallazgos</p>'}
      <div class="shots">${visit.shots.map(shot => `<figure><a href="${escapeHtml(shot.file)}"><img loading="lazy" src="${escapeHtml(shot.file)}" alt="${escapeHtml(`${visit.name}, ${shot.width}px, ${shot.scheme}`)}"></a><figcaption>${shot.width}px · ${escapeHtml(shot.scheme)}</figcaption></figure>`).join('')}</div>
    </section>`).join('');
  writeFileSync(path.join(outDir, 'index.html'), `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Auditoría visual</title>
<style>
  :root { color-scheme: light dark; --bg: #fff; --fg: #111; --muted: #666; --line: #ddd; --warn: #b45309; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111; --fg: #eee; --muted: #aaa; --line: #333; --warn: #fbbf24; } }
  body { margin: 0; padding: 16px; font: 14px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--fg); }
  h1 { font-size: 20px; } h2 { font-size: 15px; margin: 0 0 8px; } h2 span { color: var(--muted); font-weight: 400; }
  .visit { border-top: 1px solid var(--line); padding: 16px 0; } .has-findings h2 { color: var(--warn); }
  .ok { color: var(--muted); } ul { margin: 0 0 8px; padding-left: 18px; }
  .shots { display: flex; gap: 12px; overflow-x: auto; } figure { margin: 0; flex: none; }
  img { display: block; max-height: 420px; width: auto; border: 1px solid var(--line); } figcaption { color: var(--muted); font-size: 12px; }
</style></head><body><h1>Auditoría visual · ${escapeHtml(run.startedAt)} · <code>${escapeHtml(run.head)}</code></h1>${cards}</body></html>`);
  return { counts, diff };
}
