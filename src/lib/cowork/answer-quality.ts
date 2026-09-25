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

export function polishCoworkAnswer<T extends { reply: string; document: { title: string; content: string } | null }>(answer: T): T {
  return {
    ...answer,
    reply: polishCoworkText(answer.reply),
    document: answer.document ? { ...answer.document, content: polishCoworkText(answer.document.content) } : null,
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
