import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { pickRecurringSignature, signatureContentIds, signatureFromSentHtml, withInlineImages } from './mailbox-signature';

const parse = (html: string) => new JSDOM(html).window.document;

// Fictional people and companies.
const webOutlook = `<html><body><div>Hola Ana, te escribo por…</div>
  <div id="Signature"><p><b>Pedro Soto</b><br>Gerente Comercial · Empresa Ejemplo</p><img src="cid:image001.png@01DB2F3A.4B5C6D70" width="120"></div>
  <div id="appendonsend"></div><hr><div id="divRplyFwdMsg"><b>De:</b> Ana <div id="Signature">La firma de Ana</div></div></body></html>`;
const wordOutlook = `<html><body><div class="WordSection1"><p class="MsoNormal">Estimado Juan:</p><p class="MsoNormal">Gracias por tu tiempo.</p>
  <p class="MsoNormal"><a name="_MailAutoSig"><b>Pedro Soto</b></a></p><p class="MsoNormal">+56 9 1234 5678</p>
  <p class="MsoNormal"><img src="cid:image002.jpg@01DB2F3A.4B5C6D70"></p>
  <div id="divRplyFwdMsg"><p>From: Juan</p><p>texto citado</p></div></div></body></html>`;

test('the signature Outlook marks comes out, without the quoted email', () => {
  const html = signatureFromSentHtml(webOutlook, parse)!;
  assert.match(html, /Pedro Soto/);
  assert.match(html, /cid:image001\.png@01DB2F3A\.4B5C6D70/);
  assert.doesNotMatch(html, /La firma de Ana/);
});

test('Outlook on the desktop: from its «_MailAutoSig» mark to the quoted email', () => {
  const html = signatureFromSentHtml(wordOutlook, parse)!;
  assert.match(html, /Pedro Soto/);
  assert.match(html, /1234 5678/);
  assert.match(html, /cid:image002\.jpg/);
  assert.doesNotMatch(html, /Gracias por tu tiempo|texto citado/);
});

test('an email without a marked signature gives none', () => {
  assert.equal(signatureFromSentHtml('<html><body><p>Hola</p><p>Pedro</p></body></html>', parse), null);
  assert.equal(signatureFromSentHtml('solo texto', parse), null);
});

test('the signature most emails carry wins over a one-off', () => {
  const usual = { id: 'a', html: '<p>Pedro Soto</p><img src="cid:image001.png@01">' };
  const again = { id: 'b', html: '<p>Pedro  Soto</p><img src="cid:image001.png@02">' };
  const once = { id: 'c', html: '<p>Pedro, desde mi teléfono</p>' };
  assert.equal(pickRecurringSignature([once, usual, again], parse)?.id, 'a');
  assert.equal(pickRecurringSignature([], parse), null);
});

test('the inline images become their bytes, so the app can upload them', () => {
  const html = '<p>Pedro</p><img src="cid:image001.png@01DB"><img src=\'cid:logo@02\'>';
  assert.deepEqual(signatureContentIds(html), ['image001.png@01DB', 'logo@02']);
  const done = withInlineImages(html, new Map([['image001.png@01DB', { contentType: 'image/png', base64: 'AAAA' }]]));
  assert.match(done, /src="data:image\/png;base64,AAAA"/);
  assert.match(done, /src='cid:logo@02'/, 'an image not found stays as it was (the upload step reports it)');
});
