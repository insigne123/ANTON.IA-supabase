import { COWORK_BLOCK_LIMIT, COWORK_SUGGESTION_LIMITS, coworkBlockSchema, coworkSameLine, type CoworkBlock, type CoworkSuggestion } from './contracts';
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
      || COWORK_DEFERRAL.test(message)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ label, message });
    if (kept.length === COWORK_SUGGESTION_LIMITS.count) break;
  }
  return kept;
}

/** What a card shows at most; longer results belong in a document or an export. */
export const COWORK_BLOCK_DISPLAY = { steps: 7, columns: 8, rows: 50, metrics: 6, recipients: 25 } as const;

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
    } else {
      const items = block.items.map(item => ({ label: visible(item.label, 60), value: visible(item.value, 40), detail: item.detail ? visible(item.detail, 140) || null : null }))
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
function withoutTrailingQuestions(line: string): string {
  const sentences = line.match(/[^.!?…]+[.!?…]+[^\p{L}\p{N}¿¡(«"]*|[^.!?…]+$/gu) || [line];
  while (sentences.length && /\?[^\p{L}\p{N}]*$/u.test(sentences[sentences.length - 1])) sentences.pop();
  const kept = sentences.join('').trim();
  // Emphasis left open by a dropped «**¿…?**» is not content.
  return /[\p{L}\p{N}]/u.test(kept) ? kept : '';
}

/** A closed question always gets a one-tap yes: when the model offered no quick
 * replies, this one answers answer.question as a person would type it. */
export const COWORK_YES_CHIP: CoworkSuggestion = { label: 'Sí, adelante', message: 'Sí, adelante.' };

/** The reply as it is kept and read back (history, copies, exports): it ends
 * with the closing question, which also travels apart so the chat can show it
 * next to the quick replies. */
export function polishCoworkAnswer<T extends { reply: string; document: { title: string; content: string } | null; question?: unknown; blocks?: unknown; suggestions?: unknown }>(
  answer: T,
): T & { question: string | null; blocks: CoworkBlock[] | null; suggestions: CoworkSuggestion[] | null } {
  const suggestions = coworkSuggestions(answer.suggestions);
  const blocks = coworkBlocks(answer.blocks);
  const question = coworkQuestion(answer.question);
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
    suggestions: suggestions.length ? suggestions : question ? [COWORK_YES_CHIP] : null,
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

/** Structural checks for a reply: jargon, IDs, formatting and a clear next step. */
export function coworkAnswerIssues(reply: string, options: { expectNextStep?: boolean } = {}): CoworkAnswerIssue[] {
  const text = String(reply || '');
  const issues: CoworkAnswerIssue[] = [];
  for (const item of COWORK_JARGON) if (item.pattern.test(text)) issues.push({ code: 'jargon', detail: item.label });
  if (UUID.test(text)) issues.push({ code: 'uuid', detail: 'muestra un identificador interno' });
  if (/`[^`\s@]+@[^`\s@]+`/.test(text)) issues.push({ code: 'format', detail: 'correo con formato de código' });
  if (/\bUTC\b/.test(text)) issues.push({ code: 'timezone', detail: 'hora en UTC en vez de la hora local' });
  const lines = text.split('\n').filter(line => line.trim());
  const leadLines = lines.findIndex(line => /^\s*(?:[-*]|\d+\.)\s/.test(line));
  if ((leadLines === -1 ? lines.length : leadLines) > 6) issues.push({ code: 'length', detail: 'más de 5 líneas antes de ir al punto' });
  if (options.expectNextStep !== false) {
    const tail = lines.slice(-2).join(' ');
    if (!/[¿?]|\b(?:propongo|te propongo|si quieres|quieres que|aprueba|revisa la propuesta)\b/i.test(tail)) {
      issues.push({ code: 'next_step', detail: 'no cierra con un siguiente paso concreto' });
    }
  }
  return issues;
}
