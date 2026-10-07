import assert from 'node:assert/strict';
import test from 'node:test';

import { zodToJsonSchema } from 'zod-to-json-schema';
import { coworkDecisionSchema } from './agent-loop';
import { coworkThreadMemoryContext, coworkThreadMemorySchema, coworkThreadMemoryTitle, readCoworkThreadMemory } from './thread-memory';

const memory = {
  offer: 'Revisión de antecedentes laborales y penales para procesos de selección (AXIS)',
  audience: 'Jefes de RR. HH. y de reclutamiento en empresas de servicios de Chile',
  people: [
    { leadId: '00000000-0000-4000-8000-0000000000a1', name: 'Rafael Durán', company: 'R&D Montajes', status: 'guardado, con correo, investigación en curso' },
    { leadId: null, name: 'Susana Cáceres', company: 'MSTI', status: 'sin correo según el proveedor' },
  ],
  decisions: ['Tono cercano, sin tutear'],
  pending: ['Escribir el primer correo a Rafael cuando termine su investigación'],
};

test('the memory keeps the offer, the audience, the people with their state, decisions and what is pending', () => {
  assert.deepEqual(coworkThreadMemorySchema.parse(memory), memory);
  assert.equal(readCoworkThreadMemory(memory)?.offer, memory.offer);
  // Anything else reads as no memory instead of failing the turn.
  assert.equal(readCoworkThreadMemory(null), null);
  assert.equal(readCoworkThreadMemory({ ...memory, people: 'Rafael' }), null);
  assert.equal(readCoworkThreadMemory({ ...memory, extra: true }), null);
  assert.throws(() => coworkThreadMemorySchema.parse({ ...memory, people: Array.from({ length: 26 }, () => memory.people[1]) }));
});

test('each turn sees the first request of the conversation and its memory, with how to use them', () => {
  const context = coworkThreadMemoryContext({ firstRequest: 'Quiero vender revisión de antecedentes a empresas de servicios', memory });
  assert.equal(context?.firstRequest, 'Quiero vender revisión de antecedentes a empresas de servicios');
  assert.equal(context?.memory?.audience, memory.audience);
  assert.match(context!.instruction, /esa oferta manda sobre userContext\.offer/);
  assert.equal(coworkThreadMemoryContext({ firstRequest: null, memory: null }), null, 'a first turn without memory adds nothing');
  assert.equal(coworkThreadMemoryContext({ firstRequest: 'x'.repeat(4000), memory: null })?.firstRequest?.length, 1500);
});

test('the conversation gets a short name: optional for the memories stored before it, required and nullable for the model', () => {
  const named = { ...memory, title: 'Antecedentes para RR. HH.' };
  assert.equal(readCoworkThreadMemory(named)?.title, 'Antecedentes para RR. HH.');
  assert.equal(readCoworkThreadMemory(memory)?.offer, memory.offer, 'a memory stored without a name still reads');
  // A name that does not fit (too long, empty) goes on its own: the rest of the memory, and the decision carrying it, stay.
  assert.equal(readCoworkThreadMemory({ ...memory, title: 'x'.repeat(61) })?.title, null);
  assert.equal(readCoworkThreadMemory({ ...memory, title: '' })?.offer, memory.offer);
  assert.equal(coworkDecisionSchema.safeParse({ action: 'answer', reads: null, query: null, leadId: null, searchCriteria: null, outline: null,
    answer: { reply: 'Listo.', document: null, question: null, blocks: null, suggestions: null, choices: null }, memory: { ...memory, title: '' } }).success, true);
  assert.equal(coworkThreadMemoryTitle(named), 'Antecedentes para RR. HH.');
  assert.equal(coworkThreadMemoryTitle({ ...memory, title: '   ' }), null);
  assert.equal(coworkThreadMemoryTitle(null), null);
  // OpenAI strict mode: every property listed as required, the optional ones nullable.
  const json = zodToJsonSchema(coworkThreadMemorySchema, { target: 'openAi', $refStrategy: 'none' }) as { required: string[]; properties: Record<string, { type?: unknown; anyOf?: unknown[] }> };
  assert.ok(json.required.includes('title'));
  assert.match(JSON.stringify(json.properties.title), /null/);
});
