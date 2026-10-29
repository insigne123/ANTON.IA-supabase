import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { emailShell } from '@/lib/email-shell';
import { apifyAlertRecipients } from '@/lib/server/apify-credit';
import { resendSender, sendReportEmail, sendSelfEmail } from '@/lib/server/self-email';

/**
 * The email when a service the app pays for runs low or runs out, besides Apify's (apify-credit.ts). Two ways to know:
 * - Reading the balance (checkProviderBalance): Apollo and Reoon on the hourly provider-usage tick, JSearch from the
 *   headers of each request. One email when it runs low and one when it runs out; told again only after a reading with
 *   balance (a top-up).
 * - From the service's own refusal (reportProviderOutage): OpenAI, Claude, Serper, Resend, Reoon and JSearch answer that
 *   the account has no balance or refuse it. At most one email a day per service while it lasts.
 * Each alert is kept in antonia_provider_usage_snapshots (source 'provider_alert'), which is also what is read before
 * telling again. It goes to PROVIDER_ALERT_EMAILS (APIFY_ALERT_EMAILS when unset) through Resend; Resend's own, and any
 * Resend does not take, from the recipient's connected mailbox.
 */
type Fetch = typeof fetch;
type Env = Record<string, string | undefined>;
type Deps = { fetch?: Fetch; env?: Env; now?: Date };
export type AlertProvider = 'apollo' | 'reoon' | 'jsearch' | 'serper' | 'openai' | 'anthropic' | 'resend';
export type AlertLevel = 'ok' | 'low' | 'empty' | 'refused';
export type Balance = { left: number; limit: number | null; renewsAt?: string | null; refused?: boolean };

const DAY = 86_400_000;
/** A shortage is news only when it is worse than the last one told: low after empty (daily credits came back) is not. */
const RANK: Record<AlertLevel, number> = { ok: 0, low: 1, empty: 2, refused: 2 };

const SERVICES: Record<AlertProvider, { name: string; unit: string; url: string; stops: string }> = {
  apollo: { name: 'Apollo', unit: 'créditos', url: 'https://app.apollo.io/',
    stops: 'pedir el correo y el teléfono de los contactos, en la app y en Cowork' },
  reoon: { name: 'Reoon', unit: 'créditos', url: 'https://emailverifier.reoon.com/',
    stops: 'la búsqueda del correo de los contactos que Apollo no tiene' },
  jsearch: { name: 'JSearch (RapidAPI)', unit: 'consultas', url: 'https://rapidapi.com/developer/billing/subscriptions-and-usage',
    stops: 'los avisos de empleo de «Empresas contratando» en Oportunidades' },
  serper: { name: 'Serper', unit: 'créditos', url: 'https://serper.dev/',
    stops: 'la búsqueda en Google de la investigación de empresas y de Oportunidades' },
  openai: { name: 'OpenAI', unit: 'saldo', url: 'https://platform.openai.com/settings/organization/billing/overview',
    stops: 'la redacción de correos y lo que escriben los modelos de OpenAI' },
  anthropic: { name: 'Claude (Anthropic)', unit: 'saldo', url: 'https://console.anthropic.com/settings/billing',
    stops: 'Cowork y lo que escriben los modelos de Claude, como la investigación del Contacto del día' },
  resend: { name: 'Resend', unit: 'envíos', url: 'https://resend.com/settings/billing',
    stops: 'los correos automáticos de la app: el informe semanal, los avisos y el Contacto del día' },
};

/** Who gets the alerts: PROVIDER_ALERT_EMAILS, or APIFY_ALERT_EMAILS while it is the only one set; five at most. */
export const providerAlertRecipients = (env: Env = process.env) => apifyAlertRecipients(env.PROVIDER_ALERT_EMAILS || env.APIFY_ALERT_EMAILS);

/** What counts as low: APOLLO_LOW_CREDITS, REOON_LOW_CREDITS or JSEARCH_LOW_CREDITS, else a tenth of the plan (50 when it tells none). */
export function lowThreshold(provider: AlertProvider, balance: Pick<Balance, 'limit'>, env: Env = process.env) {
  const configured = env[`${provider.toUpperCase()}_LOW_CREDITS`];
  const value = Number(configured);
  if (configured !== undefined && configured.trim() !== '' && Number.isFinite(value) && value >= 0) return value;
  return balance.limit ? Math.ceil(balance.limit / 10) : 50;
}

export function balanceLevel(balance: Balance, low: number): AlertLevel {
  if (balance.refused) return 'refused';
  if (balance.left <= 0) return 'empty';
  return balance.left <= low ? 'low' : 'ok';
}

const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const isoDate = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;

/** Apollo's lead credits from the hourly usage snapshot (usage_stats/credit_usage_stats): the ones contact data spends. */
export function apolloBalance(creditUsage: unknown): Balance | null {
  const lead = record(record(record(creditUsage).credit_usage_stats).lead_credit);
  const limit = Number(lead.limit);
  const left = Number(lead.left_over);
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(left)) return null;
  return { left: Math.max(0, left), limit, renewsAt: isoDate(record(record(creditUsage).current_credit_cycle).end_date) };
}

/** Reoon's credits for today and the ones bought (check-account-balance, free); an inactive key reads as refused. */
export async function readReoonBalance(apiKey: string, request: Fetch = fetch): Promise<Balance> {
  const url = new URL('https://emailverifier.reoon.com/api/v1/check-account-balance/');
  url.searchParams.set('key', apiKey);
  const response = await request(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000), cache: 'no-store' });
  const body = record(await response.json().catch(() => null));
  if (response.status === 401 || response.status === 403 || (body.api_status && body.api_status !== 'active')) return { left: 0, limit: null, refused: true };
  if (!response.ok || body.status !== 'success') throw new Error(`REOON_BALANCE_HTTP_${response.status}`);
  const daily = Number(body.remaining_daily_credits);
  const instant = Number(body.remaining_instant_credits);
  if (!Number.isFinite(daily) || !Number.isFinite(instant)) throw new Error('REOON_BALANCE_UNREADABLE');
  return { left: Math.max(0, daily) + Math.max(0, instant), limit: null };
}

const number = (value: number) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(value);
const day = (iso: string) => new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(new Date(iso));
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

type AlertInfo = { left?: number; limit?: number | null; renewsAt?: string | null; detail?: string };

/** The alert: what is left, what stops, and where to add more. */
export function providerAlertEmail(provider: AlertProvider, level: Exclude<AlertLevel, 'ok'>, info: AlertInfo = {}) {
  const { name, unit, url, stops } = SERVICES[provider];
  const left = info.left ?? 0;
  const detail = info.detail ? ` (${info.detail.slice(0, 120)})` : '';
  const subject = level === 'low' ? `A ${name} le quedan ${number(left)} ${unit}`
    : level === 'empty' ? `${name} se quedó sin ${unit}` : `${name} rechazó la cuenta de ANTON.IA`;
  const state = level === 'low'
    ? info.limit ? `La cuenta de ${name} de ANTON.IA usó ${number(info.limit - left)} de ${number(info.limit)} ${unit}: quedan ${number(left)}.`
      : `A la cuenta de ${name} de ANTON.IA le quedan ${number(left)} ${unit}.`
    : level === 'empty' ? `${name} respondió que la cuenta de ANTON.IA no tiene ${unit}${detail}.`
      : `${name} rechazó la cuenta de ANTON.IA${detail}: puede ser la clave, la suscripción o el saldo.`;
  const renews = info.renewsAt ? ` Se renueva el ${day(info.renewsAt)}.` : '';
  const paragraphs = [state, `${level === 'low' ? 'Cuando se acabe, se detiene' : 'Mientras tanto se detiene'}: ${stops}.${renews}`,
    level === 'refused' ? `Revisa la clave y la suscripción en ${name}.` : `Para seguir, recarga o sube el plan en ${name}.`];
  const footer = 'Avisamos una vez cuando queda poco y otra cuando se acaba; si el servicio sigue sin saldo, a lo más una vez al día.';
  const text = [...paragraphs, '', `Abrir ${name}: ${url}`, '', footer].join('\n');
  const html = emailShell(`<h1 style="margin:0 0 12px;font-size:20px;line-height:28px">${escape(subject)}</h1>`
    + paragraphs.map(paragraph => `<p style="margin:0 0 12px;font-size:15px;line-height:22px">${escape(paragraph)}</p>`).join('')
    + `<p style="margin:20px 0 0"><a href="${url}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#111827;color:#ffffff;text-decoration:none;font-size:14px">Abrir ${escape(name)}</a></p>`
    + `<p style="margin:20px 0 0;font-size:12px;line-height:18px;color:#6b7280">${escape(footer)}</p>`);
  return { subject, text, html };
}

/** The last alert told about this service, or its last top-up. */
async function lastAlert(client: SupabaseClient, provider: AlertProvider) {
  const { data, error } = await client.from('antonia_provider_usage_snapshots').select('usage,captured_at')
    .eq('provider', provider).eq('source', 'provider_alert').order('captured_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const level = String(record(data.usage).level) as AlertLevel;
  return { level: level in RANK ? level : 'ok' as AlertLevel, at: Date.parse(String(data.captured_at)) };
}

async function keep(client: SupabaseClient, provider: AlertProvider, usage: Record<string, unknown>, now: Date) {
  const { error } = await client.from('antonia_provider_usage_snapshots').insert({
    provider, scope_type: 'team', provider_account_id: null, provider_user_id: null, cycle_start: null, cycle_end: usage.renewsAt ?? null,
    source: 'provider_alert', request_id: randomUUID(), captured_at: now.toISOString(), usage,
  });
  if (error) throw error;
}

type Email = ReturnType<typeof providerAlertEmail>;
/** Through Resend when it is set up; else, or when Resend does not take it (and always for Resend's own), from the recipient's mailbox. */
async function deliver(client: SupabaseClient, provider: AlertProvider, to: string, email: Email, deps: { fetch: Fetch; env: Env }) {
  if (provider !== 'resend' && resendSender(deps.env)) {
    const sent = await sendReportEmail(client, { userId: '', to, ...email }, deps);
    if (sent.ok) return sent;
  }
  const { data } = await client.from('profiles').select('id').eq('email', to).limit(1).maybeSingle();
  if (!data?.id) return { ok: false as const, error: 'Sin Resend ni un buzón conectado de quien recibe el aviso.' };
  return sendSelfEmail(client, { userId: String(data.id), to, ...email }, deps);
}

async function tell(client: SupabaseClient, provider: AlertProvider, level: Exclude<AlertLevel, 'ok'>, info: AlertInfo, deps: Deps) {
  const env = deps.env ?? process.env;
  const recipients = providerAlertRecipients(env);
  if (!recipients.length) return { sentTo: 0, error: 'Falta PROVIDER_ALERT_EMAILS.' };
  const email = providerAlertEmail(provider, level, info);
  const results = [];
  for (const to of recipients) results.push(await deliver(client, provider, to, email, { fetch: deps.fetch ?? fetch, env }));
  const sentTo = results.filter(result => result.ok).length;
  // Only a delivered alert counts as told: one that could not go out is tried again on the next check.
  if (sentTo) await keep(client, provider, { level, ...info, alertSentTo: sentTo }, deps.now ?? new Date());
  const failed = results.find(result => !result.ok);
  return { sentTo, ...(failed && 'error' in failed ? { error: failed.error } : {}) };
}

/** A reading of the balance: tells a shortage worse than the last one told, and notes a top-up so the next one is told. */
export async function checkProviderBalance(client: SupabaseClient, provider: AlertProvider, balance: Balance, deps: Deps = {}) {
  const level = balanceLevel(balance, lowThreshold(provider, balance, deps.env ?? process.env));
  const last = await lastAlert(client, provider);
  const info = { left: balance.left, limit: balance.limit, renewsAt: balance.renewsAt ?? null };
  if (level === 'ok') {
    if (last && last.level !== 'ok') await keep(client, provider, { level: 'ok', ...info }, deps.now ?? new Date());
    return { provider, level, alert: null };
  }
  if (last && RANK[level] <= RANK[last.level]) return { provider, level, alert: null };
  return { provider, level, alert: await tell(client, provider, level, info, deps) };
}

/** A service that answered it has no balance or refused the account: told unless a shortage as bad was told in the last day. */
export async function reportProviderOutage(client: SupabaseClient, provider: AlertProvider, level: 'empty' | 'refused', detail: string, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const last = await lastAlert(client, provider);
  if (last && RANK[level] <= RANK[last.level] && now.getTime() - last.at < DAY) return { provider, level, alert: null };
  return { provider, level, alert: await tell(client, provider, level, { detail }, { ...deps, now }) };
}

export async function checkReoonCredit(client: SupabaseClient, deps: Deps = {}) {
  const apiKey = String((deps.env ?? process.env).REOON_API_KEY || '').trim();
  if (!apiKey) return { provider: 'reoon' as const, skipped: 'REOON_API_KEY' };
  return checkProviderBalance(client, 'reoon', await readReoonBalance(apiKey, deps.fetch ?? fetch), deps);
}

export async function checkApolloCredit(client: SupabaseClient, creditUsage: unknown, deps: Deps = {}) {
  const balance = apolloBalance(creditUsage);
  if (!balance) return { provider: 'apollo' as const, skipped: 'lead_credit' };
  return checkProviderBalance(client, 'apollo', balance, deps);
}
