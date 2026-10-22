import assert from 'node:assert/strict';
import test from 'node:test';
import { PREFILL_MAX_CHARS } from './prefill';
import { pickPrefillFiles, prefillPackageText, prefillRank } from './prefill-package';

// A private process as it arrives: invented text with the structure of a real package (invitation by platform, general and particular
// conditions, technical bases, framework contract, annexes, a decree).
const doc = (name: string, text: string) => ({ name, sections: [{ locator: 'p. 1', text }] });
const filler = (words: number, seed = 'cláusula') => Array.from({ length: words }, (_, i) => `${seed} ${i}`).join(' ');

test('the document that names the process is read first and the law it quotes last', () => {
  const ranks = Object.fromEntries(['Bases_Proceso_de_Propuestas_-_Condicionado_Particular_Seguridad.pdf', 'Carta de Invitación.docx', 'Bases_Proceso_de_Propuestas_-_Condicionado_General.pdf',
    'Bases_Tecnicas_Servicio.pdf', 'Anexo_1_-_Contrato_Marco.pdf', 'Anexo_B1_Formulario_Oferta.xlsx', 'Notas.txt', 'Anexo_10_-_Decreto_261_2024.pdf']
    .map(name => [name, prefillRank(name)]));
  assert.deepEqual(Object.values(ranks), [0, 0, 1, 2, 4, 3, 5, 6]);
});

test('a package is read in order of importance, within the request limits, and what is left out still goes up with the opportunity', () => {
  const files = ['Anexo_10_-_Decreto.pdf', 'Condicionado_General.pdf', 'Condicionado_Particular.pdf', 'Bases_Tecnicas.pdf', 'Anexo_1_Contrato_Marco.pdf', 'Anexo_A1.xlsx']
    .map((name, index) => ({ name, size: (index + 1) * 1_000_000 }));
  const { chosen, skipped } = pickPrefillFiles(files);
  assert.deepEqual(chosen.map(file => file.name), ['Condicionado_Particular.pdf', 'Condicionado_General.pdf', 'Bases_Tecnicas.pdf', 'Anexo_A1.xlsx', 'Anexo_1_Contrato_Marco.pdf']);
  assert.deepEqual(skipped.map(file => file.name), ['Anexo_10_-_Decreto.pdf'], 'a law never defines the process');

  const heavy = pickPrefillFiles(['A_Particular.pdf', 'B_Bases.pdf', 'C_Tecnica.pdf'].map(name => ({ name, size: 12_000_000 })), { max: 8, bytes: 24_000_000 });
  assert.deepEqual(heavy.chosen.map(file => file.name), ['A_Particular.pdf', 'B_Bases.pdf'], 'the request carries at most 24 MB');
  const many = pickPrefillFiles(Array.from({ length: 12 }, (_, i) => ({ name: `Anexo_${i}.pdf`, size: 1000 })));
  assert.equal(many.chosen.length, 8);
  assert.equal(many.skipped.length, 4);
  // Only a law: it is read, there is nothing else.
  assert.deepEqual(pickPrefillFiles([{ name: 'Ley_21.659.pdf', size: 10 }]).chosen.map(file => file.name), ['Ley_21.659.pdf']);
});

test('short documents are read whole, each under its name', () => {
  const { text, partial } = prefillPackageText([doc('Invitación.docx', 'Los invitamos a participar por la plataforma Coupa.'), doc('Anexo A.docx', 'Declaración jurada simple.')]);
  assert.equal(partial, false);
  assert.match(text, /^=== Documento «Invitación\.docx» ===\n\[p\. 1\]\nLos invitamos/);
  assert.match(text, /=== Documento «Anexo A\.docx» ===\n\[p\. 1\]\nDeclaración jurada simple\./);
});

test('the particular conditions are kept whole when the long documents around them are cut, and a long one keeps its schedule', () => {
  const particular = `FICHA RESUMEN\nAdministrador del proceso: Ana Soto (asoto@cliente.cl)\nBoleta de fiel cumplimiento: 10% del monto anual\n${filler(1800, 'requisito')}\nCRONOGRAMA\nEntrega de ofertas: 23 de octubre de 2026\nAdjudicación: noviembre de 2026`;
  const general = `${filler(9000, 'definición')}\nCRONOGRAMA\nEntrega de propuestas: 30 de octubre de 2026 a las 15:00\n${filler(3000, 'sanción')}`;
  const contract = filler(15000, 'obligación');
  const { text, partial } = prefillPackageText([doc('Contrato_Marco.pdf', contract), doc('Condicionado_General.pdf', general), doc('Condicionado_Particular.pdf', particular)]);
  assert.ok(text.length <= PREFILL_MAX_CHARS, 'never more than the model may read');
  assert.equal(partial, true);
  assert.ok(text.indexOf('Condicionado_Particular') < text.indexOf('Condicionado_General') && text.indexOf('Condicionado_General') < text.indexOf('Contrato_Marco'), 'in reading order');
  assert.match(text, /Entrega de ofertas: 23 de octubre de 2026\nAdjudicación: noviembre de 2026/, 'the schedule at the end of the particular conditions survives');
  assert.match(text, /Administrador del proceso: Ana Soto/);
  assert.match(text, /Entrega de propuestas: 30 de octubre de 2026 a las 15:00/, 'a long document keeps the passage that carries its dates');
  assert.match(text, /\n\[…\]\n/, 'and marks where it was cut');
});

test('the budget is respected however many documents come, and a document with no text is left out', () => {
  const many = Array.from({ length: 8 }, (_, i) => doc(`Anexo_${i}.pdf`, filler(8000, `a${i}`)));
  const { text } = prefillPackageText([...many, doc('Vacío.pdf', '   \n  ')], 20_000);
  assert.ok(text.length <= 20_000);
  assert.doesNotMatch(text, /Vacío\.pdf/);
  for (let i = 0; i < 8; i++) assert.match(text, new RegExp(`Anexo_${i}\\.pdf`), 'every document is read, even if briefly');
});
