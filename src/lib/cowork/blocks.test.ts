import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coworkBlockFilename, coworkBlockMeta, coworkBlocksText, coworkDraftSteps, coworkEditedEmails, coworkEmailText, coworkSequenceText, coworkTableCsv, coworkTableTsv,
  coworkVersionMessage, coworkWantsCampaignFromVersion,
} from './blocks';

const sequence = { type: 'sequence' as const, title: 'Secuencia AXIS', steps: [
  { day: 1, subject: 'Hola', body: 'Primer correo' }, { day: 4, subject: 'Seguimiento', body: 'Segundo correo' },
] };
const table = { type: 'table' as const, title: 'A quién le escribo', columns: ['Contacto', 'Nota'], rows: [
  ['Felipe Muñoz', 'Dijo "sí"'], ['=HYPERLINK("x")', 'con\ttab'],
] };

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

test('file names and card lines are plain', () => {
  assert.equal(coworkBlockFilename('¿A quién le escribo?', 'csv'), 'a-quien-le-escribo.csv');
  assert.equal(coworkBlockFilename('¿?', 'csv'), 'cowork.csv');
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
  // Keeping a version is not asking for a campaign; an email names its recipients.
  const email = { type: 'email_draft' as const, title: 'Correo', to: ['Felipe Muñoz'], subject: 'Hola', body: 'Hola Felipe,\nNicolás' };
  const use = coworkVersionMessage(email, coworkDraftSteps(email), 'use', false);
  assert.equal(use, 'Usa exactamente esta versión de «Correo», sin cambiar el texto.\n\nAsunto: Hola\n\nHola Felipe,\nNicolás');
  assert.deepEqual(coworkEditedEmails(use), [{ subject: 'Hola', body: 'Hola Felipe,\nNicolás', day: null }]);
  assert.equal(coworkWantsCampaignFromVersion(use), false);
  assert.match(coworkVersionMessage(email, coworkDraftSteps(email), 'campaign', false), /sin cambiar el texto, para Felipe Muñoz\./);
  // Anything a person types is not a version, even if it quotes one.
  for (const typed of ['Crea una campaña con estos correos', 'Usa exactamente esta versión\n\nsin asunto', 'Asunto: Hola\n\nHola', '']) {
    assert.equal(coworkEditedEmails(typed), null);
  }
});
