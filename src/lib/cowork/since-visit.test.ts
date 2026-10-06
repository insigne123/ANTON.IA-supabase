import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_SINCE_MAX_DAYS, coworkSinceFrom, coworkSinceItems, coworkSinceNames, coworkSinceWhen } from './since-visit';

test('names read as a person would say them: one with their company, two joined, the rest counted once', () => {
  assert.equal(coworkSinceNames([{ name: 'Marcela Rojas', company: 'Constructora Andes' }]), 'Marcela Rojas (Constructora Andes)');
  assert.equal(coworkSinceNames([{ name: 'Marcela Rojas', company: 'A' }, { name: 'Héctor Vidal', company: 'B' }]), 'Marcela Rojas y Héctor Vidal');
  assert.equal(coworkSinceNames([{ name: 'Marcela Rojas' }, { name: 'Héctor Vidal' }, { name: 'Ana Ruiz' }, { name: 'Ana Ruiz' }]), 'Marcela Rojas, Héctor Vidal y 1 más');
  // Without a name the company stands in; with nothing, nothing.
  assert.equal(coworkSinceNames([{ name: null, company: 'Minera Sur' }]), 'Minera Sur');
  assert.equal(coworkSinceNames([{ name: '  ', company: null }]), '');
});

test('each change says what happened with its names, and asks Cowork to work on it; meetings go first', () => {
  const items = coworkSinceItems({
    replies: [{ name: 'Héctor Vidal', company: 'Retail Andes', meeting: false }, { name: 'Marcela Rojas', company: 'Constructora Andes', meeting: true },
      { name: 'Ana Ruiz', company: 'Minera Sur', meeting: false }],
    research: [{ name: 'Carlos Ahumada', company: 'Minera Centinela' }],
    opportunities: { tenders: 2, hiring: 1, projects: 0 },
    linkedin: [{ name: 'Paula Soto' }, { name: 'Tomás Pizarro' }],
  });
  assert.deepEqual(items.map(item => item.kind), ['replies', 'research', 'opportunities', 'linkedin']);
  assert.equal(items[0].text, '3 respuestas nuevas: Marcela Rojas, Héctor Vidal y 1 más · 1 pide reunión');
  assert.match(items[0].prompt, /partiendo por quien pide reunión/);
  assert.equal(items[1].text, '1 investigación lista: Carlos Ahumada (Minera Centinela)');
  assert.equal(items[2].text, '3 oportunidades nuevas: 2 licitaciones o Compras Ágiles, 1 empresa contratando');
  assert.equal(items[3].text, '2 aceptaron tu invitación de LinkedIn: Paula Soto y Tomás Pizarro');
  for (const item of items) assert.ok(item.prompt.length > 20 && item.prompt.length <= 500, item.kind);
  // Nothing new, or a source that could not be read (null), is left out: never a zero.
  assert.deepEqual(coworkSinceItems({ replies: [], research: null, opportunities: { tenders: 0, hiring: 0, projects: 0 }, linkedin: null }), []);
  const one = coworkSinceItems({ replies: [{ name: 'Ana Ruiz', company: null, meeting: false }], research: null, opportunities: null, linkedin: null });
  assert.equal(one[0].text, '1 respuesta nueva: Ana Ruiz');
  assert.doesNotMatch(one[0].prompt, /reunión/);
});

test('the last visit reads by calendar day in Chile, and the look back stops at two weeks', () => {
  const now = new Date('2026-10-06T15:00:00Z');
  assert.equal(coworkSinceWhen('2026-10-06T12:00:00Z', now), 'hoy');
  // 01:00 UTC on the 6th is still the 5th in Chile.
  assert.equal(coworkSinceWhen('2026-10-06T01:00:00Z', now), 'ayer');
  assert.equal(coworkSinceWhen('2026-10-02T15:00:00Z', now), 'hace 4 días');
  assert.equal(coworkSinceFrom('2026-10-04T15:00:00Z', now.getTime()), '2026-10-04T15:00:00.000Z');
  assert.equal(coworkSinceFrom('2026-08-01T15:00:00Z', now.getTime()), new Date(now.getTime() - COWORK_SINCE_MAX_DAYS * 86_400_000).toISOString());
});
