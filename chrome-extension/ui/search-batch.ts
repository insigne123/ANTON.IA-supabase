/**
 * The batch save of a LinkedIn search (plan 8, phase 4, PR-4c), computed apart so the panel and its tests read the same thing.
 * The people on screen come from the page; what the organization knows of each comes from presence (PR-4b).
 */
export type SearchResult = { linkedinUrl: string; fullName: string; headline: string; title: string; companyName: string };
export type ResultPresence = { label: string; tone: 'success' | 'info' | 'warning'; blocks: boolean };
type Person = { linkedinUrl: string; fullName: string };
export type BatchResult = { saved: Person[]; already: Person[]; blocked: Array<Person & { reason: string }>; failed: Array<Person & { error: string }> };

export const BATCH_LIMIT = 25;

/** «Seleccionar disponibles»: the people the organization knows nothing of yet, up to the batch limit. */
export function availableResults(results: SearchResult[], presence: Record<string, ResultPresence | undefined>, limit = BATCH_LIMIT) {
  return results.filter(result => !presence[result.linkedinUrl]).slice(0, limit).map(result => result.linkedinUrl);
}

/** What the person chose, as the profiles the server saves: name, title and company as the results show them. */
export function chosenProfiles(results: SearchResult[], chosen: string[]) {
  return results.filter(result => chosen.includes(result.linkedinUrl)).slice(0, BATCH_LIMIT).map(result => ({
    linkedinUrl: result.linkedinUrl, fullName: result.fullName, title: result.title, companyName: result.companyName,
    ...(result.headline ? { details: { headline: result.headline } } : {}),
  }));
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** One notice that says what happened to each group, in plain words. */
export function batchSummary(result: BatchResult) {
  const parts: string[] = [];
  if (result.saved.length) parts.push(`${count(result.saved.length, 'contacto guardado', 'contactos guardados')} en tu organización.`);
  if (result.already.length) parts.push(`${count(result.already.length, 'ya estaba guardado', 'ya estaban guardados')}.`);
  if (result.blocked.length) {
    parts.push(`No ${result.blocked.length === 1 ? 'se guardó' : 'se guardaron'} ${result.blocked.map(item => `${item.fullName} (${item.reason})`).join(', ')}.`);
  }
  if (result.failed.length) parts.push(`${count(result.failed.length, 'no se pudo guardar', 'no se pudieron guardar')}: vuelve a intentarlo.`);
  return parts.join(' ') || 'No había nadie para guardar.';
}
