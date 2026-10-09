// Blind reading of Cowork answers: the files an independent reader (another Claude session) reads without knowing which version
// wrote each answer, and the sums of what it scored. Reads the JSON that evaluate-cowork-conversations.ts writes with --output;
// never calls a model, loads env files or touches the database.
//
//   node --loader ./scripts/ts-test-loader.mjs scripts/cowork-blind-read.ts mix out.md key.json A=base.json B=candidate.json
//     Every answer of every file, shuffled and grouped by case, under anonymous labels (R01…). key.json says which is which.
//   node --loader ./scripts/ts-test-loader.mjs scripts/cowork-blind-read.ts score key.json scores.json
//     scores.json is what the reader wrote, {"R01": {"score": 1-5, "issues": ["…"], "nota": "…"}}: the mean by version and case,
//     and how often each issue came up.
//   node --loader ./scripts/ts-test-loader.mjs scripts/cowork-blind-read.ts stats a.json [b.json …]
//     What can be counted without reading: emails, mixed tú and usted, sequences closing twice with the same question, caveats.
//   node --loader ./scripts/ts-test-loader.mjs scripts/cowork-blind-read.ts pairs out.md key.json transform file.json [file.json …]
//     For a deterministic change to the text (transform: caveats, offer), each answer it changes next to its original, in random
//     order (P01…), so the reader says which one it prefers; key.json says which was the changed one.
//
// The reader gets only the .md file and the scale; see docs/cowork-lectura-ciega.md.
import { readFileSync, writeFileSync } from 'node:fs';
import * as quality from '../src/lib/cowork/answer-quality';
import { CORPUS as PRODUCTION_CORPUS } from './fixtures/cowork-conversation-corpus';
import { EDIT_CORPUS, FILE_CORPUS, MARKETING_CORPUS, STARTER_CORPUS } from './fixtures/cowork-marketing-corpus';

type Email = { day?: number; subject: string; body: string };
type Result = {
  reply?: string; question?: string | null; blocks?: Array<Record<string, unknown>> | null; choices?: { options?: string[] } | null;
  suggestions?: Array<{ label: string }> | null; search?: unknown; proposal?: { kind?: string; campaign?: { emails?: string[]; messages?: Email[] } } | null;
};
type Outcome = { id: string; attempt?: number; result: Result };

const REQUESTS = new Map<string, string>([...PRODUCTION_CORPUS, ...MARKETING_CORPUS, ...STARTER_CORPUS, ...EDIT_CORPUS, ...FILE_CORPUS]
  .map(entry => [entry.id, entry.request]));
const load = (file: string) => (JSON.parse(readFileSync(file, 'utf8')) as { outcomes: Outcome[] }).outcomes;
const shuffle = <T>(items: T[]) => {
  for (let index = items.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
};

/** Every email an answer shows: its cards and the messages of a proposed campaign. */
export function blindEmails(result: Result): Array<{ kind: string; steps: Email[] }> {
  const groups: Array<{ kind: string; steps: Email[] }> = [];
  for (const block of result.blocks || []) {
    if (block.type === 'email_draft') groups.push({ kind: 'Correo', steps: [{ subject: String(block.subject), body: String(block.body) }] });
    if (block.type === 'sequence') groups.push({ kind: 'Secuencia', steps: block.steps as Email[] });
  }
  if (result.proposal?.campaign?.messages?.length) groups.push({ kind: 'Campaña propuesta', steps: result.proposal.campaign.messages });
  return groups;
}

/** One answer as the reader sees it: the request, the reply, what it offers to tap and its emails. */
export function blindAnswer(tag: string, id: string, result: Result): string {
  const lines = [`## ${tag}`, `**Pedido:** ${REQUESTS.get(id) || id}`, '', '**Respuesta:**', result.reply || '(sin respuesta)'];
  if (result.question) lines.push('', `**Pregunta final:** ${result.question}`);
  if (result.choices?.options?.length) lines.push('', `**Opciones para tocar:** ${result.choices.options.join(' · ')}`);
  if (result.suggestions?.length) lines.push('', `**Sugerencias para tocar:** ${result.suggestions.map(chip => chip.label).join(' · ')}`);
  if (result.search) lines.push('', `**Propone una búsqueda para aprobar:** ${JSON.stringify(result.search).slice(0, 400)}`);
  for (const group of blindEmails(result)) {
    lines.push('', `**${group.kind}:**`);
    group.steps.forEach((step, index) => lines.push('', `> [${index + 1}${step.day ? ` · día ${step.day}` : ''}] Asunto: ${step.subject}`, '>',
      ...step.body.split('\n').map(line => `> ${line}`)));
  }
  if (result.proposal?.campaign?.emails?.length) lines.push('', `_Destinatarios: ${result.proposal.campaign.emails.join(', ')}_`);
  return lines.join('\n');
}

function mix(out: string, keyFile: string, pairs: string[]) {
  const items = shuffle(pairs.flatMap(pair => {
    const [label, file] = pair.split('=');
    return load(file).map(outcome => ({ label, ...outcome }));
  })).sort((a, b) => a.id.localeCompare(b.id));
  const key: Record<string, { label: string; id: string; attempt?: number }> = {};
  const parts: string[] = [];
  items.forEach((item, index) => {
    if (item.id !== items[index - 1]?.id) parts.push(`# Caso ${item.id}`);
    const tag = `R${String(index + 1).padStart(2, '0')}`;
    key[tag] = { label: item.label, id: item.id, attempt: item.attempt };
    parts.push(blindAnswer(tag, item.id, item.result));
  });
  writeFileSync(out, `${parts.join('\n\n')}\n`);
  writeFileSync(keyFile, JSON.stringify(key, null, 2));
  console.log(`${items.length} respuestas en ${out}`);
}

function score(keyFile: string, scoresFile: string) {
  const key = JSON.parse(readFileSync(keyFile, 'utf8')) as Record<string, { label: string; id: string }>;
  const scores = JSON.parse(readFileSync(scoresFile, 'utf8')) as Record<string, { score: number; issues?: string[] }>;
  type Sums = { scores: number[]; cases: Map<string, number[]>; issues: Map<string, number> };
  const byLabel = new Map<string, Sums>();
  for (const [tag, entry] of Object.entries(scores)) {
    const known = key[tag];
    if (!known) continue;
    const sums: Sums = byLabel.get(known.label) || { scores: [], cases: new Map(), issues: new Map() };
    byLabel.set(known.label, sums);
    sums.scores.push(entry.score);
    sums.cases.set(known.id, [...(sums.cases.get(known.id) || []), entry.score]);
    for (const issue of entry.issues || []) sums.issues.set(issue, (sums.issues.get(issue) || 0) + 1);
  }
  const mean = (values: number[]) => (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2);
  for (const [label, sums] of [...byLabel].sort()) {
    console.log(`${label}: media ${mean(sums.scores)} (n=${sums.scores.length})`);
    for (const [id, values] of sums.cases) console.log(`   ${id}: ${mean(values)} [${values.join(',')}]`);
    console.log(`   problemas: ${[...sums.issues].sort((a, b) => b[1] - a[1]).map(([issue, count]) => `${issue} ${count}`).join(', ')}`);
  }
}

const plain = (text: string) => text.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');
const TU = /\b(?:tu|tus|te|ti|contigo|tienes|puedes|quieres|sabes|haces|usas|necesitas|cuentame|dime|avisame|escribeme)\b/;
const USTED = /\b(?:usted|cuenteme|digame|aviseme|escribame|le (?:escribo|cuento|comparto|parece|interesa|sirve|serviria))\b/;
const CAVEAT = /sin (?:asumir|suponer|dar por|atribuir)|no (?:confirma|garantiza) (?:que|si)|no es una (?:prueba|confirmacion)/;
const stems = (text: string) => new Set((plain(text).match(/[a-zñ]{5,}/g) || []).map(word => word.slice(0, 5)));
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter(stem => b.has(stem)).length / Math.max(1, Math.min(a.size, b.size));

function stats(files: string[]) {
  for (const file of files) {
    const outcomes = load(file);
    let emails = 0; let mixed = 0; let sequences = 0; let repeated = 0; let caveats = 0;
    for (const { result } of outcomes) {
      if (CAVEAT.test(plain(result.reply || ''))) caveats++;
      for (const group of blindEmails(result)) {
        emails += group.steps.length;
        const text = plain(group.steps.map(step => `${step.subject}\n${step.body}`).join('\n'));
        if (TU.test(text) && USTED.test(text)) mixed++;
        if (group.steps.length < 2) continue;
        sequences++;
        const closings = group.steps.map(step => stems((step.body.match(/¿[^?]+\?/g) || []).pop() || ''));
        if (closings.some((closing, index) => closings.slice(0, index).some(earlier => closing.size && overlap(closing, earlier) >= 0.6))) repeated++;
      }
    }
    console.log(`${file}: ${outcomes.length} respuestas, ${emails} correos, trato mixto ${mixed}, secuencias ${sequences} (pregunta repetida ${repeated}), cautelas ${caveats}`);
  }
}

// The deterministic cleanups of polishCoworkAnswer, by name; one that this checkout does not have yet is left out.
const cleanups = quality as unknown as Record<string, ((...args: string[]) => string) | undefined>;
const TRANSFORMS: Record<string, (result: Result) => string> = Object.fromEntries(Object.entries({
  caveats: ['withoutCaveats', (clean: (...args: string[]) => string, result: Result) => clean(result.reply || '')],
  offer: ['withoutRepeatedOffer', (clean: (...args: string[]) => string, result: Result) => result.question ? clean(result.reply || '', result.question) : result.reply || ''],
} as const).flatMap(([name, [exported, run]]) => {
  const clean = cleanups[exported];
  return clean ? [[name, (result: Result) => run(clean, result)]] : [];
}));

function pairs(out: string, keyFile: string, transform: string, files: string[]) {
  const change = TRANSFORMS[transform];
  if (!change) throw new Error(`Unknown transform: ${transform}`);
  const key: Record<string, 'A=cambiada' | 'A=original'> = {};
  const parts: string[] = [];
  for (const { id, result } of files.flatMap(load)) {
    const changed = change(result);
    if (changed === (result.reply || '')) continue;
    const tag = `P${String(parts.length + 1).padStart(2, '0')}`;
    const changedFirst = Math.random() < 0.5;
    key[tag] = changedFirst ? 'A=cambiada' : 'A=original';
    const [a, b] = changedFirst ? [changed, result.reply] : [result.reply, changed];
    parts.push(`## ${tag}\n**Pedido:** ${REQUESTS.get(id) || id}\n\n**Versión A:**\n${a}\n\n**Versión B:**\n${b}`);
  }
  writeFileSync(out, `${parts.join('\n\n')}\n`);
  writeFileSync(keyFile, JSON.stringify(key, null, 2));
  console.log(`${parts.length} pares en ${out}`);
}

const [command, ...args] = process.argv[1]?.endsWith('cowork-blind-read.ts') ? process.argv.slice(2) : [];
if (!command) { /* imported by a test */ }
else if (command === 'mix') mix(args[0], args[1], args.slice(2));
else if (command === 'score') score(args[0], args[1]);
else if (command === 'stats') stats(args);
else if (command === 'pairs') pairs(args[0], args[1], args[2], args.slice(3));
else console.log('Uso: mix | score | stats | pairs (ver el encabezado del script).');
