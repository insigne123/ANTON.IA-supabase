import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkArtifactFileName, coworkArtifactFileParts, coworkArtifactKey, coworkDesignBriefSchema } from './design-brief';

test('an artifact key is a short, stable slug of its title, and its file name carries the version', () => {
  assert.equal(coworkArtifactKey('Pipeline de Octubre — Minería'), 'pipeline-de-octubre-mineria');
  assert.equal(coworkArtifactKey('¡¿!'), 'artefacto');
  const long = coworkArtifactKey('Tablero de la prospección de gerentes de operaciones de mineras en Antofagasta');
  assert.ok(long.length <= 48 && !long.endsWith('-'));
  assert.equal(coworkArtifactFileName('pipeline', 2), 'artifact-pipeline-v2.html');
  assert.deepEqual(coworkArtifactFileParts('artifact-pipeline-de-octubre-v12.html'), { key: 'pipeline-de-octubre', version: 12 });
  // Any other file (an executor output, a path) is not an artifact.
  for (const name of ['reporte.xlsx', 'artifact-../x-v1.html', 'artifact-pipeline-v1.html.code.json', 'artifact-Pipeline-v1.html']) {
    assert.equal(coworkArtifactFileParts(name), null, name);
  }
});

test('the brief names 1 to 3 known tables, and previous only as an artifact file name', () => {
  const brief = { title: 'Pipeline por etapa', goal: 'Ver en qué etapa está cada contacto y qué toca hoy.', tables: ['pipeline'], previous: null, change: null };
  assert.ok(coworkDesignBriefSchema.safeParse(brief).success);
  assert.ok(coworkDesignBriefSchema.safeParse({ ...brief, previous: 'artifact-pipeline-por-etapa-v1.html', change: 'Solo minería' }).success);
  for (const wrong of [
    { ...brief, tables: [] }, { ...brief, tables: ['pipeline', 'contacts', 'activity', 'campaigns'] }, { ...brief, tables: ['emails'] },
    { ...brief, previous: '../otro.html' }, { ...brief, previous: 'reporte.xlsx' }, { ...brief, goal: 'corto' }, { ...brief, extra: true },
  ]) assert.equal(coworkDesignBriefSchema.safeParse(wrong).success, false, JSON.stringify(wrong));
});
