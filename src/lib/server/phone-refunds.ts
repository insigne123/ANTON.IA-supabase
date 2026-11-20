import { creditsLabel } from '@/lib/credit-prices';
import {
  PHONE_REFUND_MAX, parsePhoneList, phoneDigits, samePhone, showPhone,
  type PhoneRefundClaim, type PhoneRefundReport, type PhoneRefundStatus,
} from '@/lib/phone-refunds';
import { loadCreditPrices } from '@/lib/server/credit-prices';
import { providerAlertRecipients } from '@/lib/server/provider-alerts';
import { resendSender, sendReportEmail } from '@/lib/server/self-email';

/** The server half of src/lib/phone-refunds.ts. Service role only: the table has no client policy. */
type Client = any;
type Scope = { organizationId: string; userId: string };

export class PhoneRefundError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = 'PhoneRefundError'; }
}

// Before the migration is applied the table does not exist yet.
const MISSING_TABLE = new Set(['42P01', 'PGRST205', 'PGRST204']);
const NOT_READY = 'La devolución de teléfonos aún no está disponible. Intenta más tarde.';

const claimOf = (row: any): PhoneRefundClaim => ({
  id: String(row.id), phone: String(row.phone), contactName: row.contact_name ? String(row.contact_name) : null,
  credits: Number(row.credits) || 0, status: row.status as PhoneRefundStatus, reportedAt: String(row.reported_at),
  reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null, reviewNote: row.review_note ? String(row.review_note) : null,
});

/** Whether the organization's agreement gives credits back for phones that do not exist (organization_credit_prices.phone_refunds). */
export async function phoneRefundsEnabled(client: Client, organizationId: string): Promise<boolean> {
  const { data, error } = await client.from('organization_credit_prices').select('phone_refunds').eq('organization_id', organizationId).maybeSingle();
  if (error) {
    if (MISSING_TABLE.has(String(error.code || '')) || String(error.code) === '42703') return false;
    throw new PhoneRefundError('No pudimos leer las condiciones de tu organización.', 503);
  }
  return data?.phone_refunds === true;
}

/** The organization's reported phones, the newest first. */
export async function listPhoneRefunds(client: Client, organizationId: string): Promise<PhoneRefundClaim[]> {
  const { data, error } = await client.from('phone_refund_claims')
    .select('id,phone,contact_name,credits,status,reported_at,reviewed_at,review_note')
    .eq('organization_id', organizationId).order('reported_at', { ascending: false }).limit(200);
  if (error) {
    if (MISSING_TABLE.has(String(error.code || ''))) return [];
    throw new PhoneRefundError('No pudimos leer los teléfonos reportados.', 503);
  }
  return ((data || []) as any[]).map(claimOf);
}

/** Every phone the service gave the organization, with whose it is: its saved contacts and its opportunities' contacts. */
async function deliveredPhones(client: Client, organizationId: string) {
  const delivered: Array<{ digits: string; name: string | null }> = [];
  for (const [table, nameColumn] of [['enriched_leads', 'full_name'], ['enriched_opportunities', 'full_name']] as const) {
    for (let from = 0; from < 20_000; from += 1000) {
      const { data, error } = await client.from(table).select(`${nameColumn},primary_phone,phone_numbers`)
        .eq('organization_id', organizationId).order('id').range(from, from + 999);
      if (error) {
        if (table === 'enriched_opportunities') break; // an older shape of that table: the saved contacts are the list that matters
        throw new PhoneRefundError('No pudimos leer los teléfonos entregados.', 503);
      }
      for (const row of (data || []) as any[]) {
        const name = row[nameColumn] ? String(row[nameColumn]).slice(0, 200) : null;
        const numbers = [row.primary_phone, ...(Array.isArray(row.phone_numbers) ? row.phone_numbers.flatMap((entry: any) =>
          entry && typeof entry === 'object' ? [entry.sanitized_number, entry.number, entry.raw_number] : [entry]) : [row.phone_numbers])];
        for (const number of numbers) { const digits = phoneDigits(number); if (digits) delivered.push({ digits, name }); }
      }
      if (!data || data.length < 1000) break;
    }
  }
  return delivered;
}

/**
 * The numbers the customer says do not exist, kept for the ANTON.IA team to try. Only phones the service gave this organization
 * are taken, once each; the credits a confirmed one gives back are what a phone costs the organization today.
 */
export async function reportPhoneRefunds(client: Client, scope: Scope, text: string, deps: { notify?: typeof notifyPhoneRefunds } = {}): Promise<PhoneRefundReport> {
  const { phones, invalid } = parsePhoneList(text);
  if (phones.length > PHONE_REFUND_MAX) throw new PhoneRefundError(`Envía hasta ${PHONE_REFUND_MAX} teléfonos por vez.`);
  const report: PhoneRefundReport = { added: 0, repeated: [], unknown: [], invalid };
  if (!phones.length) return report;
  if (!(await phoneRefundsEnabled(client, scope.organizationId))) throw new PhoneRefundError('Tu plan no incluye la devolución de teléfonos. Escríbenos si quieres agregarla.', 403);
  const [prices, delivered, known] = await Promise.all([
    loadCreditPrices(scope.organizationId, client), deliveredPhones(client, scope.organizationId), listPhoneRefunds(client, scope.organizationId),
  ]);
  const taken: Array<{ phone: string; name: string | null }> = [];
  for (const phone of phones) {
    const match = delivered.find(entry => samePhone(entry.digits, phone));
    if (!match) { report.unknown.push(phone); continue; }
    // Kept as the service delivered it, so the same phone written two ways is one claim.
    if (known.some(claim => samePhone(claim.phone, match.digits)) || taken.some(entry => entry.phone === match.digits)) { report.repeated.push(phone); continue; }
    taken.push({ phone: match.digits, name: match.name });
  }
  if (taken.length) {
    const { error } = await client.from('phone_refund_claims').insert(taken.map(entry => ({
      organization_id: scope.organizationId, reported_by: scope.userId, phone: entry.phone, contact_name: entry.name, credits: prices.phone,
    })));
    if (error) {
      if (MISSING_TABLE.has(String(error.code || ''))) throw new PhoneRefundError(NOT_READY, 503);
      // Someone else of the team sent the same number a moment ago: nothing is lost, the list shows it.
      if (String(error.code) === '23505') throw new PhoneRefundError('Alguien de tu equipo acaba de enviar alguno de esos teléfonos. Revisa la lista y envía los que falten.', 409);
      throw new PhoneRefundError('No pudimos guardar los teléfonos. Intenta nuevamente.', 503);
    }
    report.added = taken.length;
    await (deps.notify ?? notifyPhoneRefunds)(client, scope.organizationId, taken, prices.phone).catch(() => undefined);
  }
  return report;
}

/** The team's answer for one phone, once: confirmed gives its credits back from that moment. */
export async function reviewPhoneRefund(client: Client, organizationId: string, id: string, decision: 'confirmed' | 'rejected', note: string | null, now = new Date()) {
  const { data, error } = await client.from('phone_refund_claims')
    .update({ status: decision, reviewed_at: now.toISOString(), review_note: note ? note.trim().slice(0, 300) || null : null })
    .eq('id', id).eq('organization_id', organizationId).eq('status', 'reported')
    .select('id,phone,contact_name,credits,status,reported_at,reviewed_at,review_note').maybeSingle();
  if (error) throw new PhoneRefundError('No pudimos guardar la revisión.', 503);
  if (!data) throw new PhoneRefundError('Ese teléfono ya fue revisado o no existe.', 409);
  return claimOf(data);
}

/** Tells the ANTON.IA team there are phones to try (the contract gives five working days). Best effort, through Resend only. */
export async function notifyPhoneRefunds(client: Client, organizationId: string, taken: Array<{ phone: string; name: string | null }>, credits: number, deps: { env?: Record<string, string | undefined>; fetch?: typeof fetch } = {}) {
  const env = deps.env ?? process.env;
  const recipients = providerAlertRecipients(env);
  if (!recipients.length || !resendSender(env)) return;
  const organization = await client.from('organizations').select('name').eq('id', organizationId).maybeSingle();
  const name = String(organization.data?.name || 'Una organización');
  const lines = taken.map(entry => `${showPhone(entry.phone)}${entry.name ? ` · ${entry.name}` : ''}`);
  const subject = `${name} reportó ${taken.length === 1 ? '1 teléfono que no existe' : `${taken.length} teléfonos que no existen`}`;
  const text = [`${name} dice que ${taken.length === 1 ? 'este teléfono no existe' : 'estos teléfonos no existen'}:`, '', ...lines, '',
    'Prueba cada número y responde en Administración de esa organización (tarjeta «Teléfonos que no existen»). El plazo del contrato es de 5 días hábiles.',
    `Cada confirmado devuelve ${creditsLabel(credits)}.`].join('\n');
  const escape = (value: string) => value.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] as string));
  const html = `<p>${escape(text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
  for (const to of recipients) await sendReportEmail(client, { userId: '', to, subject, html, text }, deps);
}
