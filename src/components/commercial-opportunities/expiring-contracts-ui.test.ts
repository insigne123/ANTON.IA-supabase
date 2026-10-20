import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { friendlyJobError } from '@/lib/commercial-opportunities/report-view';

test('a reading of «Contratos por vencer» that did not finish says what to do, never the internal accounting', async () => {
  const source = await readFile(new URL('./ExpiringContracts.tsx', import.meta.url), 'utf8');
  assert.match(source, /friendlyJobError\(failed\.error\)/);
  assert.doesNotMatch(source, /\$\{failed\.error/, 'the raw job error is not shown');
  assert.equal(friendlyJobError('La evaluación no terminó. Conservamos los datos y el consumo observado.'), 'Tardó más de lo esperado. Vuelve a intentarlo: suele resolverse al segundo intento.');
  assert.equal(friendlyJobError('No pudimos leer el historial de ChileCompra ahora. Vuelve a intentarlo en unos minutos.'), 'No pudimos leer el historial de ChileCompra ahora. Vuelve a intentarlo en unos minutos.');
});

test('the count says when the list holds contracts that just ended, as their cards do', async () => {
  const source = await readFile(new URL('./ExpiringContracts.tsx', import.meta.url), 'utf8');
  assert.match(source, /o ' \+ \(matching\.length === 1 \? 'venció' : 'vencieron'\) \+ ' el último mes'/);
  assert.match(source, /' por vencer o recién vencidos'/);
});
