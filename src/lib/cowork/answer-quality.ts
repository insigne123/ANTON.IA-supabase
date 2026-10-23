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

// A tool name copied into the text (round 4: «propongo lead.enrich» in a reply), said in the person's words. A web address or an email
// is not one: «https://www.linkedin.com/in/ana-ruiz/» in a table read «https://www.esa acción/in/ana-ruiz/».
const TOOL_NAME = /(?<![\w.@/:-])([*_`]?)\b((?:lead|leads|contacts|research|draft|campaign|campaigns|contacted|linkedin|profile|crm|lists|message|prospecting|saved_search|email)\.(?!(?:com|cl|net|org|io|es)\b)[a-z_]+)\b\1(?![\w.@/-])/g;
const TOOL_WORDS: Array<[RegExp, string]> = [
  [/^(?:lead\.enrich(?:_batch)?|contacts\.prepare_batch)$/, 'la búsqueda de su correo'], [/^research\./, 'la investigación'],
  [/^linkedin\.invite/, 'la invitación de LinkedIn'], [/^linkedin\.message/, 'el mensaje de LinkedIn'], [/^campaigns?\./, 'la campaña'],
  [/^(?:leads|contacts|lists)\./, 'tus contactos'], [/^(?:draft|email)\./, 'el correo'], [/^prospecting\./, 'la búsqueda de prospectos'],
];
const toolWords = (name: string) => TOOL_WORDS.find(([pattern]) => pattern.test(name))?.[1] ?? 'esa acción';

// The sender is named as the person knows it: Gmail, not the provider code «google» (round 9: «Usé Google como remitente» next to a
// card that said Gmail).
const GOOGLE_SENDER = /\bGoogle\b(?=\s+(?:como|de)\s+remitente)|(?<=\b(?:desde|remitente:?|v[ií]a|con tu cuenta de|tu cuenta de)\s+)Google\b(?!\s+(?:Sheets|Drive|Calendar|Meet|Workspace|Ads|Maps|Analytics|Docs))/g;

const STRAY_BRAND_TAIL = /(\p{Ll}{3,})\.IA\.(?=\s|$)/gu;

export function polishCoworkText(text: string): string {
  return outsideCode(String(text || ''), chunk => chunk
    .replace(CODE_PATTERN, (_match, _wrap, code: string) => COWORK_GLOSSARY[code] || code)
    .replace(TOOL_NAME, (_match, _wrap, name: string) => toolWords(name))
    .replace(CODE_EMAIL, '$1')
    .replace(ID_IN_PARENS, '')
    .replace(GOOGLE_SENDER, 'Gmail')
    // A brand's tail left after a word («podría ser pertinente.IA.», round 24): «ANTON.IA» stays.
    .replace(STRAY_BRAND_TAIL, '$1.'));
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
        .filter(step => step.body && !UUID.test(step.body))
        .sort((a, b) => a.day - b.day)
        .slice(0, COWORK_BLOCK_DISPLAY.steps);
      if (!steps.length) continue;
      const title = visible(block.title, 120);
      if (block.type === 'email_draft' || steps.length === 1) {
        const to = (block.type === 'email_draft' ? block.to || [] : []).map(value => visible(value, 160)).filter(Boolean).slice(0, COWORK_BLOCK_DISPLAY.recipients);
        blocks.push({ type: 'email_draft', title: title || steps[0].subject || 'Correo', to: to.length ? to : null, subject: steps[0].subject, body: steps[0].body });
      } else {
        blocks.push({ type: 'sequence', title: title || `Secuencia de ${steps.length} correos`, steps });
      }
    } else if (block.type === 'table') {
      // Preserve the bounded result; preview density is a rendering concern, never an export transform.
      const columns = block.columns.map((column, index) => visible(column, 120) || `Columna ${index + 1}`);
      const rows = block.rows.map(row => columns.map((_, index) => visible(row[index], 1000)))
        .filter(row => row.some(Boolean));
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
  let text = polishCoworkText(String(value ?? '')).replace(/\s+/g, ' ').trim().replace(/^(?:\*\*)(.+)(?:\*\*)$/, '$1').trim();
  // A question followed by what it means («¿Te lo dejo listo…? Queda en pausa hasta que lo actives.»): the question is the closing.
  const asked = /^(¿[^?]{3,}\?)\s+[^?¿]{3,}[.!]$/u.exec(text);
  if (asked) text = asked[1];
  // A yes is a reply, not a question (round 25: «¿Sí, déjalo listo para enviarle a Daniela?»).
  if (/^¿?\s*sí[,!]?\s/iu.test(text)) return null;
  if (text.length < 4 || text.length > 300 || UUID.test(text) || !/\?$/.test(text) || /\[[^\]]{2,}\]/.test(text)) return null;
  // «¿» opens a Spanish question only (round 25: «¿Should I prepare the first emails…?»).
  if (/^(?:should|would|could|can|do|does|did|shall|will|is|are|was|were|have|has|may|what|how|who|which|when|where|why|want|ready|quer|posso|devo|voc[êe]|vamos|podemos)\b/i.test(text)) return text;
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
  // «…confirmar la reunión; ¿te propongo…?» leaves «…reunión;»: the sentence ends with a period, not with what joined it to the
  // question (round g1, 16 Oct 2026: three answers ended in «;»).
  kept = kept.trim().replace(/\s*[;:,—–-]+$/u, '.');
  // Emphasis left open by a dropped «**¿…?**» is not content.
  return /[\p{L}\p{N}]/u.test(kept) ? kept : '';
}

/**
 * «Por cierto, …» is the aside about what the person should not miss today (workspace.ts): it names someone the answer has not
 * named. When the answer already talked about that person («¿Qué toca hoy?» with Marcela in the table), the aside only repeats it
 * (Plan 15: the judge marked it «mala»), so it goes; `always` takes it out whoever it names (the turn read today's agenda). Only
 * an aside that closes its line, so nothing after it is cut.
 */
export function withoutRepeatedAside(reply: string, elsewhere = '', always = false): string {
  const match = /(?:Por cierto|By the way),\s*([^\n]*?[.!?])(?=[ \t]*(?:\n|$|¿))/u.exec(reply);
  if (!match) return reply;
  if (!always) {
    const before = `${reply.slice(0, match.index)}\n${elsewhere}`;
    const name = (match[1].match(/\p{Lu}\p{Ll}{2,}(?:\s+\p{Lu}\p{Ll}+)*/gu) || [])[0];
    if (!name || !before.includes(name)) return reply;
  }
  const head = reply.slice(0, match.index).replace(/[ \t]+$/, '');
  const tail = reply.slice(match.index + match[0].length).replace(/^[ \t]+/, '');
  const joined = head && tail && !head.endsWith('\n') && !tail.startsWith('\n') ? `${head} ${tail}` : `${head}${tail}`;
  return joined.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// «…, sin asumir que lo necesiten», «sin atribuirles un problema», «sin dar por hecho cómo trabajan»: what the answer avoided
// supposing, said out loud. Rule 3 asks not to explain prudence; the clause goes up to its comma, semicolon or stop, or to an «y» with
// the next verb («sin asumir que lo recibió y combina…» keeps «y combina…»).
const CAVEAT = /,?[ \t]+sin (?:asumir|suponer|presumir|dar por (?:hecho|sentad[oa]s?|confirmad[oa]s?)|atribuir(?:le|les)?)\b[^.;,:\n?!]*?(?=[.;,:\n?!]|$| y \p{Ll}{3,}(?:a|e|é|ó)\b)/giu;

// A sentence about what the history read cannot confirm («El historial consultado no confirma la bandeja completa», «La cronología
// revisada para Rodrigo tampoco confirma envíos»): round 18 readings called it «críptica» and «ruido».
const HISTORY_CAVEAT = /(?:^|(?<=[.!?])[ \t]+)[^.!?\n]*\b(?:historial|cronolog[íi]a)\b[^.!?\n]*\b(?:no|tampoco) (?:confirma|permite confirmar)\b[^.!?\n]*[.!?]/giu;

/** The reply without the clauses that only say what it avoided supposing (rule 3). A sentence that is only that stays. */
export function withoutCaveats(reply: string): string {
  return reply.split('\n').map(line => {
    const unhedged = line.replace(HISTORY_CAVEAT, '').trim();
    if (unhedged !== line.trim() && /[\p{L}]{3,}.*[\p{L}]{3,}/u.test(unhedged)) line = unhedged;
    const cleaned = line.replace(CAVEAT, '').replace(/\s+([.;,])/g, '$1').replace(/,\s*\./g, '.').replace(/[ \t]{2,}/g, ' ');
    // A clause that was the whole sentence leaves too little: keep the line as it was.
    return /[\p{L}]{3,}.*[\p{L}]{3,}/u.test(cleaned.replace(/^[\s*•-]+/, '')) ? cleaned.trimEnd() : line;
  }).join('\n');
}

// A closing scope note in a document («*Alcance: cifras al 25 sep 2026; envíos de los últimos 30 días.*», or a last «## Alcance»
// section): the period goes next to each figure (the rule on documents), and a note apart reads as caveats in a report for the
// boss. Only at the end: the note must be the last paragraph, and an «## Alcance» section with more sections after it stays.
const SCOPE_NOTE = /\n{2,}(?:[*_]{0,2}Alcance[*_]{0,2}[ \t]*:[^\n]*(?:\n(?![ \t]*\n)[^\n]*)*\s*|#{2,3}[ \t]+Alcance[ \t]*\n(?:(?!\n#{1,3}[ \t])[\s\S])*)$/u;

/** The document without its closing scope note (and the rule before it). A document that is only that note stays as it was. */
export function withoutScopeNote(content: string): string {
  const cleaned = content.replace(SCOPE_NOTE, '').replace(/\n+-{3,}[ \t]*$/, '').trimEnd();
  return cleaned === content.trimEnd() || !/[\p{L}]{3,}/u.test(cleaned) ? content : cleaned;
}

// An offer of the next step: «puedo preparar…», «el próximo paso es…».
// «Conviene…» is not one: it is the recommendation the person asked for («¿qué mejoro?»).
const OFFER = /^(?:para partir,\s*)?(?:te\s+)?(?:puedo|podemos|podr[ií]a|el (?:pr[oó]ximo|siguiente) paso(?: m[aá]s concreto)? es|lo que har[ií]a (?:ahora )?es)\b/iu;
const OFFER_STOP = new Set(['para', 'tus', 'con', 'que', 'una', 'uno', 'los', 'las', 'del', 'por', 'sin', 'hasta', 'esta', 'este', 'ellos', 'ellas', 'puedo', 'podemos', 'conviene']);
const offerStems = (text: string) => new Set((text.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-zñ]{3,}/g) || [])
  .filter(word => !OFFER_STOP.has(word)).map(word => word.slice(0, 4)));

/**
 * The closing question already offers the next step (rule 4): the reply does not offer it again just before («…4 tienen correo; puedo
 * preparar una primera campaña para ellos.» and «¿Te preparo una primera campaña…?»). Only in the last paragraph, only the clause that
 * offers (a sentence, or what follows «;» or «así que»), and only when the question covers it: two words in common and every name
 * it says (a clause that adds another person keeps it). A reply is never left empty.
 */
export function withoutRepeatedOffer(reply: string, question: string): string {
  const asked = offerStems(question);
  const paragraphs = reply.split(/\n{2,}/);
  // The last paragraph that is not a question: the reply often ends with the closing question already.
  let index = paragraphs.length - 1;
  while (index > 0 && /\?\W*$/u.test(paragraphs[index].trim())) index--;
  // An abbreviation in capitals («RR. HH.», «S. A.») does not end a sentence: its periods are kept apart while splitting.
  const guarded = paragraphs[index].replace(/\b(\p{Lu}{1,3})\.(?=\s*\p{Lu}{1,3}\.|\s+\p{Ll})/gu, '$1\u2024');
  const sentences = guarded.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) || [guarded];
  // Only text split exactly into its sentences is touched.
  if (sentences.join('') !== guarded) return reply;
  for (let at = sentences.length - 1; at >= 0; at--) {
    const sentence = sentences[at];
    const parts = sentence.trimEnd().split(/(;\s*|,?\s+así que\s+)/u);
    for (let part = 0; part < parts.length; part += 2) {
      const clause = parts[part].trim().replace(/[.!?]+$/, '');
      if (!OFFER.test(clause)) continue;
      const shared = [...offerStems(clause)].filter(stem => asked.has(stem)).length;
      const names = clause.slice(1).match(/\p{Lu}\p{Ll}{2,}/gu) || [];
      if (shared < 2 || names.some(name => !question.includes(name))) continue;
      const before = parts.slice(0, Math.max(0, part - 1)).join('').trim().replace(/[,;:]$/, '');
      const after = parts.slice(part + 2).join('').trim().replace(/[.!?]+$/, '');
      // What follows leans on the offer («…; después, si te sirve, …», «…; nada se envía hasta que la actives»): without it, it would hang.
      if (/^(?:despu[eé]s|luego|y|adem[aá]s|entonces|as[ií])\b/iu.test(after)) continue;
      if (!before && after && !/\b(?:campañas?|correos?|secuencias?|seguimientos?|invitaci[oó]n|mensajes?)\b/iu.test(after)) continue;
      const rest = [before, after].filter(Boolean).join('; ');
      sentences[at] = rest ? `${rest.charAt(0).toLocaleUpperCase('es')}${rest.slice(1)}.${/\s$/.test(sentence) ? ' ' : ''}` : '';
      paragraphs[index] = sentences.join('').trim().replace(/\u2024/g, '.');
      const result = paragraphs.filter(paragraph => paragraph.trim()).join('\n\n');
      return /[\p{L}]{3,}/u.test(result) ? result : reply;
    }
  }
  return reply;
}

const PIPE_ROW = /^\s*\|.*\|\s*$/;
const PIPE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const pipeCells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());

/**
 * A Markdown table written in the reply (Plan 15). The table block is the card the person copies and downloads; written in the
 * text it shows as raw «| --- |» and, next to the card, says everything twice. With a table block already, the copy in the text
 * goes; without one, the first table becomes the block.
 */
export function withTablesAsBlocks(reply: string, blocks: CoworkBlock[]): { reply: string; blocks: CoworkBlock[] } {
  // Code is shown as written.
  if (reply.includes('```')) return { reply, blocks };
  const lines = reply.split('\n');
  const kept: string[] = [];
  const next = [...blocks];
  const identity = (table: Extract<CoworkBlock, { type: 'table' }>) => JSON.stringify([table.columns, table.rows]);
  let found = false;
  for (let index = 0; index < lines.length; index++) {
    if (PIPE_ROW.test(lines[index]) && PIPE_RULE.test(lines[index + 1] || '')) {
      let end = index + 2;
      while (end < lines.length && PIPE_ROW.test(lines[end])) end++;
      found = true;
      const columns = pipeCells(lines[index]);
      const rows = lines.slice(index + 2, end).map(pipeCells);
      const made = coworkBlocks([{ type: 'table', title: 'Tabla', columns, rows }])[0];
      const complete = made?.type === 'table' && made.rows.length === rows.length && made.columns.length === columns.length;
      const duplicate = complete && next.some(block => block.type === 'table' && identity(block) === identity(made));
      if (!duplicate && complete && next.length < COWORK_BLOCK_LIMIT) next.push(made);
      else if (!duplicate) kept.push(...lines.slice(index, end));
      index = end - 1;
      continue;
    }
    kept.push(lines[index]);
  }
  if (!found) return { reply, blocks };
  const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { reply: text, blocks: next };
}

/** A closed question always gets a one-tap yes: when the model offered no quick
 * replies, this one answers answer.question as a person would type it. */
export const COWORK_YES_CHIP: CoworkSuggestion = { label: 'Sí, adelante', message: 'Sí, adelante.' };

// A yes that says what it does (round 9: a bare «Sí» under «¿Creo la campaña pausada con los dos correos?» did not say what it creates).
const BARE_YES = /^\s*(?:s[íi]|s[íi],?\s+adelante|ok|dale)[.!]?\s*$/iu;
// A quick reply that already says yes to the closing question, in words or by doing it.
const SAYS_YES_CHIP = /^\s*(?:s[íi]|dale|ok|cr[ée]a|crear|escr[íi]b|redact|prep[áa]r|busca|buscar)/iu;
/** The closing question offers a campaign or an email and no quick reply takes it: its yes goes first (round 11: «pregunta si lo usa
 * en una campaña y no ofrece botón para eso»). Other questions (either/or, open) keep their replies as they are. */
function withOfferChip(chips: CoworkSuggestion[], question: string | null): CoworkSuggestion[] {
  if (!question || chips.some(chip => SAYS_YES_CHIP.test(chip.label))) return chips;
  const yes = namedYes(COWORK_YES_CHIP, question);
  return yes === COWORK_YES_CHIP ? chips : [yes, ...chips].slice(0, 4);
}

// A yes with nothing asked reads as the action itself (round 12: «Sí, prepara el correo» under no question).
const LEADING_YES = /^\s*s[íi],?\s+/iu;
const capital = (text: string) => text.charAt(0).toLocaleUpperCase('es') + text.slice(1);

// A question a yes does not answer: it asks for something («¿Qué producto ofreces?») or offers a pick («¿Hoy o mañana?»).
const OPEN_QUESTION = /^[\s¿]*(?:(?:a|con|de|en|para|por)\s+)?(?:qu[ée](?!\s+(?:te\s+parece|tal\s+si))|cu[áa]l(?:es)?|c[óo]mo|qui[ée]n(?:es)?|d[óo]nde|cu[áa]nt[oa]s?|cu[áa]ndo)(?!\p{L})/iu;
const EITHER_OR = /(?<!\p{L})o(?!\p{L})[^?]*\?\s*$/u;
/** Whether a one-tap yes answers the closing question (round 25: «Sí, adelante» under «¿Qué problema necesitas resolver?»). */
export const coworkYesAnswers = (question: string | null) => Boolean(question && !OPEN_QUESTION.test(question) && !EITHER_OR.test(question));

/** The quick replies as the person reads them: a yes needs a question to answer, and one offer takes one reply. */
function quickReplies(chips: CoworkSuggestion[], question: string | null, reply: string): CoworkSuggestion[] {
  if ((!question && !/\?\s*$/.test(reply)) || (question && !coworkYesAnswers(question))) {
    return chips.filter(chip => !BARE_YES.test(chip.label)).map(chip => LEADING_YES.test(chip.label)
      ? { label: capital(chip.label.replace(LEADING_YES, '')), message: capital(chip.message.replace(LEADING_YES, '')) } : chip);
  }
  // Two replies that take the same offer (round 12: «Sí, escríbelo» next to «Preparar primer correo»): the one that says what it
  // does stays.
  const asked = question ?? reply.split('\n').at(-1) ?? '';
  const offersCampaign = /campa[ñn]a/i.test(asked);
  const offersEmail = !offersCampaign && /\b(?:escrib|redact|prepar)\w*\b[^?]*\bcorreos?\b/i.test(asked);
  const takes = (label: string) => offersCampaign ? /^\s*cr[ée]a(?:r|la)?\b/iu.test(label) && /campa[ñn]a/i.test(label)
    : offersEmail && /^\s*(?:escr[íi]b|redact|prep[áa]r)/iu.test(label);
  const kept = chips.some(chip => takes(chip.label)) ? chips.filter(chip => !BARE_YES.test(chip.label)) : chips;
  return withOfferChip(kept.map(chip => namedYes(chip, question)), question);
}

function namedYes(chip: CoworkSuggestion, question: string | null): CoworkSuggestion {
  if (!question || !BARE_YES.test(chip.label)) return chip;
  // With its follow-up, the yes says both emails go in (round 12: «¿Creo la campaña pausada para Daniela?» did not say it).
  if (/campa[ñn]a/i.test(question) && /\b(?:dos correos|seguimiento)\b/i.test(question)) return { ...chip, label: 'Sí, crear la campaña con los dos correos' };
  if (/campa[ñn]a/i.test(question)) return { ...chip, label: 'Sí, crear la campaña' };
  if (/\b(?:escrib|redact|prepar)\w*\b[^?]*\bcorreos?\b/i.test(question)) return { ...chip, label: 'Sí, escríbelo' };
  return chip;
}

const nullIfEmpty = <T,>(items: T[]) => items.length ? items : null;

/** A table of one row that the reply already tells («Pendientes de hoy» with the four names in one cell, round 24): it only repeats
 * the text. Its longest cell's first two words in the reply are the sign. */
function restatedRow(block: CoworkBlock, reply: string): boolean {
  if (block.type !== 'table' || block.rows.length !== 1) return false;
  const longest = [...block.rows[0]].sort((a, b) => b.length - a.length)[0] || '';
  const lead = longest.match(/\p{L}+/gu)?.slice(0, 2).join(' ');
  return Boolean(lead && lead.length >= 6 && new RegExp(`(?<!\\p{L})${lead.replace(/ /g, '\\s+')}(?!\\p{L})`, 'u').test(reply));
}

/** The reply as it is kept and read back (history, copies, exports): it ends
 * with the closing question, which also travels apart so the chat can show it
 * next to the quick replies. */
export function polishCoworkAnswer<T extends { reply: string; document: { title: string; content: string } | null; question?: unknown; blocks?: unknown; suggestions?: unknown; choices?: unknown }>(
  answer: T,
): T & { question: string | null; blocks: CoworkBlock[] | null; suggestions: CoworkSuggestion[] | null; choices: CoworkChoices | null } {
  const suggestions = coworkSuggestions(answer.suggestions);
  const tabled = withTablesAsBlocks(polishCoworkText(answer.reply).trimEnd(), coworkBlocks(answer.blocks));
  const blocks = tabled.blocks.filter(block => !restatedRow(block, tabled.reply));
  const question = coworkQuestion(answer.question);
  // Options answer the closing question, so they need one; with them, the question is picked, not tapped «sí».
  const choices = question ? coworkChoices(answer.choices) : null;
  let reply = withoutCaveats(withoutRepeatedAside(tabled.reply, blocks.length ? JSON.stringify(blocks) : ''));
  if (question) reply = withoutRepeatedOffer(reply, question);
  if (question) {
    const lines = reply.split('\n');
    let last = lines.length - 1;
    while (last >= 0 && !lines[last].trim()) last--;
    const closing = last >= 0 ? lines[last] : '';
    // One closing question (rule 4): a reply that already ends asking something
    // else gives way to answer.question instead of stacking two questions. Only
    // the asking sentences go; what the paragraph said before them stays.
    // The question already asked inside the reply, followed by what it means («¿Te preparo la campaña…? Queda guardada sin
    // enviar.», round 24): it is asked once, at the end.
    const inside = reply.indexOf(question.trim());
    if (!coworkSameLine(closing, question) && inside >= 0) {
      reply = (reply.slice(0, inside) + reply.slice(inside + question.trim().length)).replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
      lines.splice(0, lines.length, ...reply.split('\n'));
      last = lines.length - 1;
      while (last >= 0 && !lines[last].trim()) last--;
    }
    const end = last >= 0 ? lines[last] : '';
    if (coworkSameLine(end, question)) { /* already there */ }
    else if (/\?\W*$/.test(end) && !/^\s*(?:[-*+]|\d+[.)])\s/.test(end)) {
      lines[last] = withoutTrailingQuestions(end);
      reply = [lines.join('\n').trimEnd(), question].filter(Boolean).join('\n\n');
    } else reply = `${reply}\n\n${question}`;
  }
  return {
    ...answer,
    reply,
    document: answer.document ? { ...answer.document, content: withoutScopeNote(polishCoworkText(answer.document.content)) } : null,
    question,
    blocks: blocks.length ? blocks : null,
    suggestions: choices ? null : suggestions.length ? nullIfEmpty(quickReplies(suggestions, question, reply))
      : coworkYesAnswers(question) ? [namedYes(COWORK_YES_CHIP, question)] : null,
    choices,
  };
}

// A goodbye with nothing else asked (round 25: «gracias, eso era todo. chao!» got «¿Preparo los primeros correos…?» and its button).
const FAREWELL = /(?<!\p{L})(?:chao|chau|adi[oó]s|hasta (?:luego|ma[ñn]ana|pronto|el lunes)|nos vemos|bye|eso (?:era|es|ser[ií]a) todo|nada m[aá]s por (?:hoy|ahora))(?!\p{L})/iu;
export const coworkIsFarewell = (message: string) => message.trim().length <= 80 && !message.includes('?') && FAREWELL.test(message);

/** The answer to a goodbye: what it says, without a closing question, quick replies or options. */
export function coworkAsFarewell<T extends { reply: string; question: string | null; suggestions: unknown; choices: unknown }>(answer: T): T {
  const question = answer.question?.trim();
  const reply = question && answer.reply.trimEnd().endsWith(question) ? answer.reply.trimEnd().slice(0, -question.length).trimEnd() : answer.reply;
  return { ...answer, reply: reply || answer.reply, question: null, suggestions: null, choices: null };
}

// «Cancela eso» typed while a proposal waits (round 25: it waited in the queue, «Se enviará cuando resuelvas la propuesta», and the
// proposal stayed): it discards the proposal, as «Descartar» does.
const CANCELS = /^(?:no[,.!]?\s*)?(?:cancel(?:a|ar|alo|ala|ado)|desc[áa]rt(?:a|ar|alo|ala)|olv[íi]d(?:alo|ala|a eso)|mejor no|d[ée]jalo(?: as[íi])?|no lo hagas|no la crees|an[úu]la(?:lo|la)?|detenlo|para eso)(?:\s+(?:eso|esto|la propuesta|la campa[ñn]a|todo|por ahora|mejor))*\s*[.!]*$/iu;
export const coworkCancelsProposal = (message: string) => CANCELS.test(message.trim());

// A message for another channel, asked by name: WhatsApp, a text message (round 25: «conviértelo en un mensaje de WhatsApp» came back
// as an email card with a subject and a three-line signature, twice).
const CHAT_CHANNEL = /\b(?:whats\s?app|wsp|wasap|sms|mensaje de texto)\b/iu;
const SIGN_OFF_LINE = /^(?:saludos(?: cordiales)?|un saludo|atentamente|cordialmente|abrazo|un abrazo|gracias|best(?: regards)?|regards|atenciosamente)[,.!]?\s*$/iu;
export const coworkAsksChatMessage = (message: string) => CHAT_CHANNEL.test(message) && !/\bcorreo\b|\bmail\b/iu.test(message);

/** The answer to a chat-message request: the email card becomes the message itself, without subject, sign-off or signature, as a
 * document to copy; a campaign is not its next step. */
export function coworkAsChatMessage<T extends { reply: string; document: { title: string; content: string } | null; question: string | null; blocks: CoworkBlock[] | null; suggestions: CoworkSuggestion[] | null }>(answer: T, signer: string | null = null): T {
  const draft = answer.blocks?.find(block => block.type === 'email_draft' && !(block.to?.length));
  if (!draft || draft.type !== 'email_draft' || answer.document) return answer;
  const lines = draft.body.trim().split('\n');
  const end = lines.findIndex(line => SIGN_OFF_LINE.test(line.trim()));
  let kept = (end >= 0 ? lines.slice(0, end) : lines).join('\n').trim();
  // Without the sign-off, the signer's full name may still close it: a chat message is signed, at most, with the first name.
  const first = (signer || '').trim().split(/\s+/)[0];
  if (end >= 0 && first && !kept.includes(first)) kept = `${kept}\n\n${first}`;
  const campaign = (text: string | null | undefined) => /campa[ñn]a|correo/iu.test(text || '');
  return {
    ...answer,
    document: { title: draft.title.replace(/^correo\b/iu, 'Mensaje') || 'Mensaje', content: kept },
    blocks: answer.blocks!.filter(block => block !== draft).length ? answer.blocks!.filter(block => block !== draft) : null,
    question: campaign(answer.question) ? null : answer.question,
    reply: campaign(answer.question) && answer.question && answer.reply.trimEnd().endsWith(answer.question.trim())
      ? answer.reply.trimEnd().slice(0, -answer.question.trim().length).trimEnd() : answer.reply,
    suggestions: answer.suggestions?.filter(chip => !campaign(chip.label)) ?? null,
  };
}

/** Jargon the person should never have to decode. Used by the evaluation corpus. */
export const COWORK_JARGON: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bcobertura\b(?:\s+(?:del?|de los|de las))?\s+(?:Gmail|Outlook|correo|buz[oó]n|LinkedIn)\b/i, label: 'expone la cobertura técnica del correo' },
  { pattern: /registros de la app/i, label: 'dice «registros de la app»' },
  { pattern: /dominio desnudo/i, label: 'dice «dominio desnudo»' },
  { pattern: /\bbarrido\b/i, label: 'dice «barrido»' },
  { pattern: /\bdenominador\b/i, label: 'dice «denominador»' },
  { pattern: /\b(?:scope|truncated|needs_verification|needs_review|do_not_contact|last_\d+_days|per_contact|contacted_leads)\b/i, label: 'muestra un código interno' },
  // A tool is «linkedin.quota»; «linkedin.com» is a site, and a web answer is full of them.
  { pattern: /\b(?:leads|contacted|metrics|deliverability|campaigns|replies|linkedin|compliance)\.(?!(?:com|cl)\b)[a-z_]+\b/, label: 'nombra una herramienta' },
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
  // A link shows its label, not its address: a path («/jobs/», an id in a query) is not what the person reads, so the address is left out of these checks.
  const read = text.replace(/\]\([^)\s]*\)/g, ']').replace(/https?:\/\/[^\s)\]>"']+/gi, ' ');
  for (const item of COWORK_JARGON) if (item.pattern.test(read)) issues.push({ code: 'jargon', detail: item.label });
  if (UUID.test(read)) issues.push({ code: 'uuid', detail: 'muestra un identificador interno' });
  if (/`[^`\s@]+@[^`\s@]+`/.test(read)) issues.push({ code: 'format', detail: 'correo con formato de código' });
  if (/\bUTC\b/.test(read)) issues.push({ code: 'timezone', detail: 'hora en UTC en vez de la hora local' });
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
