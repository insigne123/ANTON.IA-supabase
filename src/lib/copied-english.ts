/**
 * English a writer copied from the source, said in Spanish: «filiales comerciales en United Kingdom», «su estructura commercial» (real
 * research, 31 Oct 2026). On the corrective retry the tone check only warns about it, so it reached the draft. Only names and words whose
 * Spanish is not in doubt; a capitalised word may be part of a name («Commercial Bank») and is left alone, and so are the companies' names.
 */
const PLACES: Array<[RegExp, string]> = [
  [/\b(?:the )?United Kingdom\b/g, 'Reino Unido'],
  [/\b(?:the )?United States\b/g, 'Estados Unidos'],
  [/\bSouth Korea\b/g, 'Corea del Sur'],
  [/\b(?:the )?Netherlands\b/g, 'Países Bajos'],
  [/\bTurkey\b/g, 'Turquía'],
  [/\bBrazil\b/g, 'Brasil'],
];
const WORDS: Array<[RegExp, string]> = [
  [/\bcommercial\b/g, 'comercial'],
  [/\bsubsidiaries\b/g, 'filiales'],
  [/\bsubsidiary\b/g, 'filial'],
];

export function spanishForCopiedEnglish(text: string, ownNames: Array<string | null | undefined> = []) {
  const names = ownNames.map((name) => String(name || '').trim()).filter((name) => name.length >= 3);
  // The companies' names are kept aside, so «Turkey Hill Foods» or «United Kingdom Partners» stay as they are.
  const kept: string[] = [];
  let value = names.reduce((current, name) => current.split(name).join(`\u0000${kept.push(name) - 1}\u0000`), text);
  for (const [pattern, spanish] of [...PLACES, ...WORDS]) value = value.replace(pattern, spanish);
  // «el Reino Unido (United Kingdom)» became «el Reino Unido (Reino Unido)»: the gloss goes.
  value = value.replace(/(\p{L}[\p{L} ]{2,40}?) \((\1)\)/gu, '$1');
  return value.replace(/\u0000(\d+)\u0000/g, (_, index: string) => kept[Number(index)]);
}
