import type { SupabaseClient } from '@supabase/supabase-js';
import { dayStartInZone, shiftDay } from '@/lib/admin/chile-time';
import { opportunityLocalClock } from '@/lib/commercial-opportunities/workspace';
import { emailShell } from '@/lib/email-shell';
import { reportSourceSilence } from '@/lib/server/provider-alerts';
import { isCompraAgilOutage, isCompraAgilTimeout } from './compra-agil';

/**
 * The sources of «Oportunidades» watched from outside, after 7 to 9 Nov 2026: Compra Ágil failed for three days (24 of 28
 * daily searches, «504»), nothing new arrived and the page said it with the same small line as any other day.
 * - requeueFailedCompraAgil: in the afternoon, today's searches that failed because Mercado Público did not answer get one
 *   more round, instead of waiting for tomorrow's.
 * - checkOpportunitySources: an email to the platform's alert recipients when a source ran two days in a row and brought
 *   nothing new either day. Once while it lasts; told again after the source brings results and goes silent again.
 */
type Fetch = typeof fetch;
type Env = Record<string, string | undefined>;
type Deps = { fetch?: Fetch; env?: Env; now?: Date };

/** From this hour (America/Santiago) the afternoon round is queued: the morning's tries end within the hour they start. */
export const AFTERNOON_RETRY_HOUR = 14;
/** In this hour and the next the day is judged: the daily searches and the afternoon round are done. Two hourly ticks, so one that fails is not the day's only chance. */
export const SOURCE_CHECK_HOUR = 17;

const unwrap = <T>(result: { data: T | null; error: unknown }) => { if (result.error) throw result.error; return result.data; };

/**
 * Today's failed Compra Ágil searches of the daily run (`prefix`, daily:<day>:<revision>), queued once more. Only the ones
 * Mercado Público failed (never a rejected ticket), and only once (`payload.afternoon`); one that timed out asks pages of 10.
 */
export async function requeueFailedCompraAgil(client: SupabaseClient, organizationId: string, prefix: string) {
  const failed = unwrap(await client.from('opportunity_jobs').select('id,payload,error')
    .eq('organization_id', organizationId).eq('kind', 'tenders').eq('state', 'failed').like('dedupe_key', `${prefix}:tenders:agil:%`).limit(50)) || [];
  let queued = 0;
  for (const job of failed as Array<{ id: string; payload: Record<string, unknown> | null; error: string | null }>) {
    if (job.payload?.afternoon || !isCompraAgilOutage(job.error)) continue;
    const payload = { ...(job.payload || {}), afternoon: true, ...(isCompraAgilTimeout(job.error) ? { small: true } : {}) };
    // Only while still failed: a concurrent tick that queued it first keeps it.
    const updated = unwrap(await client.from('opportunity_jobs').update({ state: 'queued', attempts: 0, error: null, result: null, payload, updated_at: new Date().toISOString() })
      .eq('id', job.id).eq('state', 'failed').select('id').maybeSingle());
    if (updated) queued += 1;
  }
  return queued;
}

export const OPPORTUNITY_SOURCES = {
  tender: { name: 'Licitaciones de Mercado Público', job: 'tenders', agil: false },
  compra_agil: { name: 'Compra Ágil', job: 'tenders', agil: true },
  hiring: { name: '«Empresas contratando»', job: 'hiring', agil: false },
} as const;
export type OpportunitySource = keyof typeof OPPORTUNITY_SOURCES;
type DayHealth = { day: string; searches: number; failed: number; found: number };

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const dayLabel = (day: string) => new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));

/** The alert: which source, since when, how its searches ended and where to look. */
export function sourceSilenceEmail(source: OpportunitySource, days: DayHealth[], appUrl: string) {
  const { name } = OPPORTUNITY_SOURCES[source];
  const subject = `${name} lleva ${days.length} días sin traer oportunidades`;
  const lines = days.map(day => `${dayLabel(day.day)}: ${day.failed === day.searches ? `fallaron las ${day.searches} búsquedas` : day.failed ? `fallaron ${day.failed} de ${day.searches} búsquedas` : `las ${day.searches} búsquedas terminaron`}, 0 oportunidades nuevas.`);
  const cause = days.every(day => day.failed === day.searches)
    ? 'Todas las búsquedas fallaron: lo más probable es que la fuente no esté respondiendo o que la cuenta que la paga se haya quedado sin saldo.'
    : 'Las búsquedas terminaron sin resultados nuevos: puede ser normal en días de poca publicación, o que las palabras de búsqueda ya no calcen.';
  const paragraphs = [`${name} no trajo ninguna oportunidad nueva a ninguna organización en los últimos ${days.length} días.`, cause,
    'Mientras dure, «Oportunidades» y el aviso de la mañana muestran menos de lo que hay.'];
  const url = `${appUrl.replace(/\/$/, '')}/dashboard/admin`;
  const footer = 'Avisamos una vez mientras dure; si la fuente vuelve y se detiene otra vez, avisamos de nuevo.';
  const text = [...paragraphs, '', ...lines, '', `Abrir Administración: ${url}`, '', footer].join('\n');
  const html = emailShell(`<h1 style="margin:0 0 12px;font-size:20px;line-height:28px">${escape(subject)}</h1>`
    + paragraphs.map(paragraph => `<p style="margin:0 0 12px;font-size:15px;line-height:22px">${escape(paragraph)}</p>`).join('')
    + `<ul style="margin:0 0 12px;padding-left:20px;font-size:14px;line-height:22px">${lines.map(line => `<li>${escape(line)}</li>`).join('')}</ul>`
    + `<p style="margin:20px 0 0"><a href="${escape(url)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#111827;color:#ffffff;text-decoration:none;font-size:14px">Abrir Administración</a></p>`
    + `<p style="margin:20px 0 0;font-size:12px;line-height:18px;color:#6b7280">${escape(footer)}</p>`);
  return { subject, text, html };
}

/** One source on one day, across every organization: the daily searches that ran, how many failed and what arrived. */
async function dayHealth(client: SupabaseClient, source: OpportunitySource, day: string): Promise<DayHealth> {
  const { job, agil } = OPPORTUNITY_SOURCES[source];
  const from = dayStartInZone(day).toISOString();
  const to = dayStartInZone(shiftDay(day, 1)).toISOString();
  const jobs = (state?: string) => {
    let query = client.from('opportunity_jobs').select('id', { count: 'exact', head: true }).eq('kind', job).like('dedupe_key', `daily:${day}:%`);
    query = agil ? query.like('dedupe_key', '%:agil:%') : query.not('dedupe_key', 'like', '%:agil:%');
    return state ? query.eq('state', state) : query;
  };
  const count = async (query: PromiseLike<{ count: number | null; error: unknown }>) => { const result = await query; if (result.error) throw result.error; return result.count ?? 0; };
  const [searches, failed, found] = await Promise.all([count(jobs()), count(jobs('failed')),
    count(client.from('commercial_opportunities').select('id', { count: 'exact', head: true }).eq('kind', source).gte('created_at', from).lt('created_at', to))]);
  return { day, searches, failed, found };
}

/**
 * Once the day's searches are done: a source that ran today and yesterday and brought nothing new either day is told to the
 * platform's alert recipients (PROVIDER_ALERT_EMAILS). Outside SOURCE_CHECK_HOUR and the hour after it nothing is read.
 */
export async function checkOpportunitySources(client: SupabaseClient, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const clock = opportunityLocalClock(now);
  if (clock.hour < SOURCE_CHECK_HOUR || clock.hour > SOURCE_CHECK_HOUR + 1) return { checked: false as const, sources: [] };
  const env = deps.env ?? process.env;
  const sources = [];
  for (const source of Object.keys(OPPORTUNITY_SOURCES) as OpportunitySource[]) {
    const days = [await dayHealth(client, source, shiftDay(clock.day, -1)), await dayHealth(client, source, clock.day)];
    // A source nobody has on, or that did not run one of the days, says nothing either way.
    if (days.some(day => !day.searches)) { sources.push({ source, silent: false, alert: null, skipped: true as const }); continue; }
    const silent = days.every(day => day.found === 0);
    const email = silent ? sourceSilenceEmail(source, days, String(env.NEXT_PUBLIC_APP_URL || env.NEXT_PUBLIC_BASE_URL || 'https://app.antonia.ai')) : null;
    sources.push(await reportSourceSilence(client, source, silent, email, { days }, { ...deps, now }));
  }
  return { checked: true as const, sources };
}
