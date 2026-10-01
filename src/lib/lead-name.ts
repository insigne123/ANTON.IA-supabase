/**
 * A person's name as it reaches ANTON.IA. The prospect search hides the surname («Rafael Du***n») until the email lookup
 * returns the real one, so every screen, search and draft has to know whether a name is complete. Pure: shared by the
 * browser, the server and the research (docs/contactos-identidad.md).
 */

const MASK = /\*{2,}/;

function clean(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function fold(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** True when the provider hid part of the name («Du***n»). */
export function isMaskedName(value: unknown): boolean {
  return MASK.test(clean(value));
}

/** The first name, when it is complete; null when there is none or it is hidden too. */
export function firstNameOf(value: unknown): string | null {
  const first = clean(value).split(' ')[0] || '';
  if (!first || MASK.test(first) || first.length < 2) return null;
  return first;
}

/** What a screen shows: the full name, or «Rafael D.» while the surname is hidden. */
export function displayLeadName(value: unknown): { text: string; masked: boolean } {
  const name = clean(value);
  if (!name) return { text: '', masked: false };
  if (!MASK.test(name)) return { text: name, masked: false };
  const [first, ...rest] = name.split(' ');
  const initials = rest.map((part) => part.replace(/\*+.*$/, '').charAt(0).toUpperCase()).filter(Boolean);
  const head = MASK.test(first) ? first.replace(/\*+.*$/, '') : first;
  return { text: [head, initials.length ? `${initials.join('. ')}.` : ''].filter(Boolean).join(' '), masked: true };
}

/** The first complete name among the candidates; if every one is hidden, the first non-empty (so nothing is lost). */
export function preferredFullName(...candidates: unknown[]): string | null {
  const names = candidates.map(clean).filter(Boolean);
  return names.find((name) => !MASK.test(name)) || names[0] || null;
}

/** A name, token by token: exact tokens, and the visible ends of a hidden one («Du***n» → starts «du», ends «n»). */
export type NameToken = { exact: string } | { prefix: string; suffix: string };

export function namePattern(value: unknown): NameToken[] {
  return clean(value).split(' ').filter(Boolean).map((token): NameToken => {
    const folded = fold(token);
    const match = folded.match(/^([\p{L}\p{N}'-]*)\*{2,}([\p{L}\p{N}'-]*)$/u);
    if (match) return { prefix: match[1], suffix: match[2] };
    return { exact: folded.replace(/[^\p{L}\p{N}]+/gu, '') };
  }).filter((token) => ('exact' in token ? token.exact.length > 0 : true));
}

function tokenMatches(word: string, token: NameToken) {
  if ('exact' in token) return word === token.exact;
  return word.length >= token.prefix.length + token.suffix.length + 1
    && word.startsWith(token.prefix) && word.endsWith(token.suffix);
}

/**
 * Whether a text names the person: the tokens of the name, in order. A hidden surname matches any word with the same
 * visible ends («Durán» for «Du***n»). The text is compared without accents or case.
 */
export function textNamesPerson(textValue: unknown, name: unknown): boolean {
  const pattern = namePattern(name);
  if (pattern.length < 2) return false;
  const words = fold(clean(textValue)).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.some((_, index) => pattern.every((token, offset) => {
    const word = words[index + offset];
    return Boolean(word) && tokenMatches(word, token);
  }));
}

const ROLE_MAILBOXES = new Set([
  'info', 'informaciones', 'contacto', 'contact', 'contactos', 'ventas', 'sales', 'hola', 'hello', 'admin', 'administracion',
  'rrhh', 'rh', 'hr', 'personas', 'recursos', 'recursoshumanos', 'gerencia', 'comercial', 'marketing', 'soporte', 'support',
  'noreply', 'no', 'reply', 'office', 'oficina', 'jobs', 'empleos', 'trabajo', 'postulaciones', 'seleccion', 'facturacion',
  'finanzas', 'operaciones', 'proyectos', 'cotizaciones', 'clientes', 'servicio', 'atencion', 'mail', 'correo', 'webmaster',
]);

export type EmailNameCheck = {
  /** match: the address carries the name; mismatch: it seems to be someone else's; unknown: nothing to compare. */
  verdict: 'match' | 'mismatch' | 'unknown';
  /** Why, in a sentence for the screen; null when it matches. */
  reason: string | null;
};

/**
 * Does this email look like the person's? Personal addresses usually carry the name («jcastro», «rafael.duran»). One
 * that carries another surname («rgodoy» for «Rafael Du***n») may belong to a colleague: it is a warning, never a block.
 */
export function checkEmailAgainstName(email: unknown, name: unknown): EmailNameCheck {
  const local = fold(clean(email).split('@')[0] || '');
  const pattern = namePattern(name);
  if (!local || pattern.length === 0) return { verdict: 'unknown', reason: null };
  const parts = local.split(/[._+\-\d]+/).filter(Boolean);
  if (parts.length === 0 || parts.every((part) => ROLE_MAILBOXES.has(part))) {
    return { verdict: 'unknown', reason: 'Es un buzón general de la empresa, no uno personal.' };
  }
  const joined = parts.join('');
  const [first, ...rest] = pattern;
  const surnames = rest.length ? rest : [];
  const firstInitial = 'exact' in first ? first.exact.charAt(0) : first.prefix.charAt(0);

  const containsToken = (token: NameToken) => {
    if ('exact' in token) return token.exact.length >= 3 && joined.includes(token.exact);
    if (token.prefix.length + token.suffix.length < 2) return false;
    // A hidden surname: some word of the address (or the address without its first initial) has its visible ends.
    const candidates = [...parts, joined, joined.slice(1)];
    return candidates.some((word) => tokenMatches(word, token))
      || parts.some((part) => part.length > 1 && part.charAt(0) === firstInitial && tokenMatches(part.slice(1), token));
  };

  if (pattern.some(containsToken)) return { verdict: 'match', reason: null };
  // Too short or too unlike a person's address to judge («ab12»).
  if (joined.length < 4) return { verdict: 'unknown', reason: null };
  if (surnames.length === 0) return { verdict: 'unknown', reason: null };
  return { verdict: 'mismatch', reason: `El correo «${clean(email)}» no lleva el nombre de esta persona: podría ser de otra. Revísalo antes de escribirle.` };
}
