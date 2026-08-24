export type ExtractedJson = {
  value: any;
  recovered: boolean;
};

function unwrapFence(raw: any) {
  let text = String(raw).trim();
  const backtick = String.fromCharCode(96);
  const fence = backtick.repeat(3);
  const first = text.indexOf(fence);

  if (first < 0) return text;

  let after = text.slice(first + fence.length);
  const newline = after.indexOf('\n');
  if (newline >= 0) after = after.slice(newline + 1);
  const second = after.indexOf(fence);
  text = second >= 0 ? after.slice(0, second) : after;
  return text.trim();
}

function recoverTruncatedJson(source: string) {
  const text = source.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return null;

  const stack: Array<'{' | '['> = [];
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  let stringIsObjectKey = false;
  let previousSignificant = '';

  for (let index = 0; index < text.length; index++) {
    const character = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
        previousSignificant = '"';
      }
      continue;
    }

    if (/\s/.test(character)) continue;

    if (character === '"') {
      inString = true;
      escaped = false;
      stringStart = index;
      stringIsObjectKey = stack[stack.length - 1] === '{' && (previousSignificant === '{' || previousSignificant === ',');
      continue;
    }

    if (character === '{' || character === '[') {
      stack.push(character);
    } else if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '[';
      if (stack.pop() !== expected) return null;
    }

    previousSignificant = character;
  }

  if (stack.length === 0) return null;

  let repaired = text;
  if (inString) {
    if (stringIsObjectKey) {
      repaired = text.slice(0, stringStart).trimEnd().replace(/,\s*$/, '');
    } else {
      // Never expose an incomplete generated value as if it were complete.
      repaired = `${text.slice(0, stringStart)}""`;
    }
  }

  repaired = repaired.trimEnd();
  if (repaired.endsWith(',')) repaired = repaired.slice(0, -1).trimEnd();
  if (repaired.endsWith(':')) repaired += ' null';

  for (let index = stack.length - 1; index >= 0; index--) {
    repaired += stack[index] === '{' ? '}' : ']';
  }

  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

export function extractJsonFromMaybeFencedDetailed(raw: any): ExtractedJson | null {
  if (raw == null) return null;
  const text = unwrapFence(raw);

  try {
    return { value: JSON.parse(text), recovered: false };
  } catch {
    const recovered = recoverTruncatedJson(text);
    return recovered == null ? null : { value: recovered, recovered: true };
  }
}

// Extrae JSON desde texto plano o fenced y recupera cortes al final de forma conservadora.
export function extractJsonFromMaybeFenced(raw: any): any | null {
  return extractJsonFromMaybeFencedDetailed(raw)?.value ?? null;
}
