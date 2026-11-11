// Cuenta, sin modelo, lo que delata a los correos de una corrida del banco (scripts/evaluate-outreach-set.ts) y cuánto se parecen entre sí.
// Uso: node --loader ./scripts/ts-test-loader.mjs scripts/outreach-voice-report.ts <results.json> [otro results.json ...] [--pares]
// Con --pares imprime cada correo antes y después de la pasada de voz, para leerlos lado a lado.
import { readFileSync } from 'node:fs';
import { voiceSkeleton, voiceTells, type VoiceTellCode } from '../src/lib/outreach-voice';

type Email = { id: string; step: number | null; body: string; beforeVoice?: string; voice?: string; valid?: boolean; attempts?: number; voiceIssues?: string[]; subject?: string };

function emailsOf(path: string): Email[] {
  const results = JSON.parse(readFileSync(path, 'utf8')).results as any[];
  return results.flatMap((result) => (Array.isArray(result.steps)
    ? result.steps.map((step: any) => ({ ...step, id: `${result.id}#${step.step}`, step: step.step }))
    : result.body && result.type !== 'reconexion' ? [{ ...result, step: null }] : []));
}

/** The emails of the run as they were before the voice pass (the writer's and the editor's). */
function beforeVoice(emails: Email[]): Email[] {
  return emails.map((email) => ({ ...email, body: email.beforeVoice || email.body }));
}

function summary(label: string, emails: Email[]) {
  const counts: Partial<Record<VoiceTellCode, number>> = {};
  let withTell = 0;
  let total = 0;
  const skeletons = new Map<string, number>();
  for (const email of emails) {
    const tells = voiceTells(email.body);
    if (tells.length) withTell += 1;
    total += tells.length;
    for (const code of new Set(tells.map((tell) => tell.code))) counts[code] = (counts[code] || 0) + 1;
    const skeleton = voiceSkeleton(email.body);
    skeletons.set(skeleton, (skeletons.get(skeleton) || 0) + 1);
  }
  const openings = new Map<string, number>();
  for (const email of emails) {
    const first = voiceSkeleton(email.body).split(' | ')[0];
    openings.set(first, (openings.get(first) || 0) + 1);
  }
  const top = [...openings.entries()].sort((left, right) => right[1] - left[1])[0];
  return {
    versión: label,
    correos: emails.length,
    'con alguna marca': withTell,
    'marcas por correo': emails.length ? Math.round((total / emails.length) * 100) / 100 : 0,
    'formas distintas': skeletons.size,
    'apertura más repetida': top ? `${top[1]}× «${top[0]}»` : '',
    ...Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1])),
  };
}

const args = process.argv.slice(2);
const pairs = args.includes('--pares');
const files = args.filter((arg) => !arg.startsWith('--'));
if (!files.length) throw new Error('Falta la ruta de un results.json');

const rows: Array<Record<string, unknown>> = [];
for (const file of files) {
  const emails = emailsOf(file);
  const label = file.split('/').slice(-4, -3)[0] || file;
  if (emails.some((email) => email.beforeVoice)) rows.push(summary(`${label} · antes de la voz`, beforeVoice(emails)));
  rows.push(summary(label, emails));
  const valid = emails.filter((email) => email.valid).length;
  const first = emails.filter((email) => email.valid && email.attempts === 1).length;
  const voice = (state: string) => emails.filter((email) => email.voice === state).length;
  console.log(`${label}: ${valid}/${emails.length} válidos, ${first} al primer intento · voz: ${voice('reescrita')} reescritos, ${voice('igual')} iguales, ${voice('revertida')} revertidos`);
  if (pairs) {
    for (const email of emails) {
      console.log(`\n===== ${email.id} · ${email.voice || 'sin pasada'} · ${email.valid ? 'válido' : 'NO válido'} · ${email.subject || ''}`);
      if (email.beforeVoice && email.beforeVoice !== email.body) console.log(`--- antes\n${email.beforeVoice}`);
      console.log(`--- ${email.beforeVoice ? 'después' : 'correo'}\n${email.body}`);
      for (const tell of voiceTells(email.body)) console.log(`   · ${tell.code}: «${tell.excerpt.slice(0, 90)}»`);
      for (const issue of email.voiceIssues || []) console.log(`   ! la versión de la voz no quedó: ${issue.slice(0, 160)}`);
    }
  }
}
console.table(rows);
