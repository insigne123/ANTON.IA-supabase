import {
  COWORK_BLOCK_LIMIT, COWORK_CHOICE_LIMITS, COWORK_SUGGESTION_LIMITS, coworkBlockSchema, coworkSameLine,
  type CoworkBlock, type CoworkChoices, type CoworkSuggestion,
} from './contracts';
import { COWORK_GLOSSARY } from './decision-context';

/** Deterministic last pass over what the person reads. The prompt asks for
 * plain language; this catches the internal codes a small model still copies
 * from tool results. It never changes meaning and skips fenced code blocks. */

const UUID = /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i;
const CODE_TERMS = Object.keys(COWORK_GLOSSARY).filter(term => term.includes('_'));
const CODE_PATTERN = new RegExp(`([*_\`]?)\\b(${CODE_TERMS.join('|')})\\b\\1`, 'g');
const CODE_EMAIL = /`([^`\s@]+@[^`\s@]+\.[^`\s@]+)`/g;
const ID_IN_PARENS = new RegExp(`\\s*\\((?:ID(?: del contacto)?\\s*:?\\s*)?${UUID.source}\\)`, 'gi');

function outsideCode(text: string, transform: (chunk: string) => string) {
  return text.split(/(```[\s\S]*?```)/g).map(part => part.startsWith('```') ? part : transform(part)).join('');
}

export function polishCoworkText(text: string): string {
  return outsideCode(String(text || ''), chunk => chunk
    .replace(CODE_PATTERN, (_match, _wrap, code: string) => COWORK_GLOSSARY[code] || code)
    .replace(CODE_EMAIL, '$1')
    .replace(ID_IN_PARENS, ''));
}

/** A quick reply that leaves something for later («Sí, cuando lo guarde…»,
 * «…y te indicaré otro horario», «Voy a sincronizar») cannot be done on click.
 * Shared with the evaluation corpus. */
export const COWORK_DEFERRAL = /(?<!\p{L})(?:voy a|te indicar[ée]|te aviso|lo pienso|d[ée]jame pensar|m[áa]s tarde|despu[ée]s lo|luego lo)(?!\p{L})|^s[íi],? cuando(?!\p{L})/iu;
/** A chip that only turns the question down («No por ahora», «Lo revisaré por mi cuenta»): the person can just not click. The judge
 * reads it as a yes-or-no choice it did not need (Plan 12, final round). A «no» that tells something («No está confirmado») stays. */
const DECLINE = /^(?:no,?\s+(?:por ahora|por el momento|todav[íi]a|gracias|de momento)|ahora no|todav[íi]a no|por ahora no|lo (?:reviso|revisar[ée]|veo|ver[ée]) (?:yo|por mi cuenta|despu[ée]s))(?!\p{L})/iu;

/** Quick replies that are safe to show as buttons: plain text, no IDs or
 * internal codes, a short label and a self-contained message. Malformed chips
 * are dropped one by one; nothing here rewrites what a chip means. */
export function coworkSuggestions(value: unknown): CoworkSuggestion[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const kept: CoworkSuggestion[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as { label?: unknown; message?: unknown };
    // Only formatting that wraps the whole chip is removed; text inside stays as written.
    const clean = (text: unknown) => polishCoworkText(String(text ?? '')).replace(/\s+/g, ' ').trim()
      .replace(/^(?:\*\*|`)(.+)(?:\*\*|`)$/, '$1').replace(/^#+\s*/, '');
    const label = clean(raw.label).replace(/[.;:,]+$/, '');
    const message = clean(raw.message) || label;
    if (label.length < 2 || label.length > COWORK_SUGGESTION_LIMITS.label || message.length > COWORK_SUGGESTION_LIMITS.message) continue;
    // A message ending in «:» or holding a [placeholder] waits for text the person has to add, and
    // a deferral leaves something for later: none can be sent as is.
    if (UUID.test(label) || UUID.test(message) || /:$/.test(message) || /\[[^\]]{2,}\]/.test(`${label} ${message}`)
      || COWORK_DEFERRAL.test(message) || DECLINE.test(label)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ label, message });
    if (kept.length === COWORK_SUGGESTION_LIMITS.count) break;
  }
  return kept;
}

/**
 * The closing question's answers to pick (V5): short plain labels, no IDs, codes or
 * [placeholders], each once; 2 to 5 of them or none. A yes or a no is not a choice:
 * «Sí» and «No» alone mean the question was a closed one, which quick replies answer.
 */
export function coworkChoices(value: unknown): CoworkChoices | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { multiple?: unknown; options?: unknown };
  if (!Array.isArray(raw.options)) return null;
  const seen = new Set<string>();
  const options: string[] = [];
  for (const item of raw.options) {
    const trimmed = polishCoworkText(String(item ?? '')).replace(/\s+/g, ' ').trim()
      .replace(/^(?:\*\*|`)(.+)(?:\*\*|`)$/, '$1').replace(/^(?:[-*•]|\d+[.)])\s+/, '').replace(/[;:,]+$/, '');
    // A lone final period goes; the one of an abbreviation stays («RR. HH.», «S.A.»).
    const label = /^[^.]*\.$/.test(trimmed) ? trimmed.slice(0, -1) : trimmed;
    // «Otra…» repeats what the app already offers under the options («Otra respuesta»).
    if (!label || label.length > COWORK_CHOICE_LIMITS.label || UUID.test(label) || /\[[^\]]{2,}\]/.test(label) || /^otr[oa]s?(?:\s|$)/i.test(label)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(label);
    if (options.length === COWORK_CHOICE_LIMITS.max) break;
  }
  if (options.length < COWORK_CHOICE_LIMITS.min || options.every(option => /^(?:s[íi]|no)$/i.test(option))) return null;
  return { multiple: raw.multiple === true, options };
}

/** What a card shows at most; longer results belong in a document or an export. */
export const COWORK_BLOCK_DISPLAY = { steps: 7, columns: 8, rows: 50, metrics: 6, recipients: 25 } as const;

const METRIC_VALUE_MAX = 40;
const METRIC_DETAIL_MAX = 140;
// Where a figure can be split, strongest first: between clauses («6 contactos; 4 con envío»), at a middle dot, a comma or a dash,
// and only then before a parenthesis, which usually belongs to the figure before it («1 respondió (33 %)»).
const METRIC_SEPARATORS = [/;\s+/g, /\s+·\s+/g, /,\s+/g, /\s+[–-]\s+/g, /\s+(?=\()/g];
const clipWords = (value: string, max: number) => {
  if (value.length <= max) return value;
  const space = value.lastIndexOf(' ', max - 1);
  return `${(space > max * 0.6 ? value.slice(0, space) : value.slice(0, max - 1)).trimEnd()}…`;
};

/**
 * A figure fits its card: the value shows at most 40 characters, so what does not fit goes to the start of its detail line,
 * cut between clauses and never inside a word or a number («6 contactos; 4 con envío; 1 respondió (33 %)» → «6 contactos;
 * 4 con envío» and «1 respondió (33 %)»). Cutting at 40 used to leave «1 respondió (3».
 */
export function coworkMetricFit(value: string, detail: string | null): { value: string; detail: string | null } {
  const clean = value.trim();
  const tail = (detail || '').trim();
  if (clean.length <= METRIC_VALUE_MAX) return { value: clean, detail: tail ? clipWords(tail, METRIC_DETAIL_MAX) : null };
  let head = '';
  let rest = '';
  // The last split of the strongest kind that leaves a value that fits.
  for (const separator of METRIC_SEPARATORS) {
    for (const match of clean.matchAll(separator)) {
      if (match.index === undefined || match.index === 0 || match.index > METRIC_VALUE_MAX) continue;
      head = clean.slice(0, match.index).trim();
      rest = clean.slice(match.index + match[0].length).trim();
    }
    if (head) break;
  }
  if (!head) {
    // No clause to split at: the value ends at a word and the rest goes on in the detail.
    const space = clean.lastIndexOf(' ', METRIC_VALUE_MAX - 1);
    const at = space > 0 ? space : METRIC_VALUE_MAX - 1;
    head = `${clean.slice(0, at).trimEnd()}…`;
    rest = clean.slice(at).trim();
  }
  const moved = [rest, tail].filter(Boolean).join(' · ');
  return { value: head, detail: moved ? clipWords(moved, METRIC_DETAIL_MAX) : null };
}

/** Blocks safe to render as cards: plain text without IDs or internal codes,
 * trimmed to what a card shows. A malformed block is dropped on its own; a
 * one-email sequence reads as an email. */
export function coworkBlocks(value: unknown): CoworkBlock[] {
  if (!Array.isArray(value)) return [];
  const text = (raw: unknown, max: number) => polishCoworkText(String(raw ?? '')).trim().slice(0, max).trim();
  const line = (raw: unknown, max: number) => text(String(raw ?? '').replace(/\s+/g, ' '), max);
  const visible = (raw: unknown, max: number) => { const value = line(raw, max); return UUID.test(value) ? '' : value; };
  const blocks: CoworkBlock[] = [];
  for (const item of value) {
    const parsed = coworkBlockSchema.safeParse(item);
    if (!parsed.success) continue;
    const block = parsed.data;
    if (block.type === 'email_draft' || block.type === 'sequence') {
      const steps = (block.type === 'sequence' ? block.steps : [{ day: 1, subject: block.subject, body: block.body }])
        .map(step => ({ day: Math.max(1, step.day), subject: visible(step.subject, 200), body: text(step.body, block.type === 'sequence' ? 4000 : 6000) }))
        .filter(step => step.subject && step.body && !UUID.test(step.body))
        .sort((a, b) => a.day - b.day)
        .slice(0, COWORK_BLOCK_DISPLAY.steps);
      if (!steps.length) continue;
      const title = visible(block.title, 120);
      if (block.type === 'email_draft' || steps.length === 1) {
        const to = (block.type === 'email_draft' ? block.to || [] : []).map(value => visible(value, 160)).filter(Boolean).slice(0, COWORK_BLOCK_DISPLAY.recipients);
        blocks.push({ type: 'email_draft', title: title || steps[0].subject, to: to.length ? to : null, subject: steps[0].subject, body: steps[0].body });
      } else {
        blocks.push({ type: 'sequence', title: title || `Secuencia de ${steps.length} correos`, steps });
      }
    } else if (block.type === 'table') {
      const columns = block.columns.slice(0, COWORK_BLOCK_DISPLAY.columns).map((column, index) => visible(column, 60) || `Columna ${index + 1}`);
      const rows = block.rows.map(row => columns.map((_, index) => visible(row[index], 300)))
        .filter(row => row.some(Boolean)).slice(0, COWORK_BLOCK_DISPLAY.rows);
      if (!columns.length || !rows.length) continue;
      blocks.push({ type: 'table', title: visible(block.title, 120) || 'Tabla', columns, rows });
    } else if (block.type === 'chart') {
      // Every series has one value per label; a chart with fewer than two points or no series says nothing.
      const labels = block.labels.map((label, index) => visible(label, 40) || `Punto ${index + 1}`);
      const series = block.series.filter(item => item.values.length === labels.length)
        .map(item => ({ name: visible(item.name, 60) || 'Serie', values: item.values.map(value => Math.round(value * 100) / 100) }));
      if (labels.length < 2 || !series.length) continue;
      blocks.push({ type: 'chart', title: visible(block.title, 120) || 'Gráfico', kind: block.kind, period: block.period ? visible(block.period, 80) || null : null,
        unit: block.unit ? visible(block.unit, 20) || null : null, labels, series });
    } else {
      const items = block.items.map(item => ({ label: visible(item.label, 60), ...coworkMetricFit(visible(item.value, 300), item.detail ? visible(item.detail, 300) : null) }))
        .filter(item => item.label && item.value).slice(0, COWORK_BLOCK_DISPLAY.metrics);
      if (!items.length) continue;
      blocks.push({ type: 'metrics', title: visible(block.title, 120) || 'Cifras', period: block.period ? visible(block.period, 80) || null : null, items });
    }
    if (blocks.length === COWORK_BLOCK_LIMIT) break;
  }
  return blocks;
}

/** The closing question on the next step as one plain sentence, or null.
 * Wrapping formatting goes; a missing opening «¿» is added. */
export function coworkQuestion(value: unknown): string | null {
  const text = polishCoworkText(String(value ?? '')).replace(/\s+/g, ' ').trim().replace(/^(?:\*\*)(.+)(?:\*\*)$/, '$1').trim();
  if (text.length < 4 || text.length > 300 || UUID.test(text) || !/\?$/.test(text) || /\[[^\]]{2,}\]/.test(text)) return null;
  return text.includes('¿') ? text : `¿${text}`;
}

/** A line without the questions it ends with: «Te dejo la lista. ¿La reviso?» keeps «Te dejo la lista.». */
export function withoutTrailingQuestions(line: string): string {
  let kept = line.trimEnd();
  // A Spanish question opens with «¿»: it goes from there, so the periods of an abbreviation inside it
  // («¿… tus contactos de RR. HH. con correo?») do not leave half of it behind.
  while (/\?[^\p{L}\p{N}]*$/u.test(kept)) {
    const open = kept.lastIndexOf('¿');
    if (open < 0) break;
    kept = kept.slice(0, open).replace(/[\s*_«"(]+$/u, '');
  }
  if (/\?[^\p{L}\p{N}]*$/u.test(kept)) {
    // A question without «¿»: sentence by sentence, as before.
    const sentences = kept.match(/[^.!?…]+[.!?…]+[^\p{L}\p{N}¿¡(«"]*|[^.!?…]+$/gu) || [kept];
    while (sentences.length && /\?[^\p{L}\p{N}]*$/u.test(sentences[sentences.length - 1])) sentences.pop();
    kept = sentences.join('');
  }
  kept = kept.trim();
  // Emphasis left open by a dropped «**¿…?**» is not content.
  return /[\p{L}\p{N}]/u.test(kept) ? kept : '';
}

/** A closed question always gets a one-tap yes: when the model offered no quick
 * replies, this one answers answer.question as a person would type it. */
export const COWORK_YES_CHIP: CoworkSuggestion = { label: 'Sí, adelante', message: 'Sí, adelante.' };

/** The reply as it is kept and read back (history, copies, exports): it ends
 * with the closing question, which also travels apart so the chat can show it
 * next to the quick replies. */
export function polishCoworkAnswer<T extends { reply: string; document: { title: string; content: string } | null; question?: unknown; blocks?: unknown; suggestions?: unknown; choices?: unknown }>(
  answer: T,
): T & { question: string | null; blocks: CoworkBlock[] | null; suggestions: CoworkSuggestion[] | null; choices: CoworkChoices | null } {
  const suggestions = coworkSuggestions(answer.suggestions);
  const blocks = coworkBlocks(answer.blocks);
  const question = coworkQuestion(answer.question);
  // Options answer the closing question, so they need one; with them, the question is picked, not tapped «sí».
  const choices = question ? coworkChoices(answer.choices) : null;
  let reply = polishCoworkText(answer.reply).trimEnd();
  if (question) {
    const lines = reply.split('\n');
    let last = lines.length - 1;
    while (last >= 0 && !lines[last].trim()) last--;
    const closing = last >= 0 ? lines[last] : '';
    // One closing question (rule 4): a reply that already ends asking something
    // else gives way to answer.question instead of stacking two questions. Only
    // the asking sentences go; what the paragraph said before them stays.
    if (coworkSameLine(closing, question)) { /* already there */ }
    else if (/\?\W*$/.test(closing) && !/^\s*(?:[-*+]|\d+[.)])\s/.test(closing)) {
      lines[last] = withoutTrailingQuestions(closing);
      reply = [lines.join('\n').trimEnd(), question].filter(Boolean).join('\n\n');
    } else reply = `${reply}\n\n${question}`;
  }
  return {
    ...answer,
    reply,
    document: answer.document ? { ...answer.document, content: polishCoworkText(answer.document.content) } : null,
    question,
    blocks: blocks.length ? blocks : null,
    suggestions: choices ? null : suggestions.length ? suggestions : question ? [COWORK_YES_CHIP] : null,
    choices,
  };
}

/** Jargon the person should never have to decode. Used by the evaluation corpus. */
export const COWORK_JARGON: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bcobertura\b/i, label: 'habla de «cobertura»' },
  { pattern: /registros de la app/i, label: 'dice «registros de la app»' },
  { pattern: /dominio desnudo/i, label: 'dice «dominio desnudo»' },
  { pattern: /\bbarrido\b/i, label: 'dice «barrido»' },
  { pattern: /\bdenominador\b/i, label: 'dice «denominador»' },
  { pattern: /\b(?:scope|truncated|needs_verification|needs_review|do_not_contact|last_\d+_days|per_contact|contacted_leads)\b/i, label: 'muestra un código interno' },
  { pattern: /\b(?:leads|contacted|metrics|deliverability|campaigns|replies|linkedin|compliance)\.[a-z_]+\b/, label: 'nombra una herramienta' },
];

export type CoworkAnswerIssue = { code: string; detail: string };

/**
 * The explanatory style (plan 8, rule 8 of the instructions): from 120 to 350 words in the chat when there is
 * something to explain, in short paragraphs; the rest goes to the document. The checks leave some room over
 * the instruction (the closing question, a name more) and flag what a person would notice: a reply that belongs
 * in a document, a wall of text, or a greeting before the conclusion.
 */
export const COWORK_CHAT_WORDS = { max: 400, paragraph: 110 } as const;
// Followed by a comma or a stop («¡Claro!», «Perfecto, …», «Claro que sí»), so «Claro Chile contrata…» is not one.
const PREAMBLE = /^[\s¡!*]*(?:(?:hola|claro|por supuesto|perfecto|entendido|excelente|genial|buena pregunta|con gusto|de acuerdo)(?:\s*[,.!:;]|\s+que(?![\p{L}]))|gracias por)/iu;
const LIST_LINE = /^\s*(?:[-*•]|\d+[.)])\s/;
const wordCount = (text: string) => (text.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || []).length;

/** Structural checks for a reply: jargon, IDs, formatting and a clear next step. */
export function coworkAnswerIssues(reply: string, options: { expectNextStep?: boolean } = {}): CoworkAnswerIssue[] {
  const text = String(reply || '');
  const issues: CoworkAnswerIssue[] = [];
  for (const item of COWORK_JARGON) if (item.pattern.test(text)) issues.push({ code: 'jargon', detail: item.label });
  if (UUID.test(text)) issues.push({ code: 'uuid', detail: 'muestra un identificador interno' });
  if (/`[^`\s@]+@[^`\s@]+`/.test(text)) issues.push({ code: 'format', detail: 'correo con formato de código' });
  if (/\bUTC\b/.test(text)) issues.push({ code: 'timezone', detail: 'hora en UTC en vez de la hora local' });
  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length && PREAMBLE.test(lines[0])) issues.push({ code: 'preamble', detail: 'abre con un saludo o una muletilla en vez de la conclusión' });
  if (wordCount(text) > COWORK_CHAT_WORDS.max) issues.push({ code: 'length', detail: `más de ${COWORK_CHAT_WORDS.max} palabras en el chat: lo largo va al documento` });
  // A paragraph is the text between blank lines, without its list items.
  const paragraphs = text.split(/\n\s*\n/).map(block => block.split('\n').filter(line => line.trim() && !LIST_LINE.test(line)).join(' '));
  if (paragraphs.some(paragraph => wordCount(paragraph) > COWORK_CHAT_WORDS.paragraph)) {
    issues.push({ code: 'wall', detail: `un párrafo de más de ${COWORK_CHAT_WORDS.paragraph} palabras sin cortar` });
  }
  if (options.expectNextStep !== false) {
    const tail = lines.slice(-2).join(' ');
    if (!/[¿?]|\b(?:propongo|te propongo|si quieres|quieres que|aprueba|revisa la propuesta)\b/i.test(tail)) {
      issues.push({ code: 'next_step', detail: 'no cierra con un siguiente paso concreto' });
    }
  }
  return issues;
}
