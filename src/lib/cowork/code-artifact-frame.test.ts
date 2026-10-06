import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkArtifactChangeMessage, coworkArtifactFixMessage } from './code-artifact-frame';

test('«Pedir cambios» and «Arreglarlo» tie the message to the artifact by its file name', () => {
  const artifact = { title: 'Pipeline por etapa', name: 'artifact-pipeline-por-etapa-v2.html' };
  assert.equal(coworkArtifactChangeMessage(artifact, '  solo minería  '), 'Cambia el artefacto «Pipeline por etapa» (artifact-pipeline-por-etapa-v2.html): solo minería');
  assert.equal(coworkArtifactFixMessage(artifact, { message: 'x is not defined', line: 14 }),
    'Arregla el artefacto «Pipeline por etapa» (artifact-pipeline-por-etapa-v2.html): falló con «x is not defined» en la línea 14 de su código.');
  assert.equal(coworkArtifactFixMessage(artifact, { message: 'x'.repeat(400), line: null }).length, 'Arregla el artefacto «Pipeline por etapa» (artifact-pipeline-por-etapa-v2.html): falló con «»."'.length - 1 + 240);
});
