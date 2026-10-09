import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkCompetencies } from './competencies';
test('relevant competencies load within the bounded context and marketing claims stay grounded', () => {
  const seo = coworkCompetencies('Prepara contenido SEO para mi landing de captación de clientes');
  assert.ok(seo.some(item => item.id === 'content')); assert.ok(seo.some(item => item.id === 'miniapp'));
  assert.ok(seo.length <= 3); assert.ok(seo.every(item => item.version === '1' && !('tools' in item)));
  assert.deepEqual(coworkCompetencies('hola'), []);
  const linkedin = coworkCompetencies('Escribe un mensaje de LinkedIn para mi contacto');
  assert.equal(linkedin[0].id, 'linkedin'); assert.match(linkedin[0].criteria.join(' '), /no equivale/);
});
