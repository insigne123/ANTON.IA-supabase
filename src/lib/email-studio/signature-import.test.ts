import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { sanitizeSendSignature } from '@/lib/server/email-signature';
import { buildSignatureHtml, buildSignatureText, signatureProblem } from './signature-builder';
import { decodeSignatureFile, hasPendingImages, importSignatureHtml, pendingImageUrl, placeUploadedImages } from './signature-import';

const view = () => new JSDOM('').window as unknown as Parameters<typeof importSignatureHtml>[1];

// As Gmail puts a signature on the clipboard: a div with inline styles, links and an https image.
const GMAIL = `<meta charset="utf-8"><div dir="ltr"><div><b style="color:rgb(31,41,55)">Ana Pérez</b></div>
<div style="color:#6b7280">Gerenta Comercial · Empresa Demo SpA</div>
<div><a href="https://empresa-demo.cl" target="_blank">empresa-demo.cl</a> · <a href="tel:+56912345678">+56 9 1234 5678</a></div>
<img src="https://ci3.googleusercontent.com/logo.png" width="96" height="40" alt="Empresa Demo"></div>`;

test('a signature pasted from Gmail keeps its text, links and images, and is what the server sends', () => {
  const result = importSignatureHtml(GMAIL, view());
  assert.equal(result.dropped, 0);
  assert.deepEqual(result.embedded, []);
  for (const part of ['Ana Pérez', 'Gerenta Comercial', 'href="https://empresa-demo.cl"', 'href="tel:+56912345678"', 'src="https://ci3.googleusercontent.com/logo.png"', 'width="96"']) {
    assert.ok(result.html.includes(part), `«${part}» is kept`);
  }
  assert.doesNotMatch(result.html, /<meta|dir=/, 'what the clipboard adds is left out');
  // Saved as «Tu firma actual»: the builder hands it over as it is, and the send-time cleaning keeps all of it.
  assert.equal(buildSignatureHtml({ customHtml: result.html }, 'propia'), result.html);
  assert.equal(buildSignatureText({ customHtml: result.html }, 'propia'), '', 'the server reads the text out of it');
  const sent = sanitizeSendSignature(result.html);
  assert.ok(sent);
  for (const part of ['Ana Pérez', 'https://empresa-demo.cl', 'tel:+56912345678', 'https://ci3.googleusercontent.com/logo.png']) assert.ok(sent.html.includes(part), part);
  assert.match(sent.text, /Ana Pérez\s*\n\s*Gerenta Comercial/);
});

test('nothing that runs or loads something survives, and Outlook markup is trimmed', () => {
  const pasted = `<!--[if gte mso 9]><xml><o:OfficeDocumentSettings/></xml><![endif]-->
<p class=MsoNormal style="mso-margin-top-alt:auto;color:#1f2937;background:url(https://evil.example/x.png)">Ana</p>
<p class=MsoNormal style='mso-line-height-alt:12pt;font-size:10pt;color:#1f2937'>Gerenta <span onclick="alert(1)">Comercial</span></p>
<script>alert(1)</script><form><input name="x"></form><a href="javascript:alert(1)">clic</a><iframe src="https://evil.example"></iframe>
<p class=MsoNormal>&nbsp;</p><p class=MsoNormal>&nbsp;</p>`;
  const { html } = importSignatureHtml(pasted, view());
  assert.match(html, /Ana/);
  assert.match(html, /style="font-size:10pt;color:#1f2937"/, 'the «mso-» declarations are dropped and the rest is kept');
  assert.doesNotMatch(html, /mso-|class=|MsoNormal/i);
  assert.doesNotMatch(html, /url\(|evil\.example|<script|onclick|<form|<input|<iframe|javascript:/i);
  assert.doesNotMatch(html, /&nbsp;<\/p>\s*$/, 'the empty paragraphs Outlook adds at the end go');
});

test('embedded images are handed back to upload; images on the computer are counted and left out', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const result = importSignatureHtml(`<p>Ana</p><img src="${png}" width="80"><img src="Firma_archivos/image001.png"><img src="cid:image002.jpg@01DA">`
    + '<img src="http://cdn.empresa-demo.cl/logo.jpg">', view());
  assert.equal(result.dropped, 2);
  assert.deepEqual(result.embedded, [{ dataUrl: png, type: 'image/png' }]);
  assert.ok(result.html.includes(`src="${pendingImageUrl(0)}"`));
  assert.ok(result.html.includes('src="https://cdn.empresa-demo.cl/logo.jpg"'), 'http becomes https');
  assert.ok(hasPendingImages(result.html));
  const placed = placeUploadedImages(result.html, ['https://storage.example/firma.png']);
  assert.ok(placed.includes('src="https://storage.example/firma.png"'));
  assert.equal(hasPendingImages(placed), false);
  const failed = placeUploadedImages(result.html, [null]);
  assert.doesNotMatch(failed, /<img[^>]+firma\.invalid/, 'an image that could not be uploaded is removed');
});

test('plain text becomes one line each, and empty or oversized pastes are refused', () => {
  const { html } = importSignatureHtml('\nAna Pérez\nGerenta <Comercial>\n+56 9 1234 5678\n\n', view());
  assert.match(html, /Ana Pérez<br>Gerenta &lt;Comercial&gt;<br>\+56 9 1234 5678/);
  assert.equal(importSignatureHtml('   ', view()).html, '');
  assert.equal(importSignatureHtml('<p> </p><script>x</script>', view()).html, '', 'nothing to sign with');
  const long = importSignatureHtml(`<p>${'Ana Pérez · '.repeat(2500)}</p>`, view());
  assert.equal(long.tooLong, true);
  assert.equal(signatureProblem({ customHtml: long.html }, 'propia'), 'Tu firma es demasiado larga para enviarla. Pega una versión más simple o usa otro diseño.');
  assert.equal(signatureProblem({ customHtml: '' }, 'propia'), 'Pega tu firma o sube su archivo.');
  assert.equal(signatureProblem({ customHtml: '<p>Ana</p>' }, 'propia'), null);
});

test('the .htm file Outlook writes is read in its own code page', () => {
  const latin = Uint8Array.from([...'<html><head><meta http-equiv=Content-Type content="text/html; charset=windows-1252"></head><body><p>Gerente de Operaci'].map(c => c.charCodeAt(0)).concat([0xf3, 0x6e]).concat([...'</p></body></html>'].map(c => c.charCodeAt(0))));
  assert.match(decodeSignatureFile(latin.buffer), /Gerente de Operación/);
  const utf8 = new TextEncoder().encode('<p>Gerente de Operación</p>');
  assert.match(decodeSignatureFile(utf8.buffer as ArrayBuffer), /Gerente de Operación/);
  const undeclared = Uint8Array.from([0x3c, 0x70, 0x3e, 0x4f, 0x70, 0x65, 0x72, 0x61, 0x63, 0x69, 0xf3, 0x6e]);
  assert.match(decodeSignatureFile(undeclared.buffer), /Operación/, 'not UTF-8 and nothing said: the Windows code page');
  const { html } = importSignatureHtml(decodeSignatureFile(latin.buffer), view());
  assert.equal(html, '<p>Gerente de Operación</p>');
});
