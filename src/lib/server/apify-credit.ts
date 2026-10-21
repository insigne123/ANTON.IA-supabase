import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { emailShell } from '@/lib/email-shell';
import { resendSender, sendReportEmail } from '@/lib/server/self-email';

/**
 * What is left of the Apify plan the app spends from (APIFY_TOKEN): Leads Finder, «Contacto del día» and the LinkedIn
 * sources of «Oportunidades» stop when it runs out. The hourly provider-usage tick reads it, keeps it in
 * antonia_provider_usage_snapshots (provider 'apify') and emails APIFY_ALERT_EMAILS when it runs low (APIFY_LOW_CREDIT_USD,
 * US$0.10 by default) and when it runs out: once per cycle and limit each. An email that could not go out is tried again
 * on the next check.
 */
type Fetch = typeof fetch;
type Env = Record<string, string | undefined>;
export type ApifyCredit = { maxUsd: number; usedUsd: number; leftUsd: number; cycleStart: string | null; cycleEnd: string | null };
export type CreditLevel = 'ok' | 'low' | 'empty';

const EMAIL = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]{2,}$/;
const BILLING_URL = 'https://console.apify.com/billing';

export function apifyLowCreditUsd(configured = process.env.APIFY_LOW_CREDIT_USD) {
  const value = Number(configured);
  return configured !== undefined && configured.trim() !== '' && Number.isFinite(value) && value >= 0 ? value : 0.1;
}

/** Who gets the alert: APIFY_ALERT_EMAILS, separated by commas or spaces; five at most. */
export function apifyAlertRecipients(configured = process.env.APIFY_ALERT_EMAILS) {
  const emails = String(configured || '').split(/[\s,;]+/).map(email => email.trim().toLowerCase()).filter(email => EMAIL.test(email));
  return [...new Set(emails)].slice(0, 5);
}

/** Below a cent counts as nothing left: Apify will not start a run with it. */
export function creditLevel(credit: Pick<ApifyCredit, 'leftUsd'>, lowUsd: number): CreditLevel {
  if (credit.leftUsd < 0.01) return 'empty';
  return credit.leftUsd <= lowUsd ? 'low' : 'ok';
}

async function apifyGet(path: string, token: string, request: Fetch) {
  const response = await request(`https://api.apify.com${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`APIFY_HTTP_${response.status}`);
  return (await response.json() as { data?: Record<string, any> }).data ?? {};
}

export async function readApifyCredit(token: string, request: Fetch = fetch): Promise<ApifyCredit> {
  const data = await apifyGet('/v2/users/me/limits', token, request);
  const maxUsd = Number(data.limits?.maxMonthlyUsageUsd);
  const usedUsd = Number(data.current?.monthlyUsageUsd);
  if (!Number.isFinite(maxUsd) || !Number.isFinite(usedUsd)) throw new Error('APIFY_LIMITS_UNREADABLE');
  const date = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
  return { maxUsd, usedUsd, leftUsd: Math.max(0, Math.round((maxUsd - usedUsd) * 10_000) / 10_000),
    cycleStart: date(data.monthlyUsageCycle?.startAt), cycleEnd: date(data.monthlyUsageCycle?.endAt) };
}

const usd = (value: number) => `US$${new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
const day = (iso: string) => new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(new Date(iso));
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

/** The alert: what is left, what stops, and where to add more. */
export function apifyAlertEmail(level: Exclude<CreditLevel, 'ok'>, credit: ApifyCredit, account: string | null) {
  const subject = level === 'empty' ? 'Apify se quedó sin saldo' : `A Apify le quedan ${usd(credit.leftUsd)}`;
  const whose = account ? `La cuenta de Apify de ANTON.IA (${account})` : 'La cuenta de Apify de ANTON.IA';
  const state = level === 'empty'
    ? `${whose} ya usó los ${usd(credit.maxUsd)} de este ciclo.`
    : `${whose} usó ${usd(credit.usedUsd)} de ${usd(credit.maxUsd)} este ciclo: quedan ${usd(credit.leftUsd)}.`;
  const renews = credit.cycleEnd ? `El saldo se renueva el ${day(credit.cycleEnd)}.` : '';
  const stops = level === 'empty'
    ? 'Mientras tanto no funcionan la búsqueda de contactos, el «Contacto del día» ni las fuentes de LinkedIn de «Oportunidades».'
    : 'Cuando se acabe, dejan de funcionar la búsqueda de contactos, el «Contacto del día» y las fuentes de LinkedIn de «Oportunidades».';
  const action = 'Para seguir, sube el límite de uso o el plan en Apify.';
  const paragraphs = [state, [stops, renews].filter(Boolean).join(' '), action];
  const text = [...paragraphs, '', `Abrir la facturación de Apify: ${BILLING_URL}`, '',
    'Revisamos el saldo cada hora y te avisamos una vez cuando queda poco y otra cuando se acaba.'].join('\n');
  const html = emailShell(`<h1 style="margin:0 0 12px;font-size:20px;line-height:28px">${escape(subject)}</h1>`
    + paragraphs.map(paragraph => `<p style="margin:0 0 12px;font-size:15px;line-height:22px">${escape(paragraph)}</p>`).join('')
    + `<p style="margin:20px 0 0"><a href="${BILLING_URL}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#111827;color:#ffffff;text-decoration:none;font-size:14px">Abrir la facturación de Apify</a></p>`
    + `<p style="margin:20px 0 0;font-size:12px;line-height:18px;color:#6b7280">Revisamos el saldo cada hora y te avisamos una vez cuando queda poco y otra cuando se acaba.</p>`);
  return { subject, text, html };
}

/** Which alerts already went out for this cycle and this limit (raising the limit opens new ones). */
async function alertsSent(client: SupabaseClient, credit: ApifyCredit) {
  if (!credit.cycleStart) return new Set<string>();
  const { data, error } = await client.from('antonia_provider_usage_snapshots').select('usage')
    .eq('provider', 'apify').eq('cycle_start', credit.cycleStart).not('usage->>alert', 'is', null).limit(20);
  if (error) throw error;
  return new Set((data || []).filter(row => Number(row.usage?.maxMonthlyUsageUsd) === credit.maxUsd).map(row => String(row.usage.alert)));
}

/** Through Resend when it is set up; otherwise from the recipient's own mailbox, if they have an account with one. */
async function sendAlert(client: SupabaseClient, to: string, email: ReturnType<typeof apifyAlertEmail>, deps: { fetch: Fetch; env: Env }) {
  if (resendSender(deps.env)) return sendReportEmail(client, { userId: '', to, ...email }, deps);
  const { data } = await client.from('profiles').select('id').eq('email', to).limit(1).maybeSingle();
  if (!data?.id) return { ok: false as const, error: 'Sin Resend ni un buzón conectado de quien recibe el aviso.' };
  return sendReportEmail(client, { userId: String(data.id), to, ...email }, deps);
}

export async function checkApifyCredit(client: SupabaseClient, deps: { fetch?: Fetch; env?: Env; now?: Date } = {}) {
  const env = deps.env ?? process.env;
  const request = deps.fetch ?? fetch;
  const token = String(env.APIFY_TOKEN || '').trim();
  if (!token) return { provider: 'apify' as const, skipped: 'APIFY_TOKEN' };
  const credit = await readApifyCredit(token, request);
  const level = creditLevel(credit, apifyLowCreditUsd(env.APIFY_LOW_CREDIT_USD));
  let alert: { level: CreditLevel; sentTo: number; error?: string } | null = null;
  if (level !== 'ok' && !(await alertsSent(client, credit)).has(level)) {
    const recipients = apifyAlertRecipients(env.APIFY_ALERT_EMAILS);
    const account = await apifyGet('/v2/users/me', token, request).then(data => typeof data.username === 'string' ? data.username : null).catch(() => null);
    const email = apifyAlertEmail(level, credit, account);
    const results = [];
    for (const to of recipients) results.push(await sendAlert(client, to, email, { fetch: request, env }));
    const sentTo = results.filter(result => result.ok).length;
    const failed = results.find(result => !result.ok);
    alert = { level, sentTo, ...(recipients.length ? (failed && 'error' in failed ? { error: failed.error } : {}) : { error: 'Falta APIFY_ALERT_EMAILS.' }) };
  }
  const capturedAt = (deps.now ?? new Date()).toISOString();
  const { error } = await client.from('antonia_provider_usage_snapshots').insert({
    provider: 'apify', scope_type: 'team', provider_account_id: null, provider_user_id: null,
    cycle_start: credit.cycleStart, cycle_end: credit.cycleEnd, source: 'apify_direct', request_id: randomUUID(), captured_at: capturedAt,
    usage: { endpoint: 'users/me/limits', maxMonthlyUsageUsd: credit.maxUsd, monthlyUsageUsd: credit.usedUsd, leftUsd: credit.leftUsd, level,
      // Only a delivered alert counts as sent: a failed one is tried again on the next check.
      ...(alert?.sentTo ? { alert: alert.level, alertSentTo: alert.sentTo } : {}), ...(alert?.error ? { alertError: alert.error } : {}) },
  });
  if (error) throw error;
  return { provider: 'apify' as const, level, leftUsd: credit.leftUsd, maxUsd: credit.maxUsd, alert };
}
