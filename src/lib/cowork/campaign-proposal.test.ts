import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coworkCampaignDraftSchema } from './campaign-proposal';

const base = {
  name: 'Reactivación', objective: 'Retomar contacto',
  criteria: { relationship: 'never_contacted', titles: [], industries: [], countries: [], sizes: [], seniorities: [], minimumDaysSinceSent: 0, excludeReplied: true, enrichedOnly: true },
  emails: ['ana@example.com'], messages: [{ subject: 'Hola', body: 'Te escribo', delayDays: 0 }],
  provider: 'google' as const,
};

test('accepts a bounded campaign draft', () => {
  const parsed = coworkCampaignDraftSchema.parse(base);
  assert.equal(parsed.emails.length, 1);
});

test('rejects too many recipients, messages and bad delays', () => {
  assert.throws(() => coworkCampaignDraftSchema.parse({
    ...base, emails: Array.from({ length: 26 }, (_, index) => `a${index}@example.com`),
  }));
  assert.throws(() => coworkCampaignDraftSchema.parse({
    ...base, messages: [...base.messages, { subject: 'x', body: 'y', delayDays: 0 }],
  }));
  assert.throws(() => coworkCampaignDraftSchema.parse({
    ...base, messages: [{ subject: 'Hola', body: 'x', delayDays: 2 }],
  }));
});

test('coerces model nulls to documented defaults', () => {
  const parsed = coworkCampaignDraftSchema.parse({
    ...base, objective: null,
    criteria: { relationship: 'never_contacted', titles: null, industries: null, countries: null,
      sizes: null, seniorities: null, minimumDaysSinceSent: 0, excludeReplied: true, enrichedOnly: null },
  });
  assert.equal(parsed.objective, '');
  assert.deepEqual(parsed.criteria.titles, []);
  assert.equal(parsed.criteria.enrichedOnly, true);
});

test('accepts the seven-touch cadence', () => {
  const parsed = coworkCampaignDraftSchema.parse({
    ...base,
    messages: [0, 2, 4, 4, 5, 7, 15].map(delayDays => ({ subject: 'Hola', body: 'Te escribo', delayDays })),
  });
  assert.equal(parsed.messages.length, 7);
});

test('rejects duplicate recipients', () => {
  assert.throws(() => coworkCampaignDraftSchema.parse({
    ...base, emails: ['ana@example.com', 'ANA@example.com'],
  }), /duplicados/);
});

test('rejects an explicit closing promise before a later scheduled touch', () => {
  for (const body of ['Cierro el hilo.', 'No volveré a escribir.', 'Último seguimiento']) {
    assert.equal(coworkCampaignDraftSchema.safeParse({ ...base, messages: [
      { subject: 'Hola', body, delayDays: 0 },
      { subject: 'Continuación', body: 'Una pregunta.', delayDays: 2 },
    ] }).success, false);
  }
});

test('permits a closing promise at the actual end only', () => {
  assert.equal(coworkCampaignDraftSchema.safeParse({ ...base, messages: [
    { subject: 'Hola', body: '¿Quién revisa este tema?', delayDays: 0 },
    { subject: 'Cierre', body: 'Cierro el hilo.', delayDays: 2 },
  ] }).success, true);
});

test('multi-recipient campaigns reject a fixed greeting with one person’s name', () => {
  const multi = { ...base, emails: ['ana@example.com', 'luis@example.com'] };
  assert.equal(coworkCampaignDraftSchema.safeParse({ ...multi, messages: [{ subject: 'Tema', body: 'Hola Ana, una consulta.', delayDays: 0 }] }).success, false);
  assert.equal(coworkCampaignDraftSchema.safeParse({ ...multi, messages: [{ subject: 'Tema', body: 'Hola, una consulta.', delayDays: 0 }] }).success, true);
});

test('the first email of each person goes to a recipient, once', () => {
  const multi = { ...base, emails: ['ana@example.com', 'luis@example.com'] };
  const own = { email: 'Luis@Example.com', subject: 'Luis, una idea', body: 'Hola Luis, vi su apertura en Talca.' };
  const parsed = coworkCampaignDraftSchema.parse({ ...multi, firstEmails: [own] });
  assert.deepEqual(parsed.firstEmails, [{ ...own, email: 'luis@example.com' }]);
  // A greeting with the person's own name is right in their own email.
  assert.equal(coworkCampaignDraftSchema.parse({ ...multi, firstEmails: null }).firstEmails.length, 0);
  assert.match(String(coworkCampaignDraftSchema.safeParse({ ...multi, firstEmails: [{ ...own, email: 'otra@example.com' }] }).error), /no está entre los destinatarios/);
  assert.match(String(coworkCampaignDraftSchema.safeParse({ ...multi, firstEmails: [own, own] }).error), /dos primeros correos/);
});

test('only the campaign variables: nombre, empresa and cargo', () => {
  const body = (text: string) => coworkCampaignDraftSchema.safeParse({ ...base, messages: [{ subject: 'Tema', body: text, delayDays: 0 }] });
  assert.equal(body('Hola {{nombre}}, ¿cómo va {{ empresa }} con {{cargo}}?').success, true);
  assert.match(String(body('Hola {{Nombre}},').error), /\{\{Nombre\}\} no existe/);
  assert.match(String(body('Hola {{first_name}},').error), /usa solo \{\{nombre\}\}/);
  assert.equal(coworkCampaignDraftSchema.safeParse({ ...base, firstEmails: [{ email: 'ana@example.com', subject: '{{rubro}}', body: 'Hola Ana' }] }).success, false);
});
