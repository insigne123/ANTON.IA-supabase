import assert from 'node:assert/strict';
import test from 'node:test';
import { SIGNATURE_MARKER, prepareOutboundEmail } from '@/lib/email-outbound';
import { readSendSignature, sanitizeSendSignature, signatureChannelFor } from './email-signature';

const IMAGE = 'https://yfdelflsheurzaicwayi.supabase.co/storage/v1/object/public/public/signatures/u1/firma.png';
const STORED = `<table cellpadding="0" cellspacing="0"><tr><td><img src="${IMAGE}" alt="Firma" width="320" style="display:block"></td></tr>
<tr><td style="font-family:Arial;font-size:13px">Ana Pérez · Gerenta Comercial<br><a href="https://empresa.cl">empresa.cl</a> · <a href="tel:+56912345678">+56 9 1234 5678</a></td></tr></table>`;

/** A stand-in for the admin client: one profile row with its stored signatures. */
const client = (signatures: unknown, error: unknown = null) => ({
  from(table: string) {
    assert.equal(table, 'profiles');
    return { select: (columns: string) => { assert.equal(columns, 'signatures'); return { eq: () => ({ maybeSingle: async () => ({ data: { signatures }, error }) }) }; } };
  },
});

test('the stored signature keeps its image, links and layout, and loses anything that could run or load', () => {
  const signature = sanitizeSendSignature(`${STORED}<script>alert(1)</script><img src="http://inseguro.cl/x.png"><a href="javascript:alert(1)">x</a>
    <div onclick="steal()" style="background:url(https://tracker.cl/p.png)">Hola</div><form><input value="pwd"></form>`);
  assert.ok(signature);
  assert.match(signature.html, new RegExp(`src="${IMAGE.replace(/[.?/]/g, '\\$&')}"`), 'the uploaded image over https stays');
  assert.match(signature.html, /href="https:\/\/empresa\.cl"/);
  assert.match(signature.html, /href="tel:\+56912345678"/);
  assert.match(signature.html, /cellpadding="0"/);
  for (const banned of ['<script', 'http://inseguro', 'javascript:', 'onclick', 'url(', '<form', '<input']) {
    assert.equal(signature.html.includes(banned), false, `«${banned}» must not survive`);
  }
  assert.match(signature.text, /Ana Pérez · Gerenta Comercial/);
  assert.equal(sanitizeSendSignature('<p>   </p>'), null, 'an empty signature is no signature');
  assert.deepEqual(sanitizeSendSignature('', 'Ana Pérez'), { html: '', text: 'Ana Pérez' });
});

test('the signature of the mailbox that sends is used, only when it is on, and reading it never blocks a send', async () => {
  const stored = { gmail: { enabled: true, html: STORED }, outlook: { enabled: false, html: '<p>Firma Outlook</p>' } };
  assert.equal(signatureChannelFor('google'), 'gmail');
  assert.equal(signatureChannelFor('gmail'), 'gmail');
  assert.equal(signatureChannelFor('outlook'), 'outlook');
  assert.match((await readSendSignature(client(stored), 'u1', 'google'))?.html || '', /firma\.png/);
  assert.equal(await readSendSignature(client(stored), 'u1', 'outlook'), null, '«Usar al enviar» off');
  assert.equal(await readSendSignature(client({ gmail: { html: STORED } }), 'u1', 'gmail'), null, 'never switched on: the screen shows it off');
  assert.equal((await readSendSignature(client({ gmail: { enabled: true, html: STORED, separatorPlaintext: false } }), 'u1', 'gmail'))?.separator, false);
  assert.equal(await readSendSignature(client({ gmail: { enabled: true, html: '' } }), 'u1', 'gmail'), null, 'nothing saved');
  assert.equal(await readSendSignature(client(null), 'u1', 'gmail'), null);
  assert.equal(await readSendSignature(client(stored, { message: 'boom' }), 'u1', 'gmail'), null, 'a read error sends without signature');
  assert.equal(await readSendSignature({ from() { throw new Error('no table'); } }, 'u1', 'gmail'), null);
});

test('the signature goes right after the body and before the unsubscribe footer, once, in HTML and text', () => {
  const signature = sanitizeSendSignature(STORED);
  const unsubscribeUrl = 'https://app.antonia.ai/unsubscribe?token=abc';
  const first = prepareOutboundEmail({ text: 'Hola Juan,\n\nTe escribo por la propuesta.\n\nSaludos,\nAna', unsubscribeUrl, signature });
  const body = first.html.indexOf('Te escribo');
  const signed = first.html.indexOf(SIGNATURE_MARKER);
  const footer = first.html.indexOf('darte de baja aquí');
  assert.ok(body >= 0 && signed > body && footer > signed, 'body → signature → footer');
  assert.ok(first.text.indexOf('-- \nAna Pérez') > first.text.indexOf('Saludos'), 'the text version carries it too');
  assert.ok(first.text.indexOf('darte de baja') > first.text.indexOf('-- \n'));
  // The senders prepare again before sending: the signature is not added twice.
  const again = prepareOutboundEmail({ html: first.html, text: first.text, unsubscribeUrl, signature });
  assert.equal(again.html.split(SIGNATURE_MARKER).length - 1, 1);
  assert.equal(again.text.split('-- \nAna Pérez').length - 1, 1);
  // «-- » before the plain-text signature can be turned off in «Firmas y estilo».
  const bare = prepareOutboundEmail({ text: 'Hola', unsubscribeUrl, signature: { ...signature!, separator: false } });
  assert.ok(bare.text.includes('Hola\n\nAna Pérez') && !bare.text.includes('-- \n'));
  // Without a signature nothing changes.
  const plain = prepareOutboundEmail({ text: 'Hola', unsubscribeUrl });
  assert.equal(plain.html.includes(SIGNATURE_MARKER), false);
});
