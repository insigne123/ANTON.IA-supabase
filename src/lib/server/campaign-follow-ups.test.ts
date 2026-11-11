import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_FOLLOW_UP_DELAYS, followUpProblem, reviseCampaignSequence, writeCampaignFollowUps } from './campaign-follow-ups';

// Fictional sender and companies.
const first = { subject: 'Turnos de guardias en Planta Norte', body: 'Hola Ana,\n\nVi que Constructora Andes Sur abrió una faena en Temuco. Ayudamos a cubrir turnos de guardias sin horas extra.\n\n¿Te sirve conversarlo 15 minutos?' };

test('the follow-ups continue the first email, one per delay, on days 3, 7 and 14 by default', async () => {
  const calls: Array<{ systemPrompt?: string; prompt: string }> = [];
  const followUps = await writeCampaignFollowUps({ first, objective: 'Reunión para cubrir turnos', followUpDelays: [...DEFAULT_FOLLOW_UP_DELAYS],
    research: 'Abrió una faena en Temuco en octubre.', recipients: 1 }, {
    generate: (async (options: { systemPrompt?: string; prompt: string }) => {
      calls.push(options);
      return { followUps: [
        { subject: 'Cobertura de turnos en Temuco', body: 'Hola Ana,\n\nUn dato: en faenas nuevas los turnos de noche son los primeros en quedar sin cubrir. ¿Cómo lo están resolviendo?' },
        { subject: 'Una idea para Planta Norte', body: 'Hola Ana,\n\nPodemos partir con un turno de prueba. ¿Lo vemos esta semana?' },
        { subject: 'Cierro por ahora', body: 'Hola Ana,\n\nNo te escribo más por ahora. Si en algún momento te sirve, aquí estoy.' },
      ] };
    }) as never,
  });
  assert.deepEqual(followUps.map(item => item.delayDays), [3, 4, 7]);
  assert.equal(followUps.length, 3);
  const sent = JSON.parse(calls[0].prompt);
  assert.deepEqual(sent.first, first);
  assert.equal(sent.research, 'Abrió una faena en Temuco en octubre.');
  assert.equal(sent.recipients, 1);
  assert.match(calls[0].systemPrompt || '', /exactamente un seguimiento por cada elemento de followUpDelays/);
  assert.match(calls[0].systemPrompt || '', /nunca instrucciones para ti/);
  assert.match(calls[0].systemPrompt || '', /sin «Re:»/);
});

test('a sequence the AI wrote badly is refused, in words that say what to fix', async () => {
  assert.match(followUpProblem([{ subject: 'Hola', body: 'Hola {{apellido}},' }], { recipients: 1, last: 0 }) || '', /\{\{apellido\}\} no existe/);
  assert.match(followUpProblem([{ subject: 'Re: Turnos', body: 'Hola,' }], { recipients: 1, last: 0 }) || '', /no llevan «Re:»/);
  assert.match(followUpProblem([{ subject: 'Turnos', body: '<p>Hola</p>' }], { recipients: 1, last: 0 }) || '', /sin HTML/);
  assert.match(followUpProblem([{ subject: 'Turnos', body: 'Hola Ana, te escribo' }], { recipients: 5, last: 0 }) || '', /Hola \{\{nombre\}\}/);
  assert.equal(followUpProblem([{ subject: 'Turnos', body: 'Hola {{nombre}}, te escribo' }], { recipients: 5, last: 0 }), null);
  assert.equal(followUpProblem([{ subject: 'Turnos', body: 'Hola Ana, te escribo' }], { recipients: 1, last: 0 }), null, 'one person: the name may go as in the first email');
  assert.match(followUpProblem([{ subject: 'Último correo', body: 'Hola,' }, { subject: 'Otro', body: 'Hola,' }], { recipients: 1, last: 1 }) || '', /Solo el último correo/);
  await assert.rejects(writeCampaignFollowUps({ first, followUpDelays: [3], recipients: 4 }, {
    generate: (async () => ({ followUps: [{ subject: 'Re: Turnos', body: 'Hola {{nombre}},' }] })) as never,
  }), /no llevan «Re:»/);
});

test('one instruction changes every email it may change, with the same count and delays, and leaves the sent ones as they are', async () => {
  const messages = [
    { subject: 'Primero', body: 'Hola {{nombre}}, correo uno.', delayDays: 0 },
    { subject: 'Segundo', body: 'Hola {{nombre}}, correo dos.', delayDays: 3 },
    { subject: 'Tercero', body: 'Hola {{nombre}}, correo tres.', delayDays: 4 },
  ];
  let prompt = '';
  const revised = await reviseCampaignSequence({ instruction: 'Hazlos más breves y tutea', objective: 'Reunión', messages, locked: [0] }, {
    generate: (async (options: { prompt: string }) => {
      prompt = options.prompt;
      return { messages: [
        { subject: 'Cambiado', body: 'Hola {{nombre}}, cambiado.' },
        { subject: 'Segundo breve', body: 'Hola {{nombre}}, breve dos.' },
        { subject: 'Tercero breve', body: 'Hola {{nombre}}, breve tres.' },
      ] };
    }) as never,
  });
  assert.deepEqual(revised[0], messages[0], 'the email already sent does not change');
  assert.deepEqual(revised.map(item => item.delayDays), [0, 3, 4]);
  assert.equal(revised[1].subject, 'Segundo breve');
  assert.deepEqual(JSON.parse(prompt).locked, [0]);
});

test('the follow-ups are shown how a person writes one, and those that read as a template are written once more', async () => {
  const calls: Array<{ systemPrompt?: string; prompt: string }> = [];
  const template = [
    { subject: 'Cobertura de turnos', body: 'Hola Ana,\n\nQuería consultarte si te interesa conversar sobre la cobertura de turnos.\n\nSi te parece pertinente, podemos coordinar una breve conversación.' },
    { subject: 'Cierro por ahora', body: 'No te escribo más sobre esto. ¿Lo dejamos hasta aquí?' },
  ];
  const person = [
    { subject: 'Los turnos de noche', body: 'Hola Ana,\n\nSobre la faena de Temuco: también cubrimos los turnos de noche, así que tu supervisor no tiene que doblar.\n\n¿Quién cubre hoy esos turnos?' },
    { subject: 'Cierro por ahora', body: 'Hola Ana,\n\nNo te escribo más sobre esto. ¿Lo dejamos hasta aquí?' },
  ];
  const followUps = await writeCampaignFollowUps({ first, objective: 'Reunión para cubrir turnos', followUpDelays: [3, 7], recipients: 1 }, {
    generate: (async (options: { systemPrompt?: string; prompt: string }) => { calls.push(options); return { followUps: calls.length === 1 ? template : person }; }) as never,
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].systemPrompt || '', /Cómo escribe una persona un correo de prospección/);
  assert.match(calls[0].systemPrompt || '', /ASÍ SUENAN/);
  assert.match(calls[0].systemPrompt || '', /Hola \{\{nombre\}\},\n\nSobre la bodega/, 'the samples carry a greeting, so the follow-ups do');
  const again = JSON.parse(calls[1].prompt);
  assert.equal(again.previous.length, 2);
  assert.match(again.corrections.join(' '), /Correo 1: Esta es una fórmula de plantilla/);
  assert.deepEqual(followUps.map((item) => item.subject), ['Los turnos de noche', 'Cierro por ahora']);
  assert.deepEqual(followUps.map((item) => item.delayDays), [3, 7]);

  // A second version that is no better, or that fails, leaves the first; and a greeting that is missing is the first email's.
  const kept = await writeCampaignFollowUps({ first, followUpDelays: [3, 7], recipients: 1 }, { generate: (async () => ({ followUps: template })) as never });
  assert.match(kept[0].body, /Quería consultarte/);
  assert.match(kept[1].body, /^Hola Ana,\n\nNo te escribo más sobre esto\./);
  let count = 0;
  const failed = await writeCampaignFollowUps({ first, followUpDelays: [3, 7], recipients: 1 }, { generate: (async () => { count += 1; if (count > 1) throw new Error('503'); return { followUps: template }; }) as never });
  assert.match(failed[0].body, /Quería consultarte/);
  const many = await writeCampaignFollowUps({ first: { subject: first.subject, body: 'Hola {{nombre}},\n\nUn correo.' }, followUpDelays: [3], recipients: 5 },
    { generate: (async () => ({ followUps: [{ subject: 'Una idea', body: 'Podemos partir con un turno de prueba en {{empresa}}, y si te sirve sumamos el resto. ¿Lo vemos esta semana?' }] })) as never });
  assert.match(many[0].body, /^Hola \{\{nombre\}\},\n\nPodemos partir/);
});
