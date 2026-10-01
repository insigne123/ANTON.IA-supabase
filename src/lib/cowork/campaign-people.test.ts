import assert from 'node:assert/strict';
import test from 'node:test';
import { CampaignInputSchema, type AudiencePerson } from '@/lib/bulk-campaigns';
import { coworkCampaignMessageFor, coworkCampaignPeople, coworkCampaignRenderProblem } from './campaign-people';

const person = (email: string, name: string, extra: Partial<AudiencePerson> = {}): AudiencePerson => ({
  email, name, company: 'Adecco', title: 'Gerenta de Personas', industry: '', country: 'Chile', size: '', seniority: '',
  leadRef: email, lastSentAt: null, contacted: false, replied: false, blockedReason: null, reasons: [], enriched: true, ...extra,
});
const definition = CampaignInputSchema.parse({
  name: 'AXIS · RR. HH.', description: '', objective: 'Primera conversación',
  criteria: { relationship: 'never_contacted', titles: [], industries: [], countries: [], sizes: [], seniorities: [], minimumDaysSinceSent: 0, excludeReplied: true, enrichedOnly: true },
  emails: ['cfuentes@adecco.cl', 'rgodoy@sodexo.cl'], provider: 'google',
  messages: [
    { subject: 'AXIS para {{empresa}}', body: 'Hola {{nombre}},\nTe escribo por AXIS.\nNicolás', delayDays: 0 },
    { subject: '¿Lo vemos?', body: 'Hola {{nombre}},\n¿Te sirve el jueves?\nNicolás', delayDays: 2 },
  ],
  overrides: [{ email: 'cfuentes@adecco.cl', messageIndex: 0, subject: 'Camila, 40 vacantes en Adecco', body: 'Hola Camila,\nvi que Adecco abrió 40 vacantes.\nNicolás' }],
});
const audience = [person('cfuentes@adecco.cl', 'Camila Fuentes'), person('rgodoy@sodexo.cl', 'Rafael Du***n', { company: 'Sodexo' })];

test('each person gets their own first email, or the template with their data', () => {
  assert.equal(coworkCampaignMessageFor(definition, 'cfuentes@adecco.cl', 0).subject, 'Camila, 40 vacantes en Adecco');
  assert.equal(coworkCampaignMessageFor(definition, 'cfuentes@adecco.cl', 1).subject, '¿Lo vemos?');
  assert.equal(coworkCampaignMessageFor(definition, 'rgodoy@sodexo.cl', 0).subject, 'AXIS para {{empresa}}');
  const people = coworkCampaignPeople(definition, audience);
  assert.deepEqual(people.map(item => [item.email, item.name, item.personal, item.first?.subject, item.first?.body.split('\n')[0], item.greetsByName, item.problem]), [
    ['cfuentes@adecco.cl', 'Camila Fuentes', true, 'Camila, 40 vacantes en Adecco', 'Hola Camila,', true, null],
    // A hidden surname is shown as an initial, and the greeting uses the first name only.
    ['rgodoy@sodexo.cl', 'Rafael D.', false, 'AXIS para Sodexo', 'Hola Rafael,', true, null],
  ]);
  assert.equal(coworkCampaignRenderProblem(definition, audience), null);
});

test('a greeting without the person\'s name is pointed out, never rewritten', () => {
  const bare = CampaignInputSchema.parse({ ...definition, overrides: [],
    messages: [{ ...definition.messages[0], body: 'Hola,\nTe escribo por AXIS.\nNicolás' }, definition.messages[1]] });
  const people = coworkCampaignPeople(bare, audience);
  assert.deepEqual(people.map(item => [item.first?.body.split('\n')[0], item.greetsByName]), [['Hola,', false], ['Hola,', false]]);
  // Accents and case do not matter: «Hola ÁLVARO,» names Álvaro.
  const alvaro = coworkCampaignPeople(CampaignInputSchema.parse({ ...definition, emails: ['cfuentes@adecco.cl'], overrides: [
    { email: 'cfuentes@adecco.cl', messageIndex: 0, subject: 'Tema', body: 'Hola ALVARO,\nUna idea.' }] }), [person('cfuentes@adecco.cl', 'Álvaro Soto')]);
  assert.equal(alvaro[0].greetsByName, true);
});

test('without a first name the person leaves the campaign; the card says what is missing', () => {
  const hidden = [audience[0], person('rgodoy@sodexo.cl', 'R***l Durán')];
  assert.match(String(coworkCampaignRenderProblem(definition, hidden)), /^rgodoy@sodexo\.cl no tiene un nombre de pila guardado.*sácalo de esta campaña/);
  const [, rafael] = coworkCampaignPeople(definition, hidden);
  assert.equal(rafael.first, null);
  assert.equal(rafael.problem, 'Falta su nombre de pila para su primer correo: complétalo en Contactos o quítalo de la campaña.');
  // Another missing datum names the email and the variable.
  const noCompany = [audience[0], person('rgodoy@sodexo.cl', 'Rafael Durán', { company: '' })];
  assert.equal(coworkCampaignRenderProblem(definition, noCompany), 'A rgodoy@sodexo.cl le falta su empresa para su primer correo: sácalo de la campaña o no uses {{empresa}}.');
});

test('someone who left the audience or can no longer be written to is said, not hidden', () => {
  const [, gone] = coworkCampaignPeople(definition, [audience[0]]);
  assert.deepEqual([gone.available, gone.first, gone.problem], [false, null, 'Ya no está en tus contactos con este correo, o dejó de calzar con la audiencia.']);
  const [, blocked] = coworkCampaignPeople(definition, [audience[0], { ...audience[1], blockedReason: 'unsubscribed' }]);
  assert.equal(blocked.available, false);
  assert.match(String(blocked.problem), /Ya no se le puede escribir/);
  assert.equal(blocked.first?.body.split('\n')[0], 'Hola Rafael,');
  // Availability is checked on its own before staging: the render check skips them.
  assert.equal(coworkCampaignRenderProblem(definition, [audience[0]]), null);
});
