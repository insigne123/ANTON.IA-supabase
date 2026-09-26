import assert from 'node:assert/strict';
import test from 'node:test';
import { CoworkCampaignEditRefused, coworkCampaignEditSchema, coworkEditedCampaignDefinition } from './campaign-edit';

const staged = {
  name: 'AXIS · RR. HH.', description: 'Primera conversación', objective: 'Primera conversación',
  criteria: { relationship: 'never_contacted', titles: [], industries: [], countries: [], sizes: [], seniorities: [], minimumDaysSinceSent: 0, excludeReplied: true, enrichedOnly: false },
  emails: ['fmunoz@securitas.cl', 'cfuentes@adecco.cl'], provider: 'google', overrides: [],
  messages: [
    { subject: 'Antecedentes sin trámites', body: 'Hola,\nTe escribo por AXIS.\nNicolás', delayDays: 0 },
    { subject: '¿Lo vemos?', body: 'Hola,\n¿Te sirve verlo?\nNicolás', delayDays: 3 },
  ],
};

test('an edit changes only subjects and bodies, and says which emails changed', () => {
  const { next, changed } = coworkEditedCampaignDefinition(staged, [
    { subject: 'Antecedentes sin trámites', body: 'Hola,\nTe escribo por AXIS.\nNicolás' },
    { subject: '¿Te lo muestro en 15 minutos?', body: 'Hola,\n¿Te sirve verlo el jueves?\nNicolás' },
  ]);
  assert.deepEqual(changed, [1]);
  assert.deepEqual(next.messages.map(message => [message.subject, message.delayDays]), [['Antecedentes sin trámites', 0], ['¿Te lo muestro en 15 minutos?', 3]]);
  // Recipients and everything else stay as reviewed.
  assert.deepEqual(next.emails, staged.emails);
  assert.equal(next.name, staged.name);
  assert.deepEqual(coworkEditedCampaignDefinition(staged, staged.messages.map(({ subject, body }) => ({ subject, body }))).changed, []);
});

test('an edit cannot add or remove emails, nor leave one empty', () => {
  assert.throws(() => coworkEditedCampaignDefinition(staged, [{ subject: 'Uno', body: 'Hola' }]),
    (error: unknown) => error instanceof CoworkCampaignEditRefused && error.status === 400 && /tiene 2 correos/.test(error.message));
  assert.equal(coworkCampaignEditSchema.safeParse({ messages: [{ subject: ' ', body: 'Hola' }] }).success, false);
  assert.equal(coworkCampaignEditSchema.safeParse({ messages: [{ subject: 'Hola', body: 'x'.repeat(12001) }] }).success, false);
  assert.equal(coworkCampaignEditSchema.safeParse({ messages: [{ subject: 'Hola', body: 'Hola', delayDays: 9 }] }).success, false);
});
