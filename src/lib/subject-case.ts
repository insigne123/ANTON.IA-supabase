/** A subject written as a sentence: its first letter in capital («Dotación para diciembre»), as people fix it by hand. Out of
 * generate-outreach-from-report.ts, a 'use server' module whose exports must all be async. */
export function sentenceCaseSubject(subject: string) {
  return subject.replace(/^([^\p{L}]*)(\p{Ll})/u, (_, lead: string, letter: string) => `${lead}${letter.toLocaleUpperCase('es')}`);
}
