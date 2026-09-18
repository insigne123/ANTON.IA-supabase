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

test('rejects duplicate recipients', () => {
  assert.throws(() => coworkCampaignDraftSchema.parse({
    ...base, emails: ['ana@example.com', 'ANA@example.com'],
  }), /duplicados/);
});
