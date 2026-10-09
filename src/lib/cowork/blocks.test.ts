import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coworkBlockMeta, coworkBlocksText, coworkDraftSteps, coworkEditedEmails, coworkEmailText, coworkSequenceText, coworkTableCsv, coworkTableTsv,
  coworkOnlyUsesVersion, coworkVersionMessage, coworkVersionSource, coworkWantsCampaignFromVersion, coworkWordDiff, coworkFigureNumber, coworkEffectiveDraft,
} from './blocks';

const sequence = { type: 'sequence' as const, title: 'Secuencia AXIS', steps: [
  { day: 1, subject: 'Hola', body: 'Primer correo' }, { day: 4, subject: 'Seguimiento', body: 'Segundo correo' },
] };
const table = { type: 'table' as const, title: 'A quién le escribo', columns: ['Contacto', 'Nota'], rows: [
  ['Felipe Muñoz', 'Dijo "sí"'], ['=HYPERLINK("x")', 'con\ttab'],
] };
test('effective edit preserves metadata and refuses drift from its generated base', () => {
  const stored = { base: JSON.stringify(coworkDraftSteps(sequence)), steps: coworkDraftSteps(sequence).map(step => ({ ...step, body: 'Editado' })) };
  const effective = coworkEffectiveDraft(sequence, stored);
  assert.equal(effective.steps[1].body, 'Editado');
  assert.equal(coworkDraftSteps(effective)[1].day, 4);
  assert.equal(coworkEffectiveDraft({ ...sequence, steps: [{ ...sequence.steps[0], body: 'Nuevo' }, sequence.steps[1]] }, stored).steps[0].body, 'Nuevo');
});

test('what a card copies reads as an email, a numbered sequence or a pasteable table', () => {
  assert.equal(coworkEmailText({ subject: 'Hola', body: 'Cuerpo' }), 'Asunto: Hola\n\nCuerpo');
  assert.equal(coworkSequenceText(sequence), 'Correo 1 · día 1\nAsunto: Hola\n\nPrimer correo\n\n---\n\nCorreo 2 · día 4\nAsunto: Seguimiento\n\nSegundo correo');
  assert.equal(coworkTableTsv(table), 'Contacto\tNota\nFelipe Muñoz\tDijo "sí"\n=HYPERLINK("x")\tcon tab');
});

test('the CSV opens in a spreadsheet with accents and no formulas', () => {
  const csv = coworkTableCsv(table);
  assert.ok(csv.startsWith('﻿'));
  assert.equal(csv.slice(1), '"Contacto","Nota"\r\n"Felipe Muñoz","Dijo ""sí"""\r\n"\'=HYPERLINK(""x"")","con\ttab"');
});

test('card lines are plain', () => {
  assert.equal(coworkBlockMeta({ type: 'email_draft', title: 'x', to: ['Felipe', 'Camila', 'Rodrigo'], subject: 's', body: 'b' }), 'Correo · para Felipe y 2 más');
  assert.equal(coworkBlockMeta({ type: 'email_draft', title: 'x', to: null, subject: 's', body: 'b' }), 'Correo');
  assert.equal(coworkBlockMeta(sequence), 'Secuencia · 2 correos en 4 días');
  assert.equal(coworkBlockMeta(table), 'Tabla · 2 filas');
  assert.equal(coworkBlockMeta({ type: 'metrics', title: 'x', period: 'Últimos 7 días', items: [] }), 'Cifras · Últimos 7 días');
  assert.match(coworkBlocksText([{ type: 'metrics', title: 'Semana', period: null, items: [{ label: 'Envíos', value: '1', detail: '1 de 1' }] }]), /Envíos: 1 \(1 de 1\)/);
});

test('a version sent from a card reads back exactly, and nothing else does', () => {
  const edited = coworkDraftSteps(sequence).map((step, index) => index === 1 ? { ...step, body: 'Segundo correo, más corto.\n\nNicolás' } : step);
  const campaign = coworkVersionMessage(sequence, edited, 'campaign', true);
  assert.match(campaign, /^Crea una campaña pausada con esta versión editada de «Secuencia AXIS», sin cambiar el texto\.\n\nCorreo 1 · día 1\nAsunto: Hola/);
  assert.deepEqual(coworkEditedEmails(campaign), [
    { subject: 'Hola', body: 'Primer correo', day: 1 }, { subject: 'Seguimiento', body: 'Segundo correo, más corto.\n\nNicolás', day: 4 }]);
  assert.equal(coworkWantsCampaignFromVersion(campaign), true);
  assert.equal(coworkOnlyUsesVersion(campaign), false);
  // Keeping a version is not asking for a campaign; an email names its recipients.
  const email = { type: 'email_draft' as const, title: 'Correo', to: ['Felipe Muñoz'], subject: 'Hola', body: 'Hola Felipe,\nNicolás' };
  const use = coworkVersionMessage(email, coworkDraftSteps(email), 'use', false);
  assert.equal(use, 'Usa exactamente esta versión de «Correo», sin cambiar el texto.\n\nAsunto: Hola\n\nHola Felipe,\nNicolás');
  assert.deepEqual(coworkEditedEmails(use), [{ subject: 'Hola', body: 'Hola Felipe,\nNicolás', day: null }]);
  assert.equal(coworkWantsCampaignFromVersion(use), false);
  assert.equal(coworkOnlyUsesVersion(use), true);
  assert.equal(coworkOnlyUsesVersion('Usa exactamente esta versión, pero mejora el asunto'), false);
  assert.match(coworkVersionMessage(email, coworkDraftSteps(email), 'campaign', false), /sin cambiar el texto, para Felipe Muñoz\./);
  // Anything a person types is not a version, even if it quotes one.
  for (const typed of ['Crea una campaña con estos correos', 'Usa exactamente esta versión\n\nsin asunto', 'Asunto: Hola\n\nHola', '']) {
    assert.equal(coworkEditedEmails(typed), null);
  }
});

test('a version names the card it came from, whether it was edited and what it asked for', () => {
  const edited = coworkDraftSteps(sequence).map((step, index) => index === 1 ? { ...step, body: 'Otro cuerpo' } : step);
  assert.deepEqual(coworkVersionSource(coworkVersionMessage(sequence, edited, 'campaign', true)), { title: 'Secuencia AXIS', edited: true, intent: 'campaign' });
  const email = { type: 'email_draft' as const, title: 'Correo «corto» a Felipe', to: ['Felipe'], subject: 'Hola', body: 'Hola Felipe' };
  assert.deepEqual(coworkVersionSource(coworkVersionMessage(email, coworkDraftSteps(email), 'use', false)), { title: 'Correo «corto» a Felipe', edited: false, intent: 'use' });
  assert.equal(coworkVersionSource('Usa exactamente esta versión de «X», sin cambiar el texto.'), null);
  assert.equal(coworkVersionSource('Crea una campaña con la secuencia'), null);
});

test('after an edit, only the new or rewritten words are marked, one mark per change', () => {
  const marked = (before: string, after: string) => coworkWordDiff(before, after).filter(part => part.changed).map(part => part.text);
  assert.deepEqual(coworkWordDiff('Hola Felipe,', 'Hola Felipe,'), [{ text: 'Hola Felipe,', changed: false }]);
  assert.deepEqual(marked('Hola Felipe, te escribo por AXIS.', 'Hola Felipe, te escribo hoy por AXIS de Yago.'), ['hoy', 'de Yago']);
  assert.deepEqual(marked('Nos vemos el martes', 'Nos vemos el jueves'), ['jueves']);
  // Removed words leave nothing to mark; the text always reads back whole.
  assert.deepEqual(marked('Hola Felipe, ¿cómo estás?', 'Hola Felipe'), []);
  const after = 'Hola Camila,\n\nTe escribo por AXIS.';
  assert.equal(coworkWordDiff('Hola Felipe,\n\nTe escribo.', after).map(part => part.text).join(''), after);
  // Very long texts are not compared.
  const long = Array.from({ length: 600 }, (_, index) => `palabra${index}`).join(' ');
  assert.deepEqual(marked(long, `${long} nueva`), []);
});

test('a figure counts only its whole number and writes it back exactly as given', () => {
  const back = (value: string) => {
    const figure = coworkFigureNumber(value);
    return figure ? `${figure.before}${figure.format(figure.number)}${figure.after}` : null;
  };
  for (const value of ['45%', '1.200', 'US$ 300', '3 de 5', '12.345.678 envíos', '0']) assert.equal(back(value), value);
  assert.equal(coworkFigureNumber('1.200')?.number, 1200);
  assert.equal(coworkFigureNumber('US$ 300')?.before, 'US$ ');
  // Decimals, grouped decimals and words stay as text.
  for (const value of ['12,5 %', '1.234,5', '3.5', 'Sin datos', '—', '']) assert.equal(coworkFigureNumber(value), null, value);
});
