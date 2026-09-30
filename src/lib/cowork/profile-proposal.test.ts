import assert from 'node:assert/strict';
import test from 'node:test';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { coworkProfileDecisionSchema, coworkProfilePatchFromDecision } from './profile-proposal';

// What strict structured output sends when only the offer and the site change: every field, the rest null.
const strict = { name: null, role: null, companyName: null, sector: null, website: 'https://yago.cl', description: null, services: null,
  valueProposition: 'Revisión de antecedentes laborales en minutos para equipos de RR. HH. en Chile.', proofPoints: null, signature: null };

test('a profile update from the model keeps only what changes: null or empty means «leave it as it is»', () => {
  const decided = coworkProfileDecisionSchema.parse(strict);
  assert.deepEqual(coworkProfilePatchFromDecision(decided), { website: 'https://yago.cl', valueProposition: strict.valueProposition });
  assert.deepEqual(coworkProfilePatchFromDecision({ ...decided, sector: '   ', signature: { channel: 'gmail', html: ' ', enabled: false, separatorPlaintext: true } }),
    { website: 'https://yago.cl', valueProposition: strict.valueProposition }, 'an empty signature is no signature change');
  // Nothing left to change is no patch: the loop asks again instead of proposing an empty card.
  assert.equal(coworkProfilePatchFromDecision(coworkProfileDecisionSchema.parse({ ...strict, website: null, valueProposition: '' })), null);
  assert.equal(coworkProfilePatchFromDecision(null), null);
  // A real signature change still goes through, sanitized later on the server.
  assert.deepEqual(coworkProfilePatchFromDecision({ signature: { channel: 'outlook', html: '<b>Ana</b>', enabled: true, separatorPlaintext: true } }),
    { signature: { channel: 'outlook', html: '<b>Ana</b>', enabled: true, separatorPlaintext: true } });
  // Too long is still refused.
  assert.equal(coworkProfilePatchFromDecision({ valueProposition: 'x'.repeat(2001) } as never), null);
});

test('the schema the model gets lets every field be null, so it never has to invent one to answer', () => {
  const schema = zodToJsonSchema(coworkProfileDecisionSchema, { target: 'openAi', $refStrategy: 'none' }) as { properties: Record<string, { anyOf?: Array<{ type?: string }> }> };
  for (const [name, property] of Object.entries(schema.properties)) {
    assert.ok(property.anyOf?.some(option => option.type === 'null'), `${name} can be null`);
  }
});
