import assert from 'node:assert/strict';
import test from 'node:test';
import { blindAnswer, blindEmails } from './cowork-blind-read';

test('the reader sees the request, the reply, what it can tap and every email, without knowing who wrote it', () => {
  const result = {
    reply: 'Te dejo la secuencia.', question: '¿La uso en una campaña pausada?', suggestions: [{ label: 'Sí, úsala' }],
    blocks: [{ type: 'sequence', title: 'AXIS', steps: [{ day: 1, subject: 'Antecedentes', body: 'Hola {{nombre}},\n¿Cuánto les toma hoy?' }] },
      { type: 'table', title: 'x', columns: [], rows: [] }],
    proposal: { kind: 'campaign_create', campaign: { emails: ['fmunoz@securitas.cl'], messages: [{ subject: 'Hola', body: 'Hola Felipe,' }] } },
  };
  assert.deepEqual(blindEmails(result).map(group => `${group.kind}: ${group.steps.length}`), ['Secuencia: 1', 'Campaña propuesta: 1']);
  const shown = blindAnswer('R07', 'mkt-secuencia', result);
  assert.match(shown, /^## R07\n\*\*Pedido:\*\* armame una secuencia de 3 correos/);
  assert.match(shown, /\*\*Pregunta final:\*\* ¿La uso en una campaña pausada\?/);
  assert.match(shown, /\*\*Sugerencias para tocar:\*\* Sí, úsala/);
  assert.match(shown, /> \[1 · día 1\] Asunto: Antecedentes\n>\n> Hola \{\{nombre\}\},\n> ¿Cuánto les toma hoy\?/);
  assert.match(shown, /_Destinatarios: fmunoz@securitas\.cl_/);
  // An unknown case shows its id as the request.
  assert.match(blindAnswer('R01', 'caso-nuevo', { reply: '' }), /\*\*Pedido:\*\* caso-nuevo\n\n\*\*Respuesta:\*\*\n\(sin respuesta\)/);
});
