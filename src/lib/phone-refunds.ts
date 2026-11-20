/**
 * Credits given back for phones that do not exist (20 Nov 2026, the owner: «todo teléfono que no exista se les devolverá los
 * créditos correspondientes; ellos nos darán el listado de teléfonos que identifiquen que no existen y Yago los probará»). The
 * customer's administrator sends the numbers from «Administración»; each one is kept as reported, the ANTON.IA team tries it and
 * answers, and a confirmed one gives back what a phone cost that organization (apollo_credit_allocation_status_v3 adds it to
 * what is left, usable until the end of the following window). Pure: the card, the server and the tests share it.
 */
export type PhoneRefundStatus = 'reported' | 'confirmed' | 'rejected';
export type PhoneRefundClaim = {
  id: string; phone: string; contactName: string | null; credits: number; status: PhoneRefundStatus;
  reportedAt: string; reviewedAt: string | null; reviewNote: string | null;
};
/** What one sending answers: how many were taken, and the ones left out with the reason said on screen. */
export type PhoneRefundReport = { added: number; repeated: string[]; unknown: string[]; invalid: string[] };

/** How many numbers one sending takes. */
export const PHONE_REFUND_MAX = 100;

/** The digits of a number, without the international «00», or null when it cannot be a phone. */
export function phoneDigits(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\D+/g, '').replace(/^00/, '');
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

/** The same phone written two ways: with and without the country's prefix. Eight digits in common at least. */
export function samePhone(a: string, b: string) {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 8 && long.endsWith(short);
}

/** The numbers of a pasted list, one per line or separated by commas or semicolons, without repeats; what is not a phone apart. */
export function parsePhoneList(text: string): { phones: string[]; invalid: string[] } {
  const phones: string[] = [], invalid: string[] = [];
  for (const piece of String(text || '').split(/[\n,;]+/)) {
    const raw = piece.trim();
    if (!raw) continue;
    const digits = phoneDigits(raw);
    if (!digits) { if (invalid.length < 20) invalid.push(raw.slice(0, 40)); continue; }
    if (!phones.some(phone => samePhone(phone, digits))) phones.push(digits);
  }
  return { phones, invalid };
}

export const showPhone = (digits: string) => `+${digits}`;

const LABEL: Record<PhoneRefundStatus, string> = { reported: 'En revisión', confirmed: 'Devuelto', rejected: 'Sin devolución' };
export const phoneRefundLabel = (status: PhoneRefundStatus) => LABEL[status];

/** What the card says after a sending. */
export function phoneRefundReportText(report: PhoneRefundReport) {
  const parts: string[] = [];
  if (report.added) parts.push(report.added === 1 ? 'Recibimos 1 teléfono: lo probamos y te avisamos aquí.' : `Recibimos ${report.added} teléfonos: los probamos y te avisamos aquí.`);
  if (report.repeated.length) parts.push(`Ya ${report.repeated.length === 1 ? 'estaba' : 'estaban'} en la lista: ${report.repeated.map(showPhone).join(', ')}.`);
  if (report.unknown.length) parts.push(`No ${report.unknown.length === 1 ? 'lo encontramos' : 'los encontramos'} entre los teléfonos que te entregó ANTON.IA: ${report.unknown.map(showPhone).join(', ')}.`);
  if (report.invalid.length) parts.push(`No ${report.invalid.length === 1 ? 'parece un teléfono' : 'parecen teléfonos'}: ${report.invalid.join(', ')}.`);
  return parts.join(' ') || 'Escribe al menos un teléfono.';
}

/** One line over the list: what is waiting and what came back. */
export function phoneRefundSummary(claims: PhoneRefundClaim[]) {
  const waiting = claims.filter(claim => claim.status === 'reported').length;
  const confirmed = claims.filter(claim => claim.status === 'confirmed');
  const credits = confirmed.reduce((sum, claim) => sum + claim.credits, 0);
  const parts = [waiting === 1 ? '1 en revisión' : `${waiting} en revisión`];
  if (confirmed.length) parts.push(`${confirmed.length === 1 ? '1 devuelto' : `${confirmed.length} devueltos`} (${credits.toLocaleString('es-CL')} ${credits === 1 ? 'crédito' : 'créditos'})`);
  return parts.join(' · ');
}
