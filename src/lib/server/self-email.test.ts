import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// The mailbox, the tokens and the providers in memory: nothing leaves the test.
async function load() {
  const stubs: Record<string, string> = {
    '@/lib/server/mail-sender-preference': 'export async function readMailSenderPreference(client, userId){ return { resolved: globalThis.__mailboxes?.[userId] ?? globalThis.__mailbox ?? null } }',
    '@/lib/services/token-service': 'export const tokenService = { async getToken(client, userId, provider){ return globalThis.__token === undefined ? { refresh_token: "r" } : globalThis.__token } }',
    '@/lib/server-auth-helpers': 'export async function refreshGoogleToken(){ return { access_token: "g-token" } } export async function refreshMicrosoftToken(){ return { access_token: "m-token" } }',
  };
  const bundle = await build({
    stdin: { contents: "export * from './src/lib/server/self-email';", loader: 'ts', resolveDir: process.cwd() },
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

const email = { userId: 'u-1', to: 'nico@axis.cl', subject: 'Tu informe semanal · 12–18 oct', html: '<p>Hola</p>', text: 'Hola' };

test('the message is multipart, UTF-8, with the subject encoded and nothing of prospecting', async () => {
  const { selfMime } = await load();
  const mime = selfMime(email, 'b1');
  assert.match(mime, /^To: nico@axis\.cl\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(mime, /Content-Type: multipart\/alternative; boundary="b1"/);
  assert.match(mime, /--b1\r\nContent-Type: text\/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\nSG9sYQ==/);
  assert.match(mime, /--b1--\r\n$/);
  assert.doesNotMatch(mime, /List-Unsubscribe|X-Anton-Dispatch/i);
});

test('it goes from the person\'s own Gmail or Outlook, and says plainly what is missing', async () => {
  const { sendSelfEmail } = await load();
  const calls: any[] = [];
  const fetcher = (async (url: string, init: any) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); }) as any;
  const env = { NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' };

  (globalThis as any).__mailbox = 'google'; (globalThis as any).__token = undefined;
  assert.deepEqual(await sendSelfEmail({} as any, email, { fetch: fetcher, env }), { ok: true });
  assert.equal(calls[0].url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer g-token');
  assert.match(Buffer.from(JSON.parse(calls[0].init.body).raw, 'base64url').toString(), /To: nico@axis\.cl/);

  (globalThis as any).__mailbox = 'outlook';
  assert.deepEqual(await sendSelfEmail({} as any, email, { fetch: fetcher, env }), { ok: true });
  assert.equal(calls[1].url, 'https://graph.microsoft.com/v1.0/me/sendMail');
  assert.deepEqual(JSON.parse(calls[1].init.body).message.toRecipients, [{ emailAddress: { address: 'nico@axis.cl' } }]);

  (globalThis as any).__mailbox = null;
  assert.match((await sendSelfEmail({} as any, email, { fetch: fetcher, env })).error, /Conecta Gmail u Outlook/);
  (globalThis as any).__mailbox = 'google'; (globalThis as any).__token = null;
  assert.match((await sendSelfEmail({} as any, email, { fetch: fetcher, env })).error, /Reconecta tu correo/);
  (globalThis as any).__token = undefined;
  assert.match((await sendSelfEmail({} as any, { ...email, to: 'nico@axis.cl\r\nBcc: x@y.cl' }, { fetch: fetcher, env })).error, /no tiene un correo válido/, 'no header injection');
  assert.match((await sendSelfEmail({} as any, email, { fetch: fetcher, env: { ...env, WEEKLY_REPORTS_EMAIL: 'off' } })).error, /apagado/);
  const rejected = (async () => new Response('no', { status: 403 })) as any;
  assert.match((await sendSelfEmail({} as any, email, { fetch: rejected, env })).error, /Gmail no aceptó el correo \(403\)/);
  assert.equal(calls.length, 2, 'nothing else was sent');
});

test('whoever has no mailbox gets it from the reports mailbox, to their own address; a failing mailbox is not replaced', async () => {
  const { sendReportEmail } = await load();
  const calls: any[] = [];
  const fetcher = (async (url: string, init: any) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); }) as any;
  const env = { NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', WEEKLY_REPORTS_SENDER_USER_ID: 'sender' };
  (globalThis as any).__mailbox = undefined; (globalThis as any).__token = undefined;
  (globalThis as any).__mailboxes = { sender: 'google' };
  assert.deepEqual(await sendReportEmail({} as any, email, { fetch: fetcher, env }), { ok: true });
  assert.match(Buffer.from(JSON.parse(calls[0].init.body).raw, 'base64url').toString(), /To: nico@axis\.cl/, 'to the person, not to the sender');
  (globalThis as any).__mailboxes = { 'u-1': 'outlook', sender: 'google' };
  assert.deepEqual(await sendReportEmail({} as any, email, { fetch: fetcher, env }), { ok: true });
  assert.equal(calls[1].url, 'https://graph.microsoft.com/v1.0/me/sendMail', 'their own mailbox first');
  (globalThis as any).__mailboxes = { 'u-1': 'google', sender: 'google' };
  const rejected = (async () => new Response('no', { status: 403 })) as any;
  assert.match((await sendReportEmail({} as any, email, { fetch: rejected, env })).error, /Gmail no aceptó/, 'their failing mailbox is the answer');
  (globalThis as any).__mailboxes = {};
  assert.match((await sendReportEmail({} as any, email, { fetch: fetcher, env: { ...env, WEEKLY_REPORTS_SENDER_USER_ID: '' } })).error, /Conecta Gmail u Outlook/, 'without a reports mailbox, as before');
  assert.equal(calls.length, 2);
  (globalThis as any).__mailboxes = undefined;
});

test('with RESEND_API_KEY everything goes out from the Yago address through Resend, with its files; a 429 waits and retries', async () => {
  const { sendReportEmail, canEmailEveryone } = await load();
  const calls: any[] = [];
  let answers = [200];
  const fetcher = (async (url: string, init: any) => { calls.push({ url, init }); return new Response('{}', { status: answers.shift() ?? 200 }); }) as any;
  const waits: number[] = [];
  const wait = async (ms: number) => { waits.push(ms); };
  const env = { RESEND_API_KEY: 're_test', REPORTS_FROM_EMAIL: 'ANTON.IA <avisos@yago.cl>' };
  (globalThis as any).__mailboxes = { 'u-1': 'google' };
  const file = { filename: 'contacto-del-dia-2026-10-21.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF') };
  assert.deepEqual(await sendReportEmail({} as any, { ...email, attachments: [file] }, { fetch: fetcher, env, wait }), { ok: true });
  assert.equal(calls[0].url, 'https://api.resend.com/emails', 'not the person\'s own mailbox');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual([body.from, body.to, body.subject, body.text], ['ANTON.IA <avisos@yago.cl>', ['nico@axis.cl'], email.subject, 'Hola']);
  assert.deepEqual(body.attachments, [{ filename: 'contacto-del-dia-2026-10-21.pdf', content: Buffer.from('%PDF').toString('base64') }]);
  answers = [429, 200];
  assert.deepEqual(await sendReportEmail({} as any, email, { fetch: fetcher, env, wait }), { ok: true });
  assert.deepEqual(waits, [1000]);
  answers = [500];
  assert.match((await sendReportEmail({} as any, email, { fetch: fetcher, env, wait })).error, /Resend no aceptó el correo \(500\)/);
  const before = calls.length;
  assert.match((await sendReportEmail({} as any, { ...email, to: 'smoke+1@example.com' }, { fetch: fetcher, env, wait })).error, /dirección de prueba/);
  assert.match((await sendReportEmail({} as any, email, { fetch: fetcher, env: { ...env, WEEKLY_REPORTS_EMAIL: 'off' }, wait })).error, /apagado/);
  assert.equal(calls.length, before, 'nothing goes to a test address or with the emails off');
  assert.equal(canEmailEveryone(env), true);
  assert.equal(canEmailEveryone({ WEEKLY_REPORTS_SENDER_USER_ID: 'sender' }), true);
  assert.equal(canEmailEveryone({}), false);
  (globalThis as any).__mailboxes = undefined;
});

test('test addresses are the reserved ones, not a customer\'s', async () => {
  const { isTestAddress } = await load();
  for (const address of ['a@example.com', 'smoke+2@example.org', 'e2e@local.test', 'x@foo.localhost', 'y@app.invalid']) assert.equal(isTestAddress(address), true, address);
  for (const address of ['ana@grupoexpro.com', 'jefa@psol-latam.cl', 'nico@yago.cl', 'p@examples.com', '']) assert.equal(isTestAddress(address), false, address);
});
