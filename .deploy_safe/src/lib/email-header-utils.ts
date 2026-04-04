const MOJIBAKE_MARKER_REGEX = /(Ã.|Â.|â.)/g;

const CP1252_FIXUPS: Array<[string, number]> = [
  ['€', 0x80],
  ['‚', 0x82],
  ['ƒ', 0x83],
  ['„', 0x84],
  ['…', 0x85],
  ['†', 0x86],
  ['‡', 0x87],
  ['ˆ', 0x88],
  ['‰', 0x89],
  ['Š', 0x8a],
  ['‹', 0x8b],
  ['Œ', 0x8c],
  ['Ž', 0x8e],
  ['‘', 0x91],
  ['’', 0x92],
  ['“', 0x93],
  ['”', 0x94],
  ['•', 0x95],
  ['–', 0x96],
  ['—', 0x97],
  ['˜', 0x98],
  ['™', 0x99],
  ['š', 0x9a],
  ['›', 0x9b],
  ['œ', 0x9c],
  ['ž', 0x9e],
  ['Ÿ', 0x9f],
];

function normalizeCp1252Glyphs(value: string): string {
  let out = value;
  for (const [glyph, byteValue] of CP1252_FIXUPS) {
    if (!out.includes(glyph)) continue;
    out = out.split(glyph).join(String.fromCharCode(byteValue));
  }
  return out;
}

function mojibakeScore(value: string): number {
  return (value.match(MOJIBAKE_MARKER_REGEX) || []).length;
}

function tryLatin1ToUtf8(value: string): string {
  try {
    const normalized = normalizeCp1252Glyphs(value);
    return Buffer.from(normalized, 'latin1').toString('utf8');
  } catch {
    return value;
  }
}

export function repairMojibake(value: string): string {
  let out = String(value || '');

  for (let i = 0; i < 2; i += 1) {
    const currentScore = mojibakeScore(out);
    if (currentScore === 0) break;

    const candidate = tryLatin1ToUtf8(out);
    const candidateScore = mojibakeScore(candidate);
    if (candidateScore >= currentScore) break;

    out = candidate;
  }

  return out;
}

export function sanitizeHeaderText(value: string): string {
  const noBreaks = String(value || '').replace(/[\r\n]+/g, ' ').trim();
  return repairMojibake(noBreaks);
}

export function encodeHeaderRFC2047(value: string): string {
  const clean = sanitizeHeaderText(value);
  if (/^[\x00-\x7F]*$/.test(clean)) return clean;
  const b64 = Buffer.from(clean, 'utf8').toString('base64');
  return `=?UTF-8?B?${b64}?=`;
}
