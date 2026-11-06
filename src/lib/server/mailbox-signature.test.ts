import test from 'node:test';
import assert from 'node:assert/strict';
import { readMailboxSignature } from './mailbox-signature';

const reply = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body }) as unknown as Response;

test('Outlook: the signature of the sent emails, with its photo as bytes; what the app sent is skipped', async () => {
  const calls: string[] = [];
  const request = (async (url: string) => {
    calls.push(String(url));
    if (String(url).includes('/mailFolders/SentItems/messages')) return reply({ value: [
      { id: 'app', body: { content: '<div id="Signature">Firma de la app</div><a href="https://app.example/unsubscribe?t=1">baja</a>' } },
      { id: 'm1', body: { content: '<div>Hola</div><div id="Signature"><p>Pedro Soto</p><img src="cid:image001.png@01DB"></div>' } },
      { id: 'm2', body: { content: '<div>Otro</div><div id="Signature"><p>Pedro Soto</p><img src="cid:image001.png@02AA"></div>' } },
    ] });
    if (/\/attachments\?/.test(String(url))) return reply({ value: [{ id: 'att1', contentId: '<image001.png@01DB>', contentType: 'image/png', size: 2048, isInline: true }] });
    if (/\/attachments\/att1$/.test(String(url))) return reply({ contentType: 'image/png', contentBytes: 'iVBORw0KGgo=' });
    return reply({}, false);
  }) as typeof fetch;
  const result = await readMailboxSignature('user', 'outlook', { token: async () => 'token', request });
  assert.equal(result.provider, 'outlook');
  assert.match(result.html || '', /Pedro Soto/);
  assert.match(result.html || '', /data:image\/png;base64,iVBORw0KGgo=/);
  assert.ok(!calls.some(url => url.includes('/messages/app/')), 'the email the app sent is never read');
});

test('Gmail: the signature of the default address', async () => {
  const request = (async () => reply({ sendAs: [
    { sendAsEmail: 'otro@example.com', signature: '<div>Otra</div>' },
    { sendAsEmail: 'pedro@example.com', isDefault: true, signature: '<div>Pedro Soto <img src="https://lh3.googleusercontent.com/x"></div>' },
  ] })) as typeof fetch;
  const result = await readMailboxSignature('user', 'gmail', { token: async () => 'token', request });
  assert.match(result.html || '', /Pedro Soto/);
});

test('without a connection or a signature it says why', async () => {
  assert.deepEqual(await readMailboxSignature('user', 'outlook', { token: async () => null }), { provider: 'outlook', html: null, reason: 'not_connected' });
  const empty = (async () => reply({ value: [{ id: 'm1', body: { content: '<p>Hola</p>' } }] })) as typeof fetch;
  assert.equal((await readMailboxSignature('user', 'outlook', { token: async () => 'token', request: empty })).reason, 'not_found');
  const broken = (async () => reply({}, false)) as typeof fetch;
  const warn = console.warn; console.warn = () => {};
  try { assert.equal((await readMailboxSignature('user', 'gmail', { token: async () => 'token', request: broken })).reason, 'unavailable'); }
  finally { console.warn = warn; }
});
