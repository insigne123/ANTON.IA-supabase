import assert from 'node:assert/strict';
import test from 'node:test';

import { dropCampaignEmail } from './lead-drop-campaign-email';
import type { DropItem } from './lead-drops';

const DROP = '11111111-1111-4111-8111-111111111111';
const contact = (extra: Partial<DropItem> = {}) => ({
  leadId: '6accdbfcd5f5d80001cf6901', name: 'Pedro Araya', title: 'Gerente HSE', company: 'Minera Andina', provider: 'apollo', savedLeadId: 'e-1',
  draft: { subject: 'Brigadas en {{empresa}}', body: 'Hola {{nombre}},\n\n¿Cómo cubren los turnos de noche en {{empresa}}?\nLo pregunto por <algo> & más.   \n\n\n\nSaludos,\nAna' },
  followUps: [{ day: 3, subject: 'Re: brigadas', body: 'Hola {{nombre}}, ¿lo vemos?' }, { day: 7, subject: 'Planes', body: 'Otra idea.' }, { day: 11, subject: 'Cierro', body: 'Último correo.' }],
  ...extra,
}) as DropItem;
// A Friday in Chile.
const input = { dropId: DROP, appUrl: 'https://app.ejemplo.cl/', contactEmail: 'pedro@minera.example', mailbox: 'Outlook', name: 'Ana Rojas', now: new Date('2026-11-13T12:00:00.000Z') };

test('the campaign as it would go: every email in full with the contact\'s name and company in place, and the day each would leave', () => {
  const email = dropCampaignEmail(contact(), input)!;
  assert.equal(email.subject, 'Campaña lista para aprobar: Pedro Araya · Minera Andina');
  assert.equal(email.link, `https://app.ejemplo.cl/search/contactos/${DROP}?c=6accdbfcd5f5d80001cf6901`);
  const lines = email.text.split('\n');
  assert.equal(lines[0], 'Hola, Ana. Encontramos el correo de Pedro Araya: pedro@minera.example.');
  assert.match(lines[1], /sale desde tu Outlook y se detiene si responde\.$/);
  // Each follow-up so many days after the one before, counted from today, and never on a weekend: Sunday's waits for Monday.
  assert.deepEqual(lines.filter(line => line.startsWith('— ')), [
    '— Primer correo · sale al aprobar —', '— Seguimiento 1 · lun 16 nov, si no responde —',
    '— Seguimiento 2 · vie 20 nov, si no responde —', '— Seguimiento 3 · mar 24 nov, si no responde —']);
  assert.ok(email.text.includes('Asunto: Brigadas en Minera Andina\n\nHola Pedro,\n\n¿Cómo cubren los turnos de noche en Minera Andina?\nLo pregunto por <algo> & más.\n\nSaludos,\nAna\n'),
    'the body keeps its paragraphs, without the empty lines and the trailing spaces a model leaves');
  assert.ok(!/\{\{/.test(email.text) && !/\{\{/.test(email.html), 'no variable is left to fill');
  assert.ok(email.text.includes('Asunto: Re: brigadas\n\nHola Pedro, ¿lo vemos?'));
  assert.match(email.text, /Los seguimientos salen solo si no hay respuesta\./);
});

test('the HTML says the same, escapes what the email brings and leads to the card: nothing is sent by opening a link', () => {
  const email = dropCampaignEmail(contact(), input)!;
  assert.ok(email.html.includes('Lo pregunto por &lt;algo&gt; &amp; más.'), 'text of the email is never markup');
  assert.ok(email.html.includes('¿Cómo cubren los turnos de noche en Minera Andina?<br>Lo pregunto'), 'a line break inside a paragraph stays');
  assert.equal((email.html.match(/text-transform:uppercase/g) || []).length, 4, 'one block per email');
  const links = [...email.html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(links, [email.link, 'https://app.ejemplo.cl/dashboard?vista=semana']);
  assert.ok(!links.some(link => /aprobar|approve/.test(link)), 'approving is done on the page');
  assert.match(email.html, />Revisar y aprobar<\/a>/);
});

test('without a mailbox it says what is missing; a contact with one email has no follow-ups to explain; one without emails gets none', () => {
  const none = dropCampaignEmail(contact(), { ...input, mailbox: null, name: '' })!;
  assert.match(none.text, /^Hola\. Encontramos/);
  assert.match(none.text, /Para aprobarla, conecta Gmail u Outlook en «Conexiones»\./);
  const single = dropCampaignEmail(contact({ followUps: undefined, company: null }), input)!;
  assert.equal(single.subject, 'Campaña lista para aprobar: Pedro Araya');
  assert.ok(!/seguimientos/i.test(single.text));
  assert.equal(dropCampaignEmail(contact({ draft: undefined }), input), null);
});

test('from a drop used from the inbox, the button opens its page without signing in, and the mailbox is connected there', () => {
  const open = 'https://app.ejemplo.cl/contactos/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const email = dropCampaignEmail(contact(), { ...input, link: open })!;
  assert.equal(email.link, `${open}?c=6accdbfcd5f5d80001cf6901`);
  assert.ok(email.html.includes(`href="${open}?c=6accdbfcd5f5d80001cf6901"`));
  assert.ok(email.text.includes(`Revisar y aprobar: ${open}?c=6accdbfcd5f5d80001cf6901`));
  assert.ok(!email.text.includes('/search/contactos/'), 'no way into the app is needed to approve');
  const unconnected = dropCampaignEmail(contact(), { ...input, link: open, mailbox: null })!;
  assert.match(unconnected.text.split('\n')[1], /conecta tu Gmail u Outlook ahí mismo: es una sola vez\.$/);
  assert.doesNotMatch(unconnected.text, /«Conexiones»/);
});
