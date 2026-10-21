// What the Word of the offer reads out of the draft: the body of the letter without the lines the document writes itself, a
// compliance answer as a choice plus its text, the words that are placeholders to fill in, and the fields of a form the
// company's data already answer. Pure: the Word builder (server) and its tests share it.
import { OFFER_PLACEHOLDER } from './offer-draft';

/** The company data that fills the forms; the rest of a form (address, representative, phone) the company has not given. */
export type OfferCompany = { legalName: string | null; rut: string | null };

const plain = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Text cut into runs: what is written and what is a «[placeholder]» the person fills in. */
export function splitPlaceholders(text: string): Array<{ text: string; placeholder: boolean }> {
  const one = new RegExp(`^${OFFER_PLACEHOLDER.source}$`);
  return text.split(new RegExp(`(${OFFER_PLACEHOLDER.source})`, 'g')).filter(part => part !== '').map(part => ({ text: part, placeholder: one.test(part) }));
}

/** Paragraphs and bullet items of a block of text, one per line; an empty line only separates. */
export function offerParagraphs(text: string): Array<{ kind: 'p' | 'li'; text: string }> {
  return text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const bullet = /^(?:[-•*–])\s+(.*)$/.exec(line);
    return bullet ? { kind: 'li' as const, text: bullet[1] } : { kind: 'p' as const, text: line };
  });
}

/**
 * The body of the cover letter. The document writes the place and date, the addressee, the reference, the greeting and the
 * closing itself; drafts made before that carried them inside the letter, so what comes before the first real paragraph and
 * from the closing on is left out.
 */
export function letterBody(letter: string): string[] {
  const lines = letter.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean);
  const isOpening = (line: string) => /^\[?\s*lugar y fecha\s*\]?[.,]?$/i.test(line) || /^se[ñn]ores?\b/i.test(line) || /^ref(?:erencia)?\.?\s*:/i.test(line)
    || /^(?:de mi|de nuestra|estimad[oa]s?)\b.{0,40}[:,]$/i.test(line) || line.length < 60;
  let start = 0;
  while (start < lines.length && isOpening(lines[start])) start += 1;
  const rest = lines.slice(start);
  const end = rest.findIndex(line => /^(?:atentamente|sin otro particular|saludan?\b|saluda)/i.test(line));
  const body = (end >= 0 ? rest.slice(0, end) : rest).filter(line => !/^\[?\s*firma\s*\]?/i.test(line));
  // A letter with nothing long in it (a short template) is kept whole rather than emptied.
  return body.length ? body : lines.filter(line => !/^\[?\s*lugar y fecha\s*\]?$/i.test(line) && !/^atentamente/i.test(line));
}

/** «Cumplimos: …» is a yes with its how; «[confirmar si cumplimos: …]» is a question the company answers. */
export function complianceAnswer(answer: string): { choice: 'yes' | null; text: string; hint: string } {
  const text = answer.trim();
  const open = /^\[\s*confirmar si cumplimos\s*:?\s*([^\]]*)\]\.?$/i.exec(text);
  if (open) return { choice: null, text: '', hint: open[1].trim() };
  const yes = /^(?:s[ií],?\s*)?cumpl(?:imos|iremos|e)\b[:.,]?\s*([\s\S]*)$/i.exec(text);
  if (yes) { const how = yes[1].trim(); return { choice: 'yes', text: how.charAt(0).toUpperCase() + how.slice(1), hint: '' }; }
  return { choice: null, text, hint: '' };
}

/** The value a form field takes from what the company told the app, or null when it is somebody else's data (the representative, the contact). */
export function prefillField(label: string, company: OfferCompany): string | null {
  const name = plain(label);
  if (/representante|encargad|contacto|tecnico|domicilio|direccion|correo|telefono|cargo|firma|fecha|ciudad/.test(name)) return null;
  if (/razon social|nombre.*(proponente|oferente|empresa|sociedad)/.test(name)) return company.legalName;
  if (/(^|[^a-z])rut($|[^a-z])/.test(name)) return company.rut;
  return null;
}
