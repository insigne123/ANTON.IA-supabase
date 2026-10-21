import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// Apify, Resend and the database in memory: nothing leaves the test.
async function load() {
  const stubs: Record<string, string> = {
    '@/lib/server/mail-sender-preference': 'export async function readMailSenderPreference(){ return { resolved: globalThis.__mailbox ?? null } }',
    '@/lib/services/token-service': 'export const tokenService = { async getToken(){ return { refresh_token: "r" } } }',
    '@/lib/server-auth-helpers': 'export async function refreshGoogleToken(){ return { access_token: "g-token" } } export async function refreshMicrosoftToken(){ return { access_token: "m-token" } }',
  };
  const bundle = await build({
    stdin: { contents: "export * from './src/lib/server/apify-credit';", loader: 'ts', resolveDir: process.cwd() },
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

const limits = (max: number, used: number) => ({ data: {
  monthlyUsageCycle: { startAt: '2026-10-03T00:00:00.000Z', endAt: '2026-11-03T03:00:00.000Z' },
  limits: { maxMonthlyUsageUsd: max }, current: { monthlyUsageUsd: used },
} });

/** Apify answers its limits and the account name; Resend answers `resendStatus`. Every call is kept. */
function apify(max: number, used: number, resendStatus = 200) {
  const calls: { url: string; body?: any }[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/v2/users/me/limits')) return new Response(JSON.stringify(limits(max, used)));
    if (url.endsWith('/v2/users/me')) return new Response(JSON.stringify({ data: { username: 'yago-org' } }));
    if (url === 'https://api.resend.com/emails') return new Response('{}', { status: resendStatus });
    return new Response('', { status: 404 });
  };
  return { fetch, calls, emails: () => calls.filter(call => call.url === 'https://api.resend.com/emails') };
}

/** The snapshots table: what earlier checks stored this cycle, and what this one inserts. */
function database(earlier: Record<string, unknown>[] = []) {
  const inserted: any[] = [];
  const client = {
    from(table: string) {
      const query: any = {
        select: () => query, eq: () => query, not: () => query,
        limit: () => Object.assign(Promise.resolve({ data: table === 'profiles' ? [] : earlier.map(usage => ({ usage })), error: null }),
          { maybeSingle: async () => ({ data: null, error: null }) }),
        insert: async (row: unknown) => { inserted.push(row); return { error: null }; },
      };
      return query;
    },
  };
  return { client, inserted };
}

const env = { APIFY_TOKEN: 't-1', RESEND_API_KEY: 're_1', APIFY_ALERT_EMAILS: 'ops@yago.cl' };

test('the threshold, the recipients and the level read plainly', async () => {
  const { apifyLowCreditUsd, apifyAlertRecipients, creditLevel } = await load();
  assert.equal(apifyLowCreditUsd(undefined), 0.1);
  assert.equal(apifyLowCreditUsd(''), 0.1);
  assert.equal(apifyLowCreditUsd('abc'), 0.1);
  assert.equal(apifyLowCreditUsd('1.5'), 1.5);
  assert.deepEqual(apifyAlertRecipients('Ops@Yago.cl, ops@yago.cl; otra@yago.cl no-es-correo'), ['ops@yago.cl', 'otra@yago.cl']);
  assert.deepEqual(apifyAlertRecipients(undefined), []);
  assert.equal(creditLevel({ leftUsd: 4.2 }, 0.1), 'ok');
  assert.equal(creditLevel({ leftUsd: 0.1 }, 0.1), 'low');
  assert.equal(creditLevel({ leftUsd: 0.004 }, 0.1), 'empty');
});

test('what is left comes from the account limits, and the email says what stops and where to add more', async () => {
  const { readApifyCredit, apifyAlertEmail } = await load();
  const credit = await readApifyCredit('t-1', apify(5, 4.92).fetch);
  assert.deepEqual(credit, { maxUsd: 5, usedUsd: 4.92, leftUsd: 0.08, cycleStart: '2026-10-03T00:00:00.000Z', cycleEnd: '2026-11-03T03:00:00.000Z' });
  const low = apifyAlertEmail('low', credit, 'yago-org');
  assert.equal(low.subject, 'A Apify le quedan US$0,08');
  assert.match(low.text, /La cuenta de Apify de ANTON\.IA \(yago-org\) usó US\$4,92 de US\$5,00 este ciclo: quedan US\$0,08\./);
  assert.match(low.text, /dejan de funcionar la búsqueda de contactos, el «Contacto del día» y las fuentes de LinkedIn de «Oportunidades»\. El saldo se renueva el 3 de noviembre\./);
  assert.match(low.html, /href="https:\/\/console\.apify\.com\/billing"/);
  assert.match(low.html, /^<div style="background:#ffffff;color:#111827;color-scheme:light/, 'a white card of its own: readable in a dark mail client');
  const empty = apifyAlertEmail('empty', { ...credit, usedUsd: 5, leftUsd: 0 }, '<b>org</b>');
  assert.equal(empty.subject, 'Apify se quedó sin saldo');
  assert.match(empty.html, /\(&lt;b&gt;org&lt;\/b&gt;\) ya usó los US\$5,00 de este ciclo\./);
  await assert.rejects(readApifyCredit('t-1', async () => new Response('', { status: 401 })), /APIFY_HTTP_401/);
});

test('plenty left: no email, and the check is kept', async () => {
  const { checkApifyCredit } = await load();
  const api = apify(19, 3);
  const db = database();
  const result = await checkApifyCredit(db.client, { fetch: api.fetch, env });
  assert.equal(result.level, 'ok');
  assert.equal(api.emails().length, 0);
  assert.equal(db.inserted.length, 1);
  assert.equal(db.inserted[0].provider, 'apify');
  assert.equal(db.inserted[0].scope_type, 'team');
  assert.equal(db.inserted[0].cycle_start, '2026-10-03T00:00:00.000Z');
  assert.deepEqual(db.inserted[0].usage, { endpoint: 'users/me/limits', maxMonthlyUsageUsd: 19, monthlyUsageUsd: 3, leftUsd: 16, level: 'ok' });
});

test('running low emails each recipient once through Resend; the next check does not repeat it', async () => {
  const { checkApifyCredit } = await load();
  const api = apify(5, 4.95);
  const db = database();
  const result = await checkApifyCredit(db.client, { fetch: api.fetch, env: { ...env, APIFY_ALERT_EMAILS: 'ops@yago.cl, jefe@yago.cl' } });
  assert.deepEqual(result.alert, { level: 'low', sentTo: 2 });
  assert.deepEqual(api.emails().map(call => call.body.to), [['ops@yago.cl'], ['jefe@yago.cl']]);
  assert.equal(api.emails()[0].body.subject, 'A Apify le quedan US$0,05');
  assert.equal(db.inserted[0].usage.alert, 'low');

  const again = apify(5, 4.97);
  const repeat = await checkApifyCredit(database([{ alert: 'low', maxMonthlyUsageUsd: 5 }]).client, { fetch: again.fetch, env });
  assert.equal(repeat.level, 'low');
  assert.equal(repeat.alert, null);
  assert.equal(again.emails().length, 0);
});

test('running out sends its own email, and a raised limit can warn again', async () => {
  const { checkApifyCredit } = await load();
  const out = apify(5, 5);
  const result = await checkApifyCredit(database([{ alert: 'low', maxMonthlyUsageUsd: 5 }]).client, { fetch: out.fetch, env });
  assert.deepEqual(result.alert, { level: 'empty', sentTo: 1 });
  assert.equal(out.emails()[0].body.subject, 'Apify se quedó sin saldo');

  const raised = apify(10, 9.95);
  const warned = await checkApifyCredit(database([{ alert: 'low', maxMonthlyUsageUsd: 5 }, { alert: 'empty', maxMonthlyUsageUsd: 5 }]).client, { fetch: raised.fetch, env });
  assert.deepEqual(warned.alert, { level: 'low', sentTo: 1 });
});

test('an email that could not go out is not counted as sent, so the next check tries again', async () => {
  const { checkApifyCredit } = await load();
  const failing = apify(5, 4.95, 500);
  const db = database();
  const result = await checkApifyCredit(db.client, { fetch: failing.fetch, env });
  assert.deepEqual(result.alert, { level: 'low', sentTo: 0, error: 'Resend no aceptó el correo (500).' });
  assert.equal(db.inserted[0].usage.alert, undefined);
  assert.equal(db.inserted[0].usage.alertError, 'Resend no aceptó el correo (500).');

  const nobody = database();
  const unset = await checkApifyCredit(nobody.client, { fetch: apify(5, 4.95).fetch, env: { APIFY_TOKEN: 't-1', RESEND_API_KEY: 're_1' } });
  assert.deepEqual(unset.alert, { level: 'low', sentTo: 0, error: 'Falta APIFY_ALERT_EMAILS.' });

  const noSender = await checkApifyCredit(database().client, { fetch: apify(5, 4.95).fetch, env: { APIFY_TOKEN: 't-1', APIFY_ALERT_EMAILS: 'ops@yago.cl' } });
  assert.deepEqual(noSender.alert, { level: 'low', sentTo: 0, error: 'Sin Resend ni un buzón conectado de quien recibe el aviso.' });
});

test('without an Apify token there is nothing to check', async () => {
  const { checkApifyCredit } = await load();
  const db = database();
  assert.deepEqual(await checkApifyCredit(db.client, { fetch: apify(5, 0).fetch, env: {} }), { provider: 'apify', skipped: 'APIFY_TOKEN' });
  assert.equal(db.inserted.length, 0);
});
