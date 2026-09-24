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
