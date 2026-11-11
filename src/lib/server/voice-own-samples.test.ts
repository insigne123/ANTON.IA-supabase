import assert from 'node:assert/strict';
import test from 'node:test';
import { gmailBodyText, htmlAsText, scanSentForVoice } from './voice-own-samples';

// A fictional seller and fictional recipients.
const pitch = (name: string) => `Hola ${name},\n\nTe escribo porque supe que abren dos tiendas en la zona sur antes de diciembre y me imagino que ya están viendo cómo armar los equipos.\n\nNosotros ponemos personal temporal para esas semanas y nos hacemos cargo de los contratos. ¿Te parece si lo vemos 15 minutos el jueves?\n\nSaludos,\nCarla Soto\nServiPro`;
const listed = (over: Record<string, unknown>) => ({ id: 'm1', internetMessageId: '<m1@servipro.example>', subject: 'Equipo para las aperturas', sentAt: '2026-11-03T14:00:00Z',
  recipients: ['rodrigo@tiendasejemplo.example'], from: 'carla@servipro.example', reply: false, ...over });

test('only the emails that can be a sample are opened, and what comes back is what the person typed', async () => {
  const opened: string[] = [];
  const scan = await scanSentForVoice('user-1', {
    mailboxes: ['outlook'],
    skip: new Set(['<app@servipro.example>']),
    listed: async () => [
      listed({ id: 'ok' }),
      listed({ id: 'respuesta', reply: true }),
      listed({ id: 're', subject: 'RE: Equipo para las aperturas' }),
      listed({ id: 'masivo', recipients: ['a@uno.example', 'b@dos.example', 'c@tres.example', 'd@cuatro.example'] }),
      listed({ id: 'de-la-app', internetMessageId: '<app@servipro.example>' }),
      listed({ id: 'interno', recipients: ['pedro@servipro.example'] }),
    ] as never,
    body: async (_provider, id) => { opened.push(id); return pitch(id === 'interno' ? 'Pedro' : 'Rodrigo'); },
  });
  assert.deepEqual(opened.sort(), ['interno', 'ok'], 'answers, forwards, mass mail and what the app sent stay unopened');
  assert.equal(scan.provider, 'outlook');
  assert.deepEqual(scan.candidates.map((candidate) => candidate.id), ['ok'], 'mail inside the company is opened to know it, and not offered');
  assert.ok(scan.candidates[0].body.endsWith('Saludos,'));
});

test('a person without a mailbox is told so, an empty folder too, and a mailbox that fails asks to reconnect', async () => {
  assert.deepEqual(await scanSentForVoice('user-1', { mailboxes: [], listed: async () => [], body: async () => null }), { provider: null, candidates: [], reason: 'not_connected' });
  assert.equal((await scanSentForVoice('user-1', { mailboxes: ['gmail'], listed: async () => [], body: async () => null })).reason, 'nothing_found');
  assert.equal((await scanSentForVoice('user-1', { mailboxes: ['gmail'], listed: async () => { throw new Error('401'); }, body: async () => null })).reason, 'reconnect');
  // The second mailbox is tried when the first has nothing.
  const second = await scanSentForVoice('user-1', { mailboxes: ['outlook', 'gmail'],
    listed: async (provider) => (provider === 'gmail' ? [listed({ id: 'g1' })] : []) as never, body: async () => pitch('Rodrigo') });
  assert.equal(second.provider, 'gmail');
  assert.equal(second.candidates.length, 1);
});

test('a Gmail message gives its plain part, or its HTML as text with the paragraphs apart', () => {
  const encode = (text: string) => Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  assert.equal(gmailBodyText({ mimeType: 'multipart/alternative', parts: [
    { mimeType: 'text/plain', body: { data: encode('Hola Ana,\n\nTe escribo por la apertura.') } },
    { mimeType: 'text/html', body: { data: encode('<p>otro</p>') } }] }), 'Hola Ana,\n\nTe escribo por la apertura.');
  assert.equal(gmailBodyText({ mimeType: 'text/html', body: { data: encode('<div>Hola Ana,</div><div><br></div><div>Te escribo por la apertura &amp; el equipo.</div>') } }),
    'Hola Ana,\n\nTe escribo por la apertura & el equipo.');
  assert.equal(htmlAsText('<style>p{color:red}</style><p>Uno</p><p>Dos</p>'), 'Uno\nDos');
});
