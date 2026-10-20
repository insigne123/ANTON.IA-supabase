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

/** «Buscar correo» of a search (enrich-batch): what happened to each chosen person. */
export type EnrichOutcome = 'email' | 'phone' | 'pending' | 'not_found' | 'had_email' | 'teammate' | 'blocked' | 'failed';
export type EnrichedPerson = { linkedinUrl: string; fullName: string; outcome: EnrichOutcome; email?: string; phone?: string; reason?: string };
export type EnrichBatchResult = { people: EnrichedPerson[]; consumed: number; warning?: string };

/** The mark next to each person once the lookup ran, in the tones of the person card. */
export const OUTCOME_CHIP: Record<EnrichOutcome, { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' }> = {
  email: { label: 'Con correo', tone: 'success' },
  phone: { label: 'Con teléfono', tone: 'success' },
  pending: { label: 'Sigue buscando', tone: 'info' },
  not_found: { label: 'Sin correo', tone: 'neutral' },
  had_email: { label: 'Ya tenía correo', tone: 'success' },
  teammate: { label: 'Contacto de tu equipo', tone: 'info' },
  blocked: { label: 'Lo trabaja tu equipo', tone: 'warning' },
  failed: { label: 'No se pudo', tone: 'warning' },
};

/** How many of the chosen people a lookup can spend a credit on: one each, at most. */
export function creditsNote(chosen: number, remaining: number | null) {
  if (!chosen) return 'Usa 1 crédito por persona sin correo; quien ya tenía correo no gasta.';
  const enough = remaining == null || remaining >= chosen;
  return enough
    ? `Usa hasta ${count(chosen, 'crédito', 'créditos')}${remaining == null ? '' : ` de los ${remaining} que te quedan hoy`}. Quien ya tenía correo no gasta.`
    : `Te quedan ${count(remaining!, 'crédito', 'créditos')} hoy: alcanza para ${remaining === 1 ? '1 persona' : `${remaining} personas`}. Elige menos o busca mañana.`;
}

/** One notice for the whole lookup: who reached «Por escribir» with an email, who did not, and the credits used. */
export function enrichSummary(result: EnrichBatchResult) {
  const by = (outcome: EnrichOutcome) => result.people.filter(person => person.outcome === outcome).length;
  const withEmail = by('email') + by('had_email');
  const parts = [
    withEmail ? `${count(withEmail, 'queda con correo', 'quedan con correo')} en «Por escribir».` : '',
    by('phone') ? `${count(by('phone'), 'queda', 'quedan')} solo con teléfono.` : '',
    by('pending') ? `${count(by('pending'), 'sigue', 'siguen')} en búsqueda: ${by('pending') === 1 ? 'aparecerá' : 'aparecerán'} en «Por escribir».` : '',
    by('not_found') ? `${count(by('not_found'), 'quedó', 'quedaron')} sin correo: puedes escribirles por LinkedIn.` : '',
    by('teammate') ? `${count(by('teammate'), 'ya es contacto', 'ya son contactos')} de tu equipo.` : '',
    by('blocked') ? `${count(by('blocked'), 'no se guardó', 'no se guardaron')}: ${by('blocked') === 1 ? 'lo trabaja' : 'los trabaja'} alguien de tu equipo.` : '',
    result.warning || (by('failed') ? `${count(by('failed'), 'no se pudo completar', 'no se pudieron completar')}: vuelve a intentarlo.` : ''),
    result.consumed ? `Usaste ${count(result.consumed, 'crédito', 'créditos')}.` : '',
  ].filter(Boolean);
  return parts.join(' ') || 'No había nadie para buscar.';
}
