import test from 'node:test';
import assert from 'node:assert/strict';
import { COWORK_PHONE_REVEAL_CREDITS, coworkPhoneRevealEnabled, coworkPhoneRevealTarget, hashCoworkPhoneReveal, parseCoworkPhoneRevealTarget } from './enrich-phone-target';

const RUN = '00000000-0000-4000-8000-000000000041';
const LEAD = '00000000-0000-4000-8000-000000000061';
const who = { name: 'Paula Ríos', company: 'Transportes del Sur', linkedin: 'https://www.linkedin.com/in/paula-rios', apolloId: 'apollo-1', cost: 10 };

test('a reveal costs what the app shows for a phone: ten credits', () => {
  assert.equal(COWORK_PHONE_REVEAL_CREDITS, 10);
});

test('the flag is off unless it is exactly «true»', () => {
  assert.equal(coworkPhoneRevealEnabled({}), false);
  assert.equal(coworkPhoneRevealEnabled({ COWORK_PHONE_REVEAL_ENABLED: 'TRUE' }), false);
  assert.equal(coworkPhoneRevealEnabled({ COWORK_PHONE_REVEAL_ENABLED: '1' }), false);
  assert.equal(coworkPhoneRevealEnabled({ COWORK_PHONE_REVEAL_ENABLED: 'true' }), true);
});

test('the hash pins the run, the contact, who the card showed and the cost', () => {
  const hash = hashCoworkPhoneReveal(RUN, LEAD, who);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hashCoworkPhoneReveal(RUN, LEAD, { ...who }), hash);
  for (const other of [{ ...who, name: 'Paula Ríos Soto' }, { ...who, company: 'Otra empresa' }, { ...who, linkedin: '' }, { ...who, apolloId: 'apollo-2' }, { ...who, cost: 11 }]) {
    assert.notEqual(hashCoworkPhoneReveal(RUN, LEAD, other), hash);
  }
  assert.notEqual(hashCoworkPhoneReveal('00000000-0000-4000-8000-000000000042', LEAD, who), hash);
  assert.notEqual(hashCoworkPhoneReveal(RUN, '00000000-0000-4000-8000-000000000062', who), hash);
});

test('the target round-trips, and anything else is refused', () => {
  const hash = hashCoworkPhoneReveal(RUN, LEAD, who);
  assert.deepEqual(parseCoworkPhoneRevealTarget(coworkPhoneRevealTarget(LEAD, hash)), { leadId: LEAD, hash });
  for (const bad of ['', 'enrichphone:', `enrichphone:${LEAD}`, `enrichphone:not-a-uuid:${hash}`, `enrichphone:${LEAD}:abc`, `campaignretry:${LEAD}:${hash}`, `enrichphone:${LEAD}:${hash}:extra`]) {
    assert.throws(() => parseCoworkPhoneRevealTarget(bad), /no es válida/, bad);
  }
});
