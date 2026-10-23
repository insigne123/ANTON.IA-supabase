import assert from 'node:assert/strict';
import test from 'node:test';

import { nativeResearchInternals } from './native-research';

const page = (body: string) => nativeResearchInternals.officialPageFromHtml(
  new URL('https://minera.example/operaciones'),
  `<html><head><title>Operaciones</title></head><body><h2>Operaciones</h2>${body}</body></html>`,
);
const statementsOf = (body: string) => nativeResearchInternals.usefulOfficialPageContents(page(body)).map((item) => item.statement);

test('a number with a thousands separator keeps its whole sentence: «1.390 millones» is not kept as «390 millones»', () => {
  const statements = statementsOf([
    '<p>La División Radomiro Tomic tiene reservas por 1.390 millones de toneladas de sulfuros, con una ley promedio de 0,5%.</p>',
    '<p>Produce 255.000 toneladas de cobre fino al año, con costos unitarios 15% más bajos que las operaciones independientes.</p>',
  ].join(''));
  assert.ok(statements.some((statement) => statement.startsWith('La División Radomiro Tomic') && statement.includes('1.390 millones de toneladas')), statements.join(' | '));
  assert.ok(statements.some((statement) => statement.startsWith('Produce 255.000 toneladas')), statements.join(' | '));
  // Nothing begins with the tail of a number cut at its separator.
  assert.ok(!statements.some((statement) => /^\d{3}\b/.test(statement)), statements.join(' | '));
});

test('an abbreviation with periods inside does not cut the sentence or leave a stray «A.»', () => {
  const statements = statementsOf('<p>Minera Ejemplo S.A. opera la mina Chuquicamata desde 1995 y emplea a 3.500 personas en la región de Antofagasta.</p>');
  assert.ok(statements.some((statement) => statement.startsWith('Minera Ejemplo S.A. opera la mina') && statement.includes('3.500 personas')), statements.join(' | '));
  assert.ok(!statements.some((statement) => /^A\.\s*$/.test(statement)));
});

test('sentences still end where they end: a period, a space and a capital', () => {
  const statements = statementsOf('<p>La compañía abrió dos faenas nuevas en el norte durante 2025. En 2026 anunció una inversión para ampliar su planta de procesos.</p>');
  assert.ok(statements.length >= 1);
  const joined = statements.join(' ');
  assert.match(joined, /abrió dos faenas nuevas en el norte durante 2025/);
  assert.match(joined, /En 2026 anunció una inversión/);
});
