/**
 * How the profile turns free text into lists. Pure and shared by the browser and the server, so «Perfil», the drafts and
 * Cowork read the same items (docs/perfil-comercial.md).
 */

const BULLET_PREFIX = /^\s*(?:[-*•·–—]|\d+[.)])\s+/;

function clean(value: unknown) {
  return String(value ?? '').replace(BULLET_PREFIX, '').replace(/\s+/g, ' ').trim();
}

function unique(items: string[], max: number) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = item.toLocaleLowerCase('es');
    if (!item || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= max) break;
  }
  return result;
}

/** One item per line (or bullet, or semicolon). For offers, proof and differentiators: an item may contain commas. */
export function lineItems(value: unknown, max = 50): string[] {
  if (Array.isArray(value)) return unique(value.map(clean), max);
  return unique(String(value ?? '').split(/\r?\n|;|\s[•·]\s/).map(clean), max);
}

/** Short names separated by commas or lines: roles, industries, places, client names. */
export function commaItems(value: unknown, max = 50): string[] {
  if (Array.isArray(value)) return unique(value.flatMap((item) => String(item ?? '').split(/,|\r?\n|;/)).map(clean), max);
  return unique(String(value ?? '').split(/,|\r?\n|;/).map(clean), max);
}

/**
 * Products and services as the drafts read them. Lines win. A single line splits on commas when every part is a short name
 * («Outsourcing, Selección, Nómina») or where the next part starts with a capital; a sentence with commas stays one service
 * instead of becoming fragments such as «logística» or «y agroindustria».
 */
export function offerItems(value: unknown, max = 50): string[] {
  if (Array.isArray(value)) return unique(value.map(clean), max);
  const lines = String(value ?? '').split(/\r?\n|;|\s[•·]\s/).map(clean).filter(Boolean);
  if (lines.length !== 1) return unique(lines, max);
  const parts = lines[0].split(',').map(clean).filter(Boolean);
  if (parts.every((part) => part.split(/\s+/).length <= 4)) return unique(parts, max);
  // After a comma, a capital starts another service («…en el PJUD, Carga por archivo»); a lower case continues the
  // sentence («…para retail, logística y agroindustria»).
  const items: string[] = [];
  for (const part of parts) {
    if (items.length === 0 || /^[A-ZÁÉÍÓÚÑ]/.test(part)) items.push(part);
    else items[items.length - 1] = `${items[items.length - 1]}, ${part}`;
  }
  return unique(items, max);
}

export function joinLines(items: string[]) {
  return items.join('\n');
}

export function joinComma(items: string[]) {
  return items.join(', ');
}
