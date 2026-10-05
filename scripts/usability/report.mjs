// The report of a simplicity run: the index, each task's score and parts, and where each failure stopped.
import { writeFileSync } from 'node:fs';
import { seconds } from './score.mjs';

const PART_LABELS = { logra: 'Logra hacerlo (30)', pasos: 'Pasos (20)', tiempo: 'Tiempo (10)', decisiones: 'Decisiones (15)', vista: 'A la vista (15)', claridad: 'Claridad (10)' };

export function writeSimplicityReport(file, json) {
  const { summary, results } = json;
  const lines = [
    `# Índice de sencillez · ${json.startedAt.slice(0, 16).replace('T', ' ')} UTC`, '',
    `**Índice: ${summary.index} de 100**, en ${summary.tasks} tareas (${summary.done} se completan en escritorio).`, '',
    '## Por módulo', '', '| Módulo | Índice |', '|---|---:|',
    ...Object.entries(summary.modules).sort((a, b) => a[1] - b[1]).map(([name, value]) => `| ${name} | ${value} |`), '',
    '## Por tarea', '',
    '| Tarea | Índice | Escritorio | Teléfono | Pasos (ideal) | Tiempo KLM | Controles por pantalla | A la vista (escritorio / teléfono) | Acción principal clara | Palabras por pantalla |',
    '|---|---:|---|---|---:|---:|---:|---:|---:|---:|',
    ...results.map(result => {
      const { score, runs } = result;
      const state = run => (!run ? '—' : run.success ? 'sí' : 'no');
      return `| ${result.title} | **${score.total}** | ${state(runs.desktop)} | ${state(runs.phone)} | ${score.steps} (${score.ideal}) | ${score.seconds} s | ${score.controls} | ${score.inViewDesktop} % / ${score.inViewPhone} % | ${score.clearMain} % | ${score.words} |`;
    }), '',
    '## Partes de cada índice', '',
    `| Tarea | ${Object.values(PART_LABELS).join(' | ')} |`, `|---|${Object.keys(PART_LABELS).map(() => '---:').join('|')}|`,
    ...results.map(result => `| ${result.title} | ${Object.keys(PART_LABELS).map(key => result.score.parts[key]).join(' | ')} |`), '',
    '## Paso a paso', '',
  ];
  for (const result of results) {
    lines.push(`### ${result.title}`, '');
    if (result.pending) lines.push(`Pasos contados del diseño, no ejecutados en el banco (${result.pending.steps}): ${result.pending.note}`, '');
    for (const [viewport, run] of Object.entries(result.runs)) {
      lines.push(`**${viewport === 'desktop' ? 'Escritorio (1440 px)' : 'Teléfono (390 px)'}:** ${run.success ? 'se completa' : `no se completa. ${run.failure || ''}`} · ${run.steps.length} pasos · ${Math.round(seconds(run))} s KLM`, '');
      if (viewport === 'desktop' && run.steps.length) {
        lines.push('| # | Paso | Espera | Controles a la vista | Acciones principales | Palabras | A la vista |', '|---:|---|---:|---:|---:|---:|---|');
        run.steps.forEach((step, index) => lines.push(`| ${index + 1} | ${step.kind === 'fill' ? 'Escribir en' : step.kind === 'upload' ? 'Subir archivo con' : step.kind === 'select' || step.kind === 'choose' ? 'Elegir en' : 'Pulsar'} «${step.name}» | ${step.waitMs >= 1500 ? `**${(step.waitMs / 1000).toFixed(1)} s**` : '—'} | ${step.controls} | ${step.primary} | ${step.words} | ${step.inView ? 'sí' : 'no, hay que desplazarse'} |`));
        lines.push('');
      }
      if (run.errors?.length) lines.push(`Errores de página: ${[...new Set(run.errors)].join(' | ')}`, '');
    }
  }
  writeFileSync(file, `${lines.join('\n')}\n`);
}
