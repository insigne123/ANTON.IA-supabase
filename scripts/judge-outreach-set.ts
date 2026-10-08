// Puntúa muestras generadas con el juez Luna y exporta pares ciegos v15 vs v16.
// Uso: node --loader ./scripts/ts-test-loader.mjs scripts/judge-outreach-set.ts <dir-resultados> [<dir-baseline>]
// Requiere OPENAI_API_KEY. Sin escrituras en BD, sin envíos.
// OUTREACH_EVAL_SET: el mismo conjunto con que se generaron las muestras, si no es el de siempre.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { judgeOutreach, judgeVerdict } from '../src/ai/flows/judge-outreach';
import { RESEARCH_SEQUENCE_STEPS } from '../src/lib/outreach-sequence-brief';

if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');
const dir = process.argv[2];
const baselineDir = process.argv[3];
if (!dir) throw new Error('Falta <dir-resultados>');

const setPath = process.env.OUTREACH_EVAL_SET
  ? resolve(process.env.OUTREACH_EVAL_SET)
  : new URL('./fixtures/outreach-eval-set.json', import.meta.url);
const evalSet = JSON.parse(readFileSync(setPath, 'utf8'));
const caseById = new Map<string, any>(evalSet.cases.map((c: any) => [c.id, c]));
const run = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));

const samples: Array<{ label: string; datos: unknown; asunto: string; cuerpo: string }> = [];
for (const result of run.results) {
  const evalCase = caseById.get(result.id);
  if (!evalCase || result.blocked || result.error) continue;
  const datos = {
    tipo: result.type, tratamiento: evalCase.tratamiento,
    destinatario: evalCase.destinatario, actividadEmpresa: evalCase.actividadEmpresa,
    senal: evalCase.senal, objecion: evalCase.objecion,
    // La relación anterior de una reconexión es un dato del caso, no algo inventado.
    ...(evalCase.reconexion ? { reconexion: evalCase.reconexion } : {}),
    hechos_permitidos: [
      `Vendedor: ${evalSet.seller.name}, ${evalSet.seller.jobTitle} de ${evalSet.seller.companyName}`,
      ...(evalSet.seller.description ? [evalSet.seller.description] : []),
      // Lo que ofrece la empresa del vendedor, dicho así: «En Yago usamos AXIS» no es un hecho inventado.
      ...evalSet.seller.services.map((service: string) => `${evalSet.seller.companyName} ofrece: ${service}`),
      evalSet.seller.valueProposition,
      ...(evalSet.seller.proofPoints || []),
    ],
    // El pedido que fija el estilo aprobado (p. ej. «15 minutos») y, en una secuencia, qué pide su paso: no son hechos inventados.
    ...(result.cta ? { cta_aprobado: result.cta } : {}),
  };
  if (result.steps) {
    for (const step of result.steps) {
      const stage = RESEARCH_SEQUENCE_STEPS[step.step - 1];
      const paso = stage ? { nombre: stage.name, instruccion: stage.instruction } : { nombre: 'Inicial' };
      samples.push({ label: `${result.id}#${step.step}`, datos: { ...datos, paso }, asunto: step.subject, cuerpo: step.body });
    }
  } else if (result.body) {
    samples.push({ label: result.id, datos, asunto: result.subject, cuerpo: String(result.body).replace(/<[^>]+>/g, ' ') });
  }
}

const scores: any[] = [];
for (const sample of samples) {
  const score = await judgeOutreach({ datos: sample.datos, asunto: sample.asunto, cuerpo: sample.cuerpo });
  scores.push({ label: sample.label, ...score, veredicto: judgeVerdict(score) });
  console.log(`${sample.label}: H${score.suena_humano} E${score.especificidad} P${score.un_solo_pedido} T${score.tono_y_tratamiento} V${score.veracidad} => ${judgeVerdict(score)}${score.frase_mas_artificial ? ` | "${score.frase_mas_artificial.slice(0, 90)}"` : ''}`);
}
const avg = (key: string) => Math.round((scores.reduce((a, s) => a + s[key], 0) / Math.max(1, scores.length)) * 100) / 100;
const summary = {
  judgedAt: new Date().toISOString(),
  samples: scores.length,
  promedios: {
    suena_humano: avg('suena_humano'), especificidad: avg('especificidad'),
    un_solo_pedido: avg('un_solo_pedido'), tono_y_tratamiento: avg('tono_y_tratamiento'), veracidad: avg('veracidad'),
  },
  veredictos: {
    enviar: scores.filter((s) => s.veredicto === 'enviar').length,
    corregir: scores.filter((s) => s.veredicto === 'corregir').length,
    revision_humana: scores.filter((s) => s.veredicto === 'revision_humana').length,
  },
};
writeFileSync(join(dir, 'scores.json'), JSON.stringify({ summary, scores }, null, 2));
console.log(JSON.stringify(summary, null, 2));

if (baselineDir) {
  const base = JSON.parse(readFileSync(join(baselineDir, 'results.json'), 'utf8'));
  const baseByLabel = new Map<string, any>();
  for (const result of base.results) {
    if (result.steps) for (const step of result.steps) baseByLabel.set(`${result.id}#${step.step}`, step);
    else if (result.body) baseByLabel.set(result.id, result);
  }
  const labels = scores.map((s) => s.label).filter((label) => baseByLabel.has(label));
  let md = `# Pares ciegos v15 (línea base) vs v16 (nuevo)\n\nElige por par cuál correo te gusta más (A o B), sin saber cuál es cuál. Criterio: ¿cuál parece escrito por un humano?\n\n`;
  const key: Record<string, string> = {};
  labels.forEach((label, index) => {
    const flip = index % 2 === 1;
    const sample = samples.find((s) => s.label === label)!;
    const old = baseByLabel.get(label)!;
    const a = flip ? { asunto: sample.asunto, cuerpo: sample.cuerpo } : { asunto: old.subject, cuerpo: old.body };
    const b = flip ? { asunto: old.subject, cuerpo: old.body } : { asunto: sample.asunto, cuerpo: sample.cuerpo };
    key[label] = flip ? 'A=v16 B=v15' : 'A=v15 B=v16';
    md += `---\n\n## Par ${index + 1} (${label})\n\n### A\n\n**Asunto:** ${a.asunto}\n\n${a.cuerpo}\n\n### B\n\n**Asunto:** ${b.asunto}\n\n${b.cuerpo}\n\nMi elección: ___\n\n`;
  });
  writeFileSync(join(dir, 'pares-ciegos.md'), md);
  writeFileSync(join(dir, 'pares-ciegos-clave.json'), JSON.stringify(key, null, 2));
  console.log(`\nPares ciegos: ${labels.length} en ${join(dir, 'pares-ciegos.md')} (clave en pares-ciegos-clave.json, no la mires antes de elegir)`);
}
