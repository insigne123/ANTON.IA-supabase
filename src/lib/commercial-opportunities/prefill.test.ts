import assert from 'node:assert/strict';
import test from 'node:test';
import { PREFILL_MAX_CHARS, prefillFields, prefillPrompt, prefillText, type PrefillAnswer } from './prefill';

const answer = (patch: Partial<PrefillAnswer> = {}): PrefillAnswer => ({ title: 'Servicio de aseo para la planta Lo Aguirre', company: 'Agrosuper', url: 'https://compras.agrosuper.cl/rfp/123',
  kind: 'proposal', description: 'Piden aseo diario de oficinas y casino.', deadline: '2026-11-04T15:00', deadlineTimeGiven: true, amount: 25000000, currency: 'clp', ...patch });

test('the fields the document gave fill the form as they are; nothing is missing', () => {
  const { fields, missing } = prefillFields(answer());
  assert.deepEqual(fields, { title: 'Servicio de aseo para la planta Lo Aguirre', company: 'Agrosuper', url: 'https://compras.agrosuper.cl/rfp/123', kind: 'proposal',
    description: 'Piden aseo diario de oficinas y casino.', deadline: '2026-11-04T15:00', amount: '25000000', currency: 'CLP' });
  assert.deepEqual(missing, []);
});

test('what the document does not say stays empty and is named, and a malformed value is dropped', () => {
  const { fields, missing } = prefillFields(answer({ company: null, url: 'compras.agrosuper.cl', deadline: '4 de noviembre', amount: null, currency: 'pesos', kind: null }));
  assert.equal(fields.company, '');
  assert.equal(fields.url, '', 'only a full web address');
  assert.equal(fields.deadline, '', 'only AAAA-MM-DDTHH:MM fits the date field');
  assert.equal(fields.amount, '');
  assert.equal(fields.currency, 'CLP');
  assert.equal(fields.kind, 'private_tender');
  assert.deepEqual(missing, ['el cliente o la entidad', 'el cierre', 'el monto']);
});

test('a deadline without its hour is kept and the hour is named as missing', () => {
  const { fields, missing } = prefillFields(answer({ deadline: '2026-11-04T23:59', deadlineTimeGiven: false }));
  assert.equal(fields.deadline, '2026-11-04T23:59');
  assert.deepEqual(missing, ['la hora de cierre']);
});

test('the prompt dates today in Chile, asks for nulls instead of guesses and carries the document', () => {
  const prompt = prefillPrompt({ name: 'Invitación.pdf', text: 'Estimados, los invitamos…', today: '2026-10-19' });
  assert.match(prompt, /Hoy es 2026-10-19 en Chile/);
  assert.match(prompt, /Nunca inventes datos/);
  assert.match(prompt, /Nunca calcules ni estimes un monto/);
  assert.match(prompt, /Documento «Invitación\.pdf»:\nEstimados, los invitamos…/);
});

test('a package of documents is read as one, and a private process is read for its platform, schedule and closing', () => {
  const prompt = prefillPrompt({ name: '4 documentos', text: '=== Documento «Condicionado Particular.pdf» ===\nCronograma', today: '2026-10-19', documents: 4 });
  assert.match(prompt, /Lee los 4 documentos que recibió el equipo comercial \(cada uno va bajo su nombre, entre ===\)/);
  assert.match(prompt, /Paquete «4 documentos»:\n=== Documento «Condicionado Particular\.pdf» ===/);
  assert.match(prompt, /la plataforma por la que se presenta \(Coupa, SAP Ariba, WEX u otra\), el administrador del proceso con su correo y las fechas del cronograma/);
  assert.match(prompt, /es la de entrega o presentación de ofertas o propuestas, no la de consultas, respuestas ni confirmación de participación/);
  assert.match(prompt, /private_tender si es una licitación o concurso privado, o un proceso formal de solicitud de propuestas/);
  assert.match(prompt, /un precio por hora, una tarifa, el monto de una garantía o un porcentaje no son el presupuesto/);
  // One document keeps the wording it always had.
  assert.match(prefillPrompt({ name: 'Invitación.pdf', text: 'x', today: '2026-10-19' }), /Lee el documento que recibió el equipo comercial/);
});

test('the text read keeps where each part comes from and stops at the limit', () => {
  assert.equal(prefillText([{ locator: 'Página 1', text: 'Bases   técnicas\n\n\n\nObjeto' }, { locator: 'Página 2', text: '  ' }]), '[Página 1]\nBases técnicas\n\nObjeto');
  const long = prefillText(Array.from({ length: 40 }, (_, i) => ({ locator: `Página ${i + 1}`, text: 'x'.repeat(3000) })));
  assert.equal(long.length, PREFILL_MAX_CHARS);
});
