/** Fase 4: cadencia canonica de envio, claves de empresa y clasificacion de reintentos.
 * Todo puro y determinista: la concurrencia real se reserva en la base de datos
 * (cowork_company_send_days) y se vuelve a comprobar antes del proveedor. */

export const SEVEN_TOUCH_DAY_NUMBERS = [1, 3, 7, 11, 16, 23, 38] as const;
export const SEVEN_TOUCH_OFFSETS = [0, 2, 6, 10, 15, 22, 37] as const;
// The legacy engine adds delayDays to the PREVIOUS delivery, not the first.
export const SEVEN_TOUCH_DELAY_DAYS = [0, 2, 4, 4, 5, 7, 15] as const;
export const MAX_BATCH_MESSAGES = 7;

export function isSevenTouchCadence(delayDays: number[]): boolean {
  if (delayDays.length !== SEVEN_TOUCH_DELAY_DAYS.length) return false;
  return SEVEN_TOUCH_DELAY_DAYS.every((day, index) => delayDays[index] === day);
}

export function describeCadence(delayDays: number[]): string {
  if (isSevenTouchCadence(delayDays)) return 'seven_touch';
  return `custom:${delayDays.length}`;
}

/** Etapas CRM que retienen una cuenta: hay conversacion activa y un envio mas
 * puede hacer dano (caso real: despedidas a empresas negociando). */
export const NEGOTIATION_HOLD_STAGES = ['negotiation', 'meeting'] as const;
export const CLOSED_STAGES = ['closed_won', 'closed_lost'] as const;

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.es', 'hotmail.cl',
  'live.com', 'live.cl', 'msn.com', 'yahoo.com', 'yahoo.es', 'icloud.com', 'me.com',
  'mac.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'gmx.es', 'yandex.com',
]);

export function normalizeCompanyKey(value: unknown): string | null {
  const text = String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, ' ').replace(/\s+/g, ' ').trim();
  return text || null;
}

export function emailDomain(email: string): string | null {
  const parts = String(email || '').trim().toLowerCase().split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1] || !parts[1].includes('.')) return null;
  return parts[1];
}

export type CompanyKeyBasis = 'company' | 'domain' | 'email';
export type CompanyKeys = { keys: string[]; basis: CompanyKeyBasis };

/** Corporate domain is the reservation identity; name is an additional
 * matching alias. Free-mail domains never identify an entire account. */
export function companyKeysFor(email: string, company: unknown): CompanyKeys {
  const normalized = normalizeCompanyKey(company);
  const domain = emailDomain(email);
  if (domain && !FREE_MAIL_DOMAINS.has(domain)) return {
    keys: [`domain:${domain}`, ...(normalized ? [`company:${normalized}`] : [])], basis: 'domain',
  };
  if (normalized) return { keys: [`company:${normalized}`, `email:${String(email || '').trim().toLowerCase()}`], basis: 'company' };
  return { keys: [`email:${String(email || '').trim().toLowerCase()}`], basis: 'email' };
}

/** Coincidencia por cuenta contra un conjunto de claves propias. */
export function companyRowMatches(keys: Set<string>, email: unknown, company: unknown): boolean {
  return companyKeysFor(String(email || ''), company).keys.some(key => keys.has(key));
}

export type CompanyDayAssignment = { email: string; companyKey: string; companyKeys: string[]; basis: CompanyKeyBasis; sendDay: string };

function addDays(day: string, offset: number): string {
  const base = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(base)) throw new Error('Invalid start day');
  return new Date(base + offset * 86400000).toISOString().slice(0, 10);
}

/** Reserva golosa determinista: cada destinatario sale el primer dia libre de
 * su empresa desde el dia inicial. Nunca dos correos a la misma empresa el
 * mismo dia en el plan; el remitente lo vuelve a comprobar antes de enviar. */
export function planCompanyDays(
  items: Array<{ email: string; company: unknown }>,
  startDay: string,
): CompanyDayAssignment[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDay) || !Number.isFinite(Date.parse(`${startDay}T00:00:00Z`))) {
    throw new Error('Invalid start day');
  }
  const used = new Map<string, Set<string>>();
  return items.map(item => {
    const email = String(item.email || '').trim().toLowerCase();
    if (!email) throw new Error('Missing recipient email');
    const { keys, basis } = companyKeysFor(email, item.company);
    let offset = 0;
    while (keys.some(key => used.get(key)?.has(addDays(startDay, offset)))) offset++;
    const sendDay = addDays(startDay, offset);
    for (const key of keys) {
      const taken = used.get(key) || new Set<string>();
      taken.add(sendDay); used.set(key, taken);
    }
    return { email, companyKey: keys[0], companyKeys: keys, basis, sendDay };
  });
}

export type SendRetryAction = 'retry' | 'terminal' | 'reconcile_first';
export type SendRetryClass = { action: SendRetryAction; reason: string };

const TERMINAL_CODES = new Set([
  'recipient_suppressed', 'BULK_CAMPAIGN_CONTACT_BLOCKED', 'BULK_CAMPAIGN_ALREADY_CONTACTED',
  'BULK_CAMPAIGN_ALREADY_SENT', 'BULK_CAMPAIGN_REVIEW_CHANGED', 'BULK_CAMPAIGN_NOT_FOUND',
  'BULK_CAMPAIGN_COMPANY_REPLIED', 'recipient_invalid', 'invalid_email', 'bounced',
  'recipient_bounced', 'do_not_contact',
]);

const RETRYABLE_CODES = new Set([
  'daily_quota_exceeded', 'provider_connection_unavailable', 'quota_reservation_unavailable',
  'campaign_paused', 'BULK_CAMPAIGN_NOT_APPROVED', 'BULK_CAMPAIGN_NOT_DUE', 'BULK_CAMPAIGN_BUSY',
  'BULK_CAMPAIGN_CONTACT_BUSY', 'BULK_CAMPAIGN_ACCOUNT_NEGOTIATION', 'BULK_CAMPAIGN_COMPANY_DAY_COLLISION',
  'recipient_check_unavailable', 'reply_history_unavailable', 'send_deferred', 'provider_not_connected',
  'content_invalid',
]);

/** 4.6: separa falla de red (reintenta) de direccion invalida (no). Un estado
 * incierto nunca se reintenta a ciegas: primero se concilia en Contactados. */
export function classifySendRetry(status: string, code: string | null): SendRetryClass {
  if (status === 'sent') return { action: 'terminal', reason: 'already_sent' };
  if (status === 'pending' || status === 'sending' || status === 'unknown') {
    return { action: 'reconcile_first', reason: 'uncertain_outcome' };
  }
  const normalized = String(code || '').trim();
  if (TERMINAL_CODES.has(normalized)) return { action: 'terminal', reason: normalized };
  if (status === 'deferred' || RETRYABLE_CODES.has(normalized)) {
    return { action: 'retry', reason: normalized || 'deferred' };
  }
  return { action: 'reconcile_first', reason: normalized || 'unknown_failure' };
}

function santiagoWallDate(instant: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(instant));
}

/** Primer instante UTC con fecha mural >= dia objetivo, buscando entre limites. */
function firstInstantWithWallDateAtLeast(day: string, from: number, to: number): number {
  let low = from;
  let high = to;
  if (santiagoWallDate(low) >= day) return low;
  for (let step = 0; step < 40; step++) {
    const mid = Math.floor((low + high) / 2);
    if (mid === low || mid === high) break;
    if (santiagoWallDate(mid) >= day) high = mid;
    else low = mid;
  }
  return high;
}

export function santiagoDayBounds(now: Date): { start: string; end: string; day: string } {
  const at = now.getTime();
  if (!Number.isFinite(at)) throw new Error('Invalid date');
  const day = santiagoWallDate(at);
  // Wall days last up to 25 hours on DST transitions, so the lower bound must
  // sit strictly before any possible day start.
  const start = firstInstantWithWallDateAtLeast(day, at - 30 * 3600000, at);
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, date) + 86400000).toISOString().slice(0, 10);
  const end = firstInstantWithWallDateAtLeast(next, start, start + 30 * 3600000);
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), day };
}

export function msUntilNextSantiagoDay(now: Date): number {
  const { end } = santiagoDayBounds(now);
  return Math.max(0, Date.parse(end) - now.getTime());
}
