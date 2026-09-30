/** The cases `--cases=` names in the evaluation scripts: ids separated by commas, `prefix*` for every id that starts with it, and
 * `axis:star` / `axis:rest` for the 20 ★ operations of the AXIS package and for the other 24. Undefined when nothing is named. */
export function selectCases(corpus: Array<{ id: string; axis?: { star?: boolean } }>, spec: string | undefined): string[] | undefined {
  if (spec === undefined) return undefined;
  return spec.split(',').filter(Boolean).flatMap(token => token === 'axis:star' || token === 'axis:rest'
    ? corpus.filter(entry => entry.axis && Boolean(entry.axis.star) === (token === 'axis:star')).map(entry => entry.id)
    : token.endsWith('*') ? corpus.filter(entry => entry.id.startsWith(token.slice(0, -1))).map(entry => entry.id) : [token]);
}
