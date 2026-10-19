import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// The mailbox, the tokens and the providers in memory: nothing leaves the test.
async function load() {
  const stubs: Record<string, string> = {
    '@/lib/server/mail-sender-preference': 'export async function readMailSenderPreference(client, userId){ return { resolved: globalThis.__mailbox ?? null } }',
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
