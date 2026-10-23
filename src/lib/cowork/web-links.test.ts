import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkLinkHost, coworkUnseenLinks } from './web-links';

const seen = [
  { action: 'web.search', input: 'sodexo chile', result: { ok: true, sources: [{ title: 'Sodexo', url: 'https://www.sodexo.cl/quienes-somos' }, { title: 'Nota', url: 'https://www.encancha.cl/enlahora/servicios/2025/5/5/sueldos.html' }] } },
  { action: 'site.read', input: 'https://miempresa.cl', result: { text: 'Escríbenos en https://miempresa.cl/contacto' } },
];

test('the site of a link is read without www and without the punctuation that closes the sentence', () => {
  assert.equal(coworkLinkHost('https://www.Sodexo.cl/a?b=1.'), 'sodexo.cl');
  assert.equal(coworkLinkHost('http://sodexo.cl)'), 'sodexo.cl');
  assert.equal(coworkLinkHost('ftp://sodexo.cl'), null);
  assert.equal(coworkLinkHost('no es un enlace'), null);
});

test('a link to a site the turn looked at passes, even to another page of it; one made up out of nothing does not', () => {
  const answer = {
    reply: 'Según [Sodexo](https://www.sodexo.cl/trabaja-con-nosotros) y la [nota](https://www.encancha.cl/enlahora/servicios/2025/5/5/sueldos.html), contratan. También https://inventada.cl/informe-2026.',
    document: { title: 'Ficha', content: 'Más en https://miempresa.cl/contacto y en https://otra-inventada.com/x.' }, question: null,
  };
  assert.deepEqual(coworkUnseenLinks(answer, seen), ['https://inventada.cl/informe-2026', 'https://otra-inventada.com/x']);
  assert.deepEqual(coworkUnseenLinks({ reply: 'Sin enlaces.', document: null }, seen), []);
  assert.deepEqual(coworkUnseenLinks({ reply: 'Mira https://www.sodexo.cl.', document: null }, seen), []);
});

test('what the person wrote and the conversation count as seen, and a repeated link is listed once', () => {
  const answer = { reply: 'Veo https://cliente.cl y https://cliente.cl/ y https://nueva.cl/a', document: null };
  assert.deepEqual(coworkUnseenLinks(answer, [...seen, 'Mi sitio es https://www.cliente.cl']), ['https://nueva.cl/a']);
  assert.equal(coworkUnseenLinks({ reply: Array.from({ length: 9 }, (_, index) => `https://x${index}.cl`).join(' '), document: null }, []).length, 5, 'a long list is cut');
});
