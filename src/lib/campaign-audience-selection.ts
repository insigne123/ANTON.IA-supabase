// «Crear campaña», step «Audiencia»: the first results of a search come selected, so «Continuar» is the next step. A
// selection the person already made is never replaced, and people who cannot be written to are never selected.
export type SelectablePerson = { email: string; blockedReason?: string | null };

/** The emails to select after a search, or null to keep the current selection. */
export function firstSelection(current: string[], found: SelectablePerson[], max: number): string[] | null {
  if (current.length) return null;
  const emails = [...new Set(found.filter(person => !person.blockedReason).map(person => person.email))].slice(0, max);
  return emails.length ? emails : null;
}
