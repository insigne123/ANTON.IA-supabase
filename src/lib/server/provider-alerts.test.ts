import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// The services, Resend, Gmail and the database in memory: nothing leaves the test.
async function load() {
  const stubs: Record<string, string> = {
    '@/lib/server/mail-sender-preference': 'export async function readMailSenderPreference(){ return { resolved: globalThis.__mailbox ?? null } }',
    '@/lib/services/token-service': 'export const tokenService = { async getToken(){ return { refresh_token: "r" } } }',
    '@/lib/server-auth-helpers': 'export async function refreshGoogleToken(){ return { access_token: "g-token" } } export async function refreshMicrosoftToken(){ return { access_token: "m-token" } }',
  };
  const bundle = await build({
    stdin: { contents: "export * from './src/lib/server/provider-alerts';", loader: 'ts', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    plugins: [{ name: 'stubs', setup(builder) {
      const filter = new RegExp(`(${Object.keys(stubs).map(name => name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
      builder.onResolve({ filter }, args => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: stubs[Object.keys(stubs).find(name => args.path.endsWith(name))!] }));
    } }],
  });
  const compiled: { exports: any } = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  return compiled.exports;
}

/** Resend answers `resendStatus`, Gmail 200 and Reoon its balance. Every call is kept. */
function services(options: { resendStatus?: number; reoon?: unknown; reoonStatus?: number } = {}) {
  const calls: { url: string; body?: any }[] = [];
  const fetch = async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (url === 'https://api.resend.com/emails') return new Response('{}', { status: options.resendStatus ?? 200 });
    if (url.startsWith('https://gmail.googleapis.com/')) return new Response('{}');
    if (url.startsWith('https://emailverifier.reoon.com/api/v1/check-account-balance/')) {
      return new Response(JSON.stringify(options.reoon ?? {}), { status: options.reoonStatus ?? 200 });
    }
    return new Response('', { status: 404 });
  };
  return {
    fetch, calls,
    resend: () => calls.filter(call => call.url === 'https://api.resend.com/emails'),
    gmail: () => calls.filter(call => call.url.startsWith('https://gmail.googleapis.com/')),
  };
}

/** The snapshots table and the profiles: the latest alert of a provider, what the checks insert, and who has a mailbox. */
function database(rows: any[] = [], profiles: Record<string, string> = {}) {
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query: any = {
        select: () => query, order: () => query, limit: () => query,
        eq: (column: string, value: unknown) => { filters[column] = value; return query; },
        maybeSingle: async () => {
          if (table === 'profiles') return { data: profiles[String(filters.email)] ? { id: profiles[String(filters.email)] } : null, error: null };
          const found = rows.filter(row => Object.entries(filters).every(([column, value]) => row[column] === value))
            .sort((a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at));
          return { data: found[0] ?? null, error: null };
        },
        insert: async (row: unknown) => { rows.push(row); return { error: null }; },
      };
      return query;
    },
  };
  return { client, rows, alerts: () => rows.filter(row => row.source === 'provider_alert') };
}

const env = { RESEND_API_KEY: 're_1', PROVIDER_ALERT_EMAILS: 'ops@yago.cl' };
const credits = (left: number, limit = 3520) => ({ credit_usage_stats: { lead_credit: { limit, consumed: limit - left, left_over: left } },
  current_credit_cycle: { start_date: '2026-10-01T20:17:51.000+00:00', end_date: '2026-11-01T20:17:52.000+00:00' } });
const at = (iso: string) => new Date(iso);

test('the threshold, the recipients and the level read plainly', async () => {
  const { lowThreshold, balanceLevel, providerAlertRecipients } = await load();
  assert.equal(lowThreshold('apollo', { limit: 3520 }, {}), 352, 'a tenth of the plan');
  assert.equal(lowThreshold('reoon', { limit: null }, {}), 50, 'Reoon tells no plan');
  assert.equal(lowThreshold('reoon', { limit: null }, { REOON_LOW_CREDITS: '20' }), 20);
  assert.equal(lowThreshold('apollo', { limit: 3520 }, { APOLLO_LOW_CREDITS: 'abc' }), 352);
  assert.deepEqual(providerAlertRecipients({ APIFY_ALERT_EMAILS: 'ops@yago.cl' }), ['ops@yago.cl'], 'the Apify recipients until there are others');
  assert.deepEqual(providerAlertRecipients({ APIFY_ALERT_EMAILS: 'ops@yago.cl', PROVIDER_ALERT_EMAILS: 'Jefe@Yago.cl' }), ['jefe@yago.cl']);
  assert.equal(balanceLevel({ left: 400, limit: 3520 }, 352), 'ok');
  assert.equal(balanceLevel({ left: 352, limit: 3520 }, 352), 'low');
  assert.equal(balanceLevel({ left: 0, limit: 3520 }, 352), 'empty');
  assert.equal(balanceLevel({ left: 90, limit: null, refused: true }, 50), 'refused');
});

test('Apollo reads its lead credits from the hourly snapshot; Reoon adds today’s credits to the bought ones', async () => {
  const { apolloBalance, readReoonBalance } = await load();
  assert.deepEqual(apolloBalance(credits(838)), { left: 838, limit: 3520, renewsAt: '2026-11-01T20:17:52.000Z' });
  assert.equal(apolloBalance({}), null);
  assert.equal(apolloBalance({ credit_usage_stats: { lead_credit: { limit: 0, left_over: 0 } } }), null, 'a plan without lead credits is not read');

  const api = services({ reoon: { api_status: 'active', remaining_daily_credits: 8, remaining_instant_credits: 100, status: 'success' } });
  assert.deepEqual(await readReoonBalance('k-1', api.fetch), { left: 108, limit: null });
  const url = new URL(api.calls[0].url);
  assert.equal(url.origin + url.pathname, 'https://emailverifier.reoon.com/api/v1/check-account-balance/');
  assert.equal(url.searchParams.get('key'), 'k-1');
  const inactive = services({ reoon: { api_status: 'inactive', status: 'success' } });
  assert.deepEqual(await readReoonBalance('k-1', inactive.fetch), { left: 0, limit: null, refused: true });
  await assert.rejects(readReoonBalance('k-1', services({ reoonStatus: 500 }).fetch), /REOON_BALANCE_HTTP_500/);
});

test('the email says what is left, what stops, when it renews and where to add more', async () => {
  const { providerAlertEmail } = await load();
  const low = providerAlertEmail('apollo', 'low', { left: 300, limit: 3520, renewsAt: '2026-11-01T20:17:52.000Z' });
  assert.equal(low.subject, 'A Apollo le quedan 300 créditos');
  assert.match(low.text, /La cuenta de Apollo de ANTON\.IA usó 3\.220 de 3\.520 créditos: quedan 300\./);
  assert.match(low.text, /Cuando se acabe, se detiene: pedir el correo y el teléfono de los contactos, en la app y en Cowork\. Se renueva el 1 de noviembre\./);
  assert.match(low.html, /href="https:\/\/app\.apollo\.io\/"/);
  assert.match(low.html, /^<div style="background:#ffffff;color:#111827;color-scheme:light/, 'a white card of its own: readable in a dark mail client');
  const empty = providerAlertEmail('openai', 'empty', { detail: 'insufficient_quota' });
  assert.equal(empty.subject, 'OpenAI se quedó sin saldo');
  assert.match(empty.text, /OpenAI respondió que la cuenta de ANTON\.IA no tiene saldo \(insufficient_quota\)\./);
  assert.match(empty.text, /Para seguir, recarga o sube el plan en OpenAI\./);
  const refused = providerAlertEmail('serper', 'refused', { detail: '<b>Unauthorized</b>' });
  assert.equal(refused.subject, 'Serper rechazó la cuenta de ANTON.IA');
  assert.match(refused.html, /\(&lt;b&gt;Unauthorized&lt;\/b&gt;\): puede ser la clave, la suscripción o el saldo\./);
});

test('a balance tells once when low and once when out, and again only after a top-up', async () => {
  const { checkApolloCredit } = await load();
  const db = database();
  const run = async (left: number, now: string) => {
    const api = services();
    const result = await checkApolloCredit(db.client, credits(left), { fetch: api.fetch, env, now: at(now) });
    return { result, emails: api.resend() };
  };

  let step = await run(838, '2026-10-29T18:00:00Z');
  assert.equal(step.result.level, 'ok');
  assert.equal(step.emails.length, 0);
  assert.equal(db.rows.length, 0, 'nothing to keep while nothing was told');

  step = await run(300, '2026-10-29T19:00:00Z');
  assert.deepEqual(step.result.alert, { sentTo: 1 });
  assert.deepEqual(step.emails.map(call => [call.body.to, call.body.subject]), [[['ops@yago.cl'], 'A Apollo le quedan 300 créditos']]);
  assert.deepEqual(db.alerts().map(row => [row.provider, row.scope_type, row.usage.level, row.usage.alertSentTo]), [['apollo', 'team', 'low', 1]]);

  step = await run(120, '2026-10-29T20:00:00Z');
  assert.equal(step.result.alert, null, 'low again is not news');

  step = await run(0, '2026-10-29T21:00:00Z');
  assert.equal(step.emails[0].body.subject, 'Apollo se quedó sin créditos');

  step = await run(3520, '2026-11-01T21:00:00Z');
  assert.equal(step.result.level, 'ok');
  assert.equal(step.emails.length, 0);
  assert.equal(db.alerts().at(-1).usage.level, 'ok', 'the top-up is kept so the next shortage is told');

  step = await run(200, '2026-11-20T12:00:00Z');
  assert.equal(step.emails[0].body.subject, 'A Apollo le quedan 200 créditos');
});

test('Reoon: out of credits is told once, and today’s credits coming back are not news', async () => {
  const { checkReoonCredit } = await load();
  const db = database();
  const reoon = (daily: number, instant: number) => services({ reoon: { api_status: 'active', remaining_daily_credits: daily, remaining_instant_credits: instant, status: 'success' } });
  const out = reoon(0, 0);
  const told = await checkReoonCredit(db.client, { fetch: out.fetch, env: { ...env, REOON_API_KEY: 'k-1' }, now: at('2026-10-30T10:00:00Z') });
  assert.equal(told.level, 'empty');
  assert.equal(out.resend()[0].body.subject, 'Reoon se quedó sin créditos');
  const back = reoon(10, 0);
  const daily = await checkReoonCredit(db.client, { fetch: back.fetch, env: { ...env, REOON_API_KEY: 'k-1' }, now: at('2026-10-31T10:00:00Z') });
  assert.equal(daily.level, 'low');
  assert.equal(daily.alert, null);
  assert.equal(back.resend().length, 0);
  assert.deepEqual(await checkReoonCredit(db.client, { fetch: back.fetch, env }), { provider: 'reoon', skipped: 'REOON_API_KEY' });
});

test('a refusal from the service is told at most once a day', async () => {
  const { reportProviderOutage } = await load();
  const db = database();
  const report = async (now: string, level = 'empty') => {
    const api = services();
    const result = await reportProviderOutage(db.client, 'openai', level, 'insufficient_quota', { fetch: api.fetch, env, now: at(now) });
    return { result, emails: api.resend() };
  };
  let step = await report('2026-10-29T10:00:00Z');
  assert.equal(step.emails[0].body.subject, 'OpenAI se quedó sin saldo');
  step = await report('2026-10-29T11:00:00Z');
  assert.equal(step.result.alert, null);
  step = await report('2026-10-29T12:00:00Z', 'refused');
  assert.equal(step.result.alert, null, 'refused is no worse than empty');
  step = await report('2026-10-30T10:30:00Z');
  assert.equal(step.emails.length, 1, 'a day later it is told again');
});

test('Resend’s own alert, and any Resend does not take, go from the recipient’s mailbox', async () => {
  const { reportProviderOutage } = await load();
  (globalThis as any).__mailbox = 'google';
  try {
    const db = database([], { 'ops@yago.cl': 'user-1' });
    const api = services();
    const own = await reportProviderOutage(db.client, 'resend', 'empty', 'cupo de envíos del plan', { fetch: api.fetch, env, now: at('2026-10-29T10:00:00Z') });
    assert.deepEqual(own.alert, { sentTo: 1 });
    assert.equal(api.resend().length, 0, 'never through Resend itself');
    assert.equal(api.gmail().length, 1);

    const refused = services({ resendStatus: 500 });
    const other = await reportProviderOutage(db.client, 'serper', 'empty', 'Not enough credits', { fetch: refused.fetch, env, now: at('2026-10-29T10:00:00Z') });
    assert.deepEqual(other.alert, { sentTo: 1 });
    assert.equal(refused.resend().length, 1);
    assert.equal(refused.gmail().length, 1);
  } finally {
    delete (globalThis as any).__mailbox;
  }
});

test('an alert that could not go out is not kept, so the next check tries again; without recipients nothing is sent', async () => {
  const { reportProviderOutage, checkApolloCredit } = await load();
  const db = database();
  const failing = services({ resendStatus: 500 });
  const result = await reportProviderOutage(db.client, 'anthropic', 'empty', 'credit balance is too low', { fetch: failing.fetch, env, now: at('2026-10-29T10:00:00Z') });
  assert.equal(result.alert.sentTo, 0);
  assert.match(result.alert.error, /buzón/);
  assert.equal(db.rows.length, 0);

  const nobody = services();
  const silent = await checkApolloCredit(db.client, credits(0), { fetch: nobody.fetch, env: { RESEND_API_KEY: 're_1' }, now: at('2026-10-29T10:00:00Z') });
  assert.deepEqual(silent.alert, { sentTo: 0, error: 'Falta PROVIDER_ALERT_EMAILS.' });
  assert.equal(nobody.calls.length, 0);
  assert.equal(db.rows.length, 0);
});
