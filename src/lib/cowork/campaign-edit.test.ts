import assert from 'node:assert/strict';
import test from 'node:test';
import { CoworkCampaignEditRefused, coworkCampaignEditSchema, coworkEditedCampaignDefinition, coworkEditedCampaignPerson, coworkPersonalCampaignDefinition } from './campaign-edit';

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

test('the first email of one person is edited for that person only', () => {
  const person = { email: 'cfuentes@adecco.cl', subject: 'Camila, AXIS para Adecco', body: 'Hola Camila,\nvi que Adecco abrió 40 vacantes.\nNicolás' };
  const { next, changed } = coworkEditedCampaignPerson(staged, person);
  assert.deepEqual(changed, [0]);
  assert.deepEqual(next.overrides, [{ email: 'cfuentes@adecco.cl', messageIndex: 0, subject: person.subject, body: person.body }]);
  // The template, the other recipient and the rest stay as reviewed.
  assert.deepEqual(next.messages, staged.messages);
  assert.deepEqual(next.emails, staged.emails);
  // Saving it again changes nothing; a second edit replaces the first instead of adding another.
  assert.deepEqual(coworkEditedCampaignPerson(next, person).changed, []);
  const again = coworkEditedCampaignPerson(next, { ...person, subject: 'Camila, una pregunta' }).next;
  assert.deepEqual(again.overrides.map(item => item.subject), ['Camila, una pregunta']);
  // Saving the template's text for someone who had none changes nothing.
  assert.deepEqual(coworkEditedCampaignPerson(staged, { email: 'fmunoz@securitas.cl', ...staged.messages[0] }).changed, []);
});

test('a person edit is for a recipient, with text, and never mixed with the sequence', () => {
  assert.throws(() => coworkEditedCampaignPerson(staged, { email: 'otra@x.cl', subject: 'Hola', body: 'Hola' }),
    (error: unknown) => error instanceof CoworkCampaignEditRefused && error.status === 400);
  const person = { email: 'CFuentes@Adecco.cl', subject: 'Tema', body: 'Hola Camila' };
  assert.equal(coworkCampaignEditSchema.parse({ person }).person?.email, 'cfuentes@adecco.cl');
  assert.equal(coworkCampaignEditSchema.safeParse({ person: { ...person, body: ' ' } }).success, false);
  assert.equal(coworkCampaignEditSchema.safeParse({ person, messages: [{ subject: 'Uno', body: 'Hola' }] }).success, false);
  assert.equal(coworkCampaignEditSchema.safeParse({}).success, false);
});

// 17 Nov 2026 (docs/campanas-un-correo-por-persona.md): the card writes every email of every person before the approval.
const sequence = (who: string) => [{ subject: `Para ${who}`, body: `Hola ${who},\nescrito para ti.` }, { subject: `Sigo, ${who}`, body: `Hola ${who},\n¿lo vemos?` }];

test('the emails written for each person become their own, every step of them', () => {
  const { next, changed } = coworkPersonalCampaignDefinition(staged, [
    { email: 'fmunoz@securitas.cl', messages: sequence('Felipe') }, { email: 'cfuentes@adecco.cl', messages: sequence('Camila') }]);
  assert.deepEqual(changed, [0, 1]);
  assert.deepEqual(next.overrides.map(item => `${item.email}:${item.messageIndex}:${item.subject}`), [
    'fmunoz@securitas.cl:0:Para Felipe', 'fmunoz@securitas.cl:1:Sigo, Felipe', 'cfuentes@adecco.cl:0:Para Camila', 'cfuentes@adecco.cl:1:Sigo, Camila']);
  // The template, the recipients and the spacing stay as reviewed.
  assert.deepEqual(next.messages, coworkEditedCampaignDefinition(staged, staged.messages.map(({ subject, body }) => ({ subject, body }))).next.messages);
  // The same emails again change nothing, and a second writing replaces the first.
  assert.deepEqual(coworkPersonalCampaignDefinition(next, [{ email: 'cfuentes@adecco.cl', messages: sequence('Camila') }]).changed, []);
  const again = coworkPersonalCampaignDefinition(next, [{ email: 'cfuentes@adecco.cl', messages: sequence('Cami') }]);
  assert.deepEqual([again.changed, again.next.overrides.length, again.next.overrides.filter(item => item.subject === 'Para Cami').length], [[0, 1], 4, 1]);
});

test('whoever had a first email of their own keeps it: only their follow-ups are written', () => {
  const own = { email: 'cfuentes@adecco.cl', messageIndex: 0, subject: 'Camila, 40 vacantes en Adecco', body: 'Hola Camila,\nvi que Adecco abrió 40 vacantes.' };
  const { next, changed } = coworkPersonalCampaignDefinition({ ...staged, overrides: [own] }, [{ email: 'cfuentes@adecco.cl', messages: sequence('Camila') }]);
  assert.deepEqual(changed, [1]);
  assert.deepEqual(next.overrides.map(item => item.subject), ['Camila, 40 vacantes en Adecco', 'Sigo, Camila']);
});

test('personal emails are for recipients, as many as the campaign has, and never mixed with another edit', () => {
  assert.throws(() => coworkPersonalCampaignDefinition(staged, [{ email: 'otra@empresa.cl', messages: sequence('Otra') }]),
    (error: unknown) => error instanceof CoworkCampaignEditRefused && error.status === 400 && /no está entre los destinatarios/.test(error.message));
  assert.throws(() => coworkPersonalCampaignDefinition(staged, [{ email: 'cfuentes@adecco.cl', messages: sequence('Camila').slice(0, 1) }]),
    (error: unknown) => error instanceof CoworkCampaignEditRefused && /tiene 2 correos/.test(error.message));
  const personal = [{ email: 'CFuentes@Adecco.cl', messages: sequence('Camila') }];
  assert.equal(coworkCampaignEditSchema.parse({ personal }).personal![0].email, 'cfuentes@adecco.cl');
  assert.equal(coworkCampaignEditSchema.safeParse({ personal, messages: sequence('x') }).success, false);
  assert.equal(coworkCampaignEditSchema.safeParse({ personal: [] }).success, false);
  assert.equal(coworkCampaignEditSchema.safeParse({}).success, false);
});
