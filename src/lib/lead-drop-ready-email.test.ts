import assert from 'node:assert/strict';
import test from 'node:test';

import type { DropItem } from './lead-drops';
import { dropCallsEmail, dropReadyEmail } from './lead-drop-ready-email';

const LINK = 'https://app.test/contactos/TOKEN';
const NOW = new Date('2026-11-16T14:00:00Z');
const item = (leadId: string, name: string, extra: Partial<DropItem> = {}): DropItem => ({ leadId, name, title: 'Gerente HSE', company: 'Minera <Andina>', domain: null, industry: 'Minería', size: null, city: null,
  hasEmail: true, hasPhone: false, why: 'Calza.', research: [], provider: 'apollo', savedLeadId: `e-${leadId}`,
  draft: { subject: 'Brigadas en {{empresa}}', body: 'Hola {{nombre}},\n\n¿Cómo cubren los turnos de noche?\n\nSaludos' },
  followUps: [{ day: 3, subject: 'Re: brigadas', body: 'Hola {{nombre}}, ¿lo vemos?' }, { day: 7, subject: 'Cierro', body: 'Te dejo tranquilo.' }], ...extra });
const script = { points: ['Turnos de noche: quién responde ante una emergencia.', 'Ampliación 2027: más gente en faena.'], opening: 'Hola Pedro, te llamo por las brigadas de la ampliación.',
  questions: ['¿Cómo cubren hoy la noche?', '¿Quién decide el proveedor?'], objections: [{ objection: 'Ya tenemos proveedor', answer: 'Perfecto, ¿cubre también la ampliación?' }],
  voicemail: 'Hola Pedro, soy Ana de Brigadas. Te escribo un correo.', whatsapp: 'Hola Pedro, soy Ana. ¿Te puedo llamar mañana?' };

test('«Listos»: each contact with its address, how its first email starts and the days of its follow-ups; approving is a button on the page', () => {
  const pedro = item('6accdbfcd5f5d80001cf6901', 'Pedro Araya');
  const luisa = item('6accdbfcd5f5d80001cf6902', 'Luisa Soto', { company: 'Puerto Sur' });
  const missed = item('6accdbfcd5f5d80001cf6903', 'Raúl P.', { savedLeadId: null, company: 'Agro Norte' });
  const email = dropReadyEmail([{ item: pedro, email: 'pedro@mineraandina.cl' }, { item: luisa, email: 'luisa@puertosur.cl' }],
    { link: LINK, appUrl: 'https://app.test/', name: 'Ana María Rojas', mailbox: 'Outlook', total: 3, missed: [missed], phones: true, now: NOW })!;
  assert.equal(email.count, 2);
  assert.match(email.text, /^Hola, Ana\. Encontramos el correo de 2 de tus 3 contactos\.\nLa campaña de cada uno está lista: léela y apruébala\. Sale desde tu Outlook y se detiene si responde\./);
  assert.match(email.text, /Sus teléfonos llegan en unos minutos, en esta misma conversación, con el guion de cada llamada\./);
  assert.match(email.text, /No encontramos un correo para Raúl P\. de Agro Norte\./);
  // The first email as its reader gets it: the variables filled, its paragraphs kept.
  assert.match(email.text, /Pedro Araya, Gerente HSE · Minera <Andina>\nCorreo: pedro@mineraandina\.cl\n— Primer correo · sale al aprobar —\nAsunto: Brigadas en Minera <Andina>\n\nHola Pedro,\n\n¿Cómo cubren los turnos de noche\?\n\nSaludos\n\n2 seguimientos si no responde: /);
  assert.match(email.text, /Revisar y aprobar: https:\/\/app\.test\/contactos\/TOKEN\?c=6accdbfcd5f5d80001cf6901/);
  // What came from outside is escaped; the address is a link; nothing is approved by a link.
  assert.match(email.html, /Minera &lt;Andina&gt;/);
  assert.doesNotMatch(email.html, /Minera <Andina>/);
  assert.match(email.html, /<a href="mailto:luisa@puertosur\.cl"/);
  assert.doesNotMatch(email.html, /aprobar=|approve/);
  // One main button, to all of them; each card's own is outlined. Their colour is the cell's attribute too (emailButton).
  assert.equal((email.html.match(/<td bgcolor="#2563eb"/g) || []).length, 1);
  assert.match(email.html, /<td bgcolor="#2563eb"[^>]*><a href="https:\/\/app\.test\/contactos\/TOKEN"[^>]*>Revisar y aprobar las 2 campañas<\/a>/);
  assert.equal((email.html.match(/<td bgcolor="#ffffff"[^>]*><a href="https:\/\/app\.test\/contactos\/TOKEN\?c=[0-9a-f]{24}"[^>]*>Leer completo y aprobar<\/a>/g) || []).length, 2);
  // Several contacts: each card is its person, its address and how its first email starts, in one paragraph; the whole email is
  // in the text version and on its page (16 Nov 2026: six emails in full were a wall of text).
  assert.deepEqual([...email.html.matchAll(/line-height:40px;text-align:center">([^<]+)<\/td>/g)].map(match => match[1]), ['PA', 'LS']);
  assert.match(email.html, />Primer correo · sale al aprobar<\/p><p[^>]*>Brigadas en Minera &lt;Andina&gt;<\/p><p[^>]*>Hola Pedro, ¿Cómo cubren los turnos de noche\? Saludos<\/p><\/td><\/tr><\/table>/);
  assert.match(email.html, /^<div style="display:none;[^"]*">La campaña de cada uno está lista/, 'the inbox shows what to do next');
  assert.match(email.html, />ANTON\.IA<\/td><td align="right"[^>]*>Listos para aprobar<\/td>/);
  assert.match(email.html, />Correo encontrado<\/span> &nbsp;<a href="mailto:luisa@puertosur\.cl"/);
  assert.match(email.html, />Hola, Ana<\/p><p[^>]*>Encontramos el correo de 2 de tus 3 contactos\.<\/p>/);
  assert.match(email.html, /href="https:\/\/app\.test\/dashboard\?vista=semana"/);
});

test('«Listos» for one contact, without a mailbox: it says where to connect it; nothing to say without an email written', () => {
  const pedro = item('6accdbfcd5f5d80001cf6901', 'Pedro Araya', { followUps: [] });
  const email = dropReadyEmail([{ item: pedro, email: 'pedro@mineraandina.cl' }], { link: LINK, appUrl: 'https://app.test', mailbox: null, total: 6, now: NOW })!;
  assert.match(email.text, /^Hola\. Encontramos el correo de Pedro Araya de Minera <Andina>\.\nSu campaña está lista\. Para aprobarla, conecta tu Gmail u Outlook ahí mismo: es una sola vez\./);
  assert.doesNotMatch(email.text, /seguimiento|teléfono/i);
  assert.equal((email.html.match(/<td bgcolor="#2563eb"/g) || []).length, 1, 'its own button is the main one');
  assert.match(email.html, /<p[^>]*>Hola Pedro,<\/p><p[^>]*>¿Cómo cubren los turnos de noche\?<\/p><p[^>]*>Saludos<\/p>[\s\S]*>Revisar y aprobar<\/a>/, 'one contact: its first email in full, paragraph by paragraph');
  assert.equal(dropReadyEmail([{ item: item('6accdbfcd5f5d80001cf6901', 'Pedro Araya', { draft: null, followUps: [] }), email: 'pedro@mineraandina.cl' }], { link: LINK, appUrl: 'https://app.test', mailbox: null, total: 1 }), null);
  assert.equal(dropReadyEmail([], { link: LINK, appUrl: 'https://app.test', mailbox: 'Gmail', total: 2 }), null);
});

test('«Para llamar»: the number to tap, WhatsApp with its first line written, and the script of the call; those without a mobile are named', () => {
  const pedro = item('6accdbfcd5f5d80001cf6901', 'Pedro Araya');
  const luisa = item('6accdbfcd5f5d80001cf6902', 'Luisa Soto', { company: 'Puerto Sur' });
  const none = item('6accdbfcd5f5d80001cf6903', 'Raúl P.', { company: 'Agro Norte' });
  const email = dropCallsEmail([{ item: pedro, number: '+56 9 8765 4321', script }, { item: luisa, number: '+56 2 2345 6789', script: null }],
    { link: LINK, appUrl: 'https://app.test', name: 'Ana', missed: [none] })!;
  assert.equal(email.count, 2);
  assert.match(email.text, /^Hola, Ana\. Ya tienes el teléfono de 2 de tus contactos, con el guion de cada llamada\.\nNo encontramos un teléfono para Raúl P\. de Agro Norte\./);
  assert.match(email.text, /Teléfono: \+56 9 8765 4321\nWhatsApp: https:\/\/wa\.me\/56987654321\?text=Hola%20Pedro/);
  assert.match(email.text, /Puntos de interés\n- Turnos de noche: quién responde ante una emergencia\.\n- Ampliación 2027: más gente en faena\.\nAl contestar\nHola Pedro, te llamo por las brigadas de la ampliación\.\nPreguntas\n- ¿Cómo cubren hoy la noche\?/);
  assert.match(email.text, /Si te dice…\n- «Ya tenemos proveedor»: Perfecto, ¿cubre también la ampliación\?\nSi no contesta\nHola Pedro, soy Ana de Brigadas\./);
  // Mail clients drop `tel:` links: the number is plain text, and «Llamar» opens its card, which dials.
  assert.doesNotMatch(email.html, /href="tel:/);
  assert.match(email.html, />\+56 9 8765 4321<\/p>/);
  assert.match(email.html, /<td bgcolor="#2563eb"[^>]*><a href="https:\/\/app\.test\/contactos\/TOKEN\?c=6accdbfcd5f5d80001cf6901&amp;llamar=1"[^>]*>Llamar<\/a>/);
  assert.match(email.html, /<a href="https:\/\/wa\.me\/56987654321\?text=Hola%20Pedro[^"]*"[^>]*>WhatsApp<\/a>/);
  assert.match(email.text, /Llamar y anotar cómo te fue: https:\/\/app\.test\/contactos\/TOKEN\?c=6accdbfcd5f5d80001cf6901&llamar=1/);
  // The script as it is read with the phone in the hand: what to say first apart, the points by theme and the questions numbered.
  // What to answer to an objection and the voicemail are on the card «Llamar» opens (and in the text version above).
  assert.match(email.html, />Al contestar<\/p><p[^>]*>Hola Pedro, te llamo por las brigadas de la ampliación\.<\/p>/);
  assert.match(email.html, /<strong[^>]*>Turnos de noche:<\/strong> quién responde ante una emergencia\.<\/p>/);
  assert.match(email.html, />1<\/td><td[^>]*>¿Cómo cubren hoy la noche\?<\/td>/);
  assert.doesNotMatch(email.html, /Ya tenemos proveedor|soy Ana de Brigadas/);
  assert.match(email.html, /En su ficha: cómo responder si objeta y qué dejar en el buzón\. <a href="https:\/\/app\.test\/contactos\/TOKEN\?c=6accdbfcd5f5d80001cf6901&amp;llamar=1"[^>]*>Abrir el guion completo &rsaquo;<\/a>/);
  assert.match(email.html, />ANTON\.IA<\/td><td align="right"[^>]*>Para llamar<\/td>/);
  // The one without a script still has its number and its buttons.
  assert.match(email.html, /<a href="https:\/\/app\.test\/contactos\/TOKEN\?c=6accdbfcd5f5d80001cf6902&amp;llamar=1"[^>]*>Llamar<\/a>/);
});

test('«Para llamar» for one contact, for none found, and with nothing to say', () => {
  const pedro = item('6accdbfcd5f5d80001cf6901', 'Pedro Araya');
  const one = dropCallsEmail([{ item: pedro, number: '+56987654321', script }], { link: LINK, appUrl: 'https://app.test' })!;
  assert.match(one.text, /^Hola\. Ya tienes el teléfono de Pedro Araya de Minera <Andina>, con el guion de su llamada\./);
  assert.equal((one.html.match(/<td bgcolor="#2563eb"/g) || []).length, 1, '«Llamar» is the main button of its card');
  const missed = dropCallsEmail([], { link: LINK, appUrl: 'https://app.test', missed: [pedro] })!;
  assert.match(missed.text, /^Hola\. No encontramos un teléfono para Pedro Araya de Minera <Andina>\.\nSus campañas de correo siguen listas en la página\./);
  assert.equal(missed.count, 0);
  // A number nobody could dial is not offered as one.
  assert.equal(dropCallsEmail([{ item: pedro, number: 'n/a', script }], { link: LINK, appUrl: 'https://app.test' }), null);
  assert.equal(dropCallsEmail([], { link: LINK, appUrl: 'https://app.test' }), null);
});
