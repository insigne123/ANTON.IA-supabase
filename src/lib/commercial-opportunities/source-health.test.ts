import assert from 'node:assert/strict';
import test from 'node:test';
import { failingSources, friendlySourceError, lastSearchLabel, sourceHealth, whenLabel, type SourceRun } from './source-health';

// Saturday 24 October 2026, 12:00 in Chile.
const NOW = new Date('2026-10-24T15:00:00.000Z');
const run = (source: SourceRun['source'], state: string, createdAt: string, extra: Partial<SourceRun> = {}): SourceRun =>
  ({ source, state, error: null, createdAt, updatedAt: createdAt, ...extra });

test('each source says how its last day went, in the order of the strip', () => {
  const health = sourceHealth([
    run('posts', 'ready', '2026-10-24T11:06:00Z'),
    run('tenders', 'ready', '2026-10-24T11:03:00Z'),
    run('compraAgil', 'ready', '2026-10-24T11:10:00Z'), run('compraAgil', 'failed', '2026-10-24T11:12:00Z', { error: 'Compra Ágil respondió 504 (falla de Mercado Público).' }),
    run('hiring', 'running', '2026-10-24T14:59:00Z'),
  ], NOW);
  assert.deepEqual(health.map(item => [item.label, item.state, item.detail]), [
    ['Licitaciones', 'ok', 'Respondió hoy 08:03'],
    ['Compra Ágil', 'partial', '1 de 2 búsquedas respondieron; las demás se reintentan mañana'],
    ['LinkedIn', 'ok', 'Respondió hoy 08:06'],
    ['Avisos de trabajo', 'searching', 'Buscando ahora'],
  ]);
  assert.equal(lastSearchLabel(health, NOW), 'Última búsqueda: hoy 08:10');
  assert.equal(lastSearchLabel([], NOW), null);
});

test('a source that fails day after day says so, and the alert hears of it from the second day', () => {
  const health = sourceHealth([
    run('compraAgil', 'failed', '2026-10-24T11:12:00Z', { error: 'Compra Ágil respondió 504 (falla de Mercado Público).' }),
    run('compraAgil', 'failed', '2026-10-23T11:12:00Z', { error: 'Compra Ágil respondió 504 (falla de Mercado Público).' }),
    run('compraAgil', 'ready', '2026-10-22T11:12:00Z'),
    run('posts', 'failed', '2026-10-24T11:06:00Z', { error: 'No se pudo completar la acción de Oportunidades.' }),
    run('posts', 'ready', '2026-10-23T11:06:00Z'),
    run('tenders', 'waiting', '2026-10-24T14:50:00Z'),
  ], NOW);
  assert.deepEqual(health.map(item => [item.source, item.state, item.failingDays, item.detail]), [
    ['tenders', 'retrying', 0, 'No respondió a la primera; reintentamos solos'],
    ['compraAgil', 'failed', 2, 'Mercado Público no respondió · 2 días seguidos'],
    ['posts', 'failed', 1, 'La búsqueda no terminó'],
  ]);
  assert.equal(health[1].at, '2026-10-22T11:12:00Z', 'when it last answered');
  assert.deepEqual(failingSources(health).map(item => item.source), ['compraAgil']);
});

test('the reasons a person reads, and the days', () => {
  assert.equal(friendlySourceError('Conecta el ticket de Mercado Público desde la cuenta administradora.'), 'Falta conectar el ticket de Mercado Público');
  assert.equal(friendlySourceError('Se alcanzó el presupuesto de búsqueda de este mes.'), 'Se alcanzó el presupuesto de búsqueda del mes');
  assert.equal(friendlySourceError(null), 'La búsqueda no terminó');
  assert.equal(whenLabel('2026-10-23T22:30:00Z', NOW), 'ayer 19:30');
  assert.equal(whenLabel('2026-10-20T12:00:00Z', NOW), 'el 20 de octubre');
});
