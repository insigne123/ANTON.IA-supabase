import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeSendSignature } from '@/lib/server/email-signature';
import { buildSignatureHtml, buildSignatureText, safeHttpsUrl, signatureProblem } from './signature-builder';
import { templateVariables, toCanonicalTemplate, toFriendlyTemplate } from './variables';

const ANA = {
  name: 'Ana Pérez', title: 'Gerenta Comercial', company: 'Empresa Demo SpA', phone: '+56 9 1234 5678',
  website: 'empresa-demo.cl', linkedin: 'https://www.linkedin.com/in/ana-perez-demo', imageUrl: 'https://cdn.empresa-demo.cl/logo.png', imageWidth: 320,
};

test('each design signs with the same data, as links that work and survive the send-time cleaning', () => {
  for (const design of ['clasica', 'con-logo', 'compacta'] as const) {
    const html = buildSignatureHtml(ANA, design);
    assert.match(html, /Ana Pérez/);
    assert.match(html, /Gerenta Comercial · Empresa Demo SpA/);
    assert.match(html, /href="tel:\+56912345678"/);
    assert.match(html, /href="https:\/\/empresa-demo\.cl\/"/);
    assert.match(html, />empresa-demo\.cl</, 'the address reads without https://');
    assert.match(html, /href="https:\/\/www\.linkedin\.com\/in\/ana-perez-demo"/);
    // What the server sends is what the person sees here: nothing of it is dropped by the cleaning of PR 3a.
    const sent = sanitizeSendSignature(html);
    assert.ok(sent);
    for (const part of ['Ana Pérez', 'tel:+56912345678', 'https://empresa-demo.cl/', 'linkedin.com/in/ana-perez-demo']) {
      assert.ok(sent.html.includes(part), `${design}: «${part}» survives`);
    }
  }
  assert.match(buildSignatureHtml(ANA, 'con-logo'), /<img src="https:\/\/cdn\.empresa-demo\.cl\/logo\.png" alt="Empresa Demo SpA" width="96"/);
  assert.doesNotMatch(buildSignatureHtml(ANA, 'clasica'), /<img/, 'the classic design has no image');
  assert.match(buildSignatureHtml(ANA, 'imagen'), /<img src="https:\/\/cdn\.empresa-demo\.cl\/logo\.png" alt="Ana Pérez" width="320"/);
  assert.equal(buildSignatureText(ANA, 'clasica'), 'Ana Pérez\nGerenta Comercial · Empresa Demo SpA\n+56 9 1234 5678\nempresa-demo.cl\nhttps://www.linkedin.com/in/ana-perez-demo');
  assert.equal(buildSignatureText(ANA, 'compacta'), 'Ana Pérez · Gerenta Comercial · Empresa Demo SpA\n+56 9 1234 5678 · empresa-demo.cl · https://www.linkedin.com/in/ana-perez-demo');
});

test('what a person types cannot break the email or load something unsafe', () => {
  const html = buildSignatureHtml({ ...ANA, name: '<script>alert(1)</script> Ana', website: 'javascript:alert(1)', imageUrl: 'http://inseguro.cl/x.png', linkedin: 'https://evil.cl/in/x' }, 'con-logo');
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /https:\/\/inseguro\.cl\/x\.png/, 'http becomes https');
  assert.doesNotMatch(html, /evil\.cl/, 'a LinkedIn field that is not LinkedIn is left out');
  assert.equal(safeHttpsUrl('nada'), '', 'not an address');
  assert.equal(safeHttpsUrl('data:image/png;base64,AAA'), '');
  assert.equal(buildSignatureHtml({ name: '', title: '' }, 'clasica'), '', 'nothing to sign with');
  assert.equal(signatureProblem({ name: '' }, 'clasica'), 'Escribe tu nombre.');
  assert.equal(signatureProblem({ name: 'Ana' }, 'con-logo'), 'Sube tu logo o foto, o elige otro diseño.');
  assert.equal(signatureProblem({}, 'imagen'), 'Sube la imagen de tu firma.');
  assert.equal(signatureProblem({ name: 'Ana', linkedin: 'mi perfil' }, 'clasica'), 'Revisa tu LinkedIn: pega la dirección de tu perfil.');
  assert.equal(signatureProblem(ANA, 'clasica'), null);
});

test('templates read «{Nombre}» and «{Empresa}» and keep sending {{…}}, old [[…]] included', () => {
  const stored = 'Hola {{lead.firstName}}, vi que en {{ company.name }} … [[lead.firstName]] {{report.overview}}\n{{sender.name}}';
  const friendly = toFriendlyTemplate(stored);
  assert.equal(friendly, 'Hola {Nombre}, vi que en {Empresa} … {Nombre} {{report.overview}}\n{Tu nombre}');
  assert.equal(toCanonicalTemplate(friendly), 'Hola {{lead.firstName}}, vi que en {{company.name}} … {{lead.firstName}} {{report.overview}}\n{{sender.name}}');
  assert.equal(toCanonicalTemplate('{nombre} y {Tu Empresa}'), '{{lead.firstName}} y {{sender.company}}', 'labels match without case');
  assert.equal(toCanonicalTemplate('{algo} {{x}}'), '{algo} {{x}}', 'unknown words in braces stay');
  assert.deepEqual(templateVariables('Hola {Nombre}, {{company.name}} y [[sender.name]]'), ['Nombre', 'Empresa', 'Tu nombre']);
});
