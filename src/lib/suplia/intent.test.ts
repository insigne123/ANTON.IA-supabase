import test from 'node:test';
import assert from 'node:assert/strict';

import { classifySupliaIntent, getSupliaDirectReply } from './intent';

test('classifies short greetings as smalltalk', () => {
  const result = classifySupliaIntent('hola');
  assert.equal(result.intent, 'smalltalk');
  assert.ok(getSupliaDirectReply(result)?.includes('Hola'));
});

test('classifies capability questions without creating work', () => {
  const result = classifySupliaIntent('que puedes hacer?');
  assert.equal(result.intent, 'capabilities');
  assert.ok(getSupliaDirectReply(result)?.includes('artefactos'));
});

test('classifies company context questions without creating artifacts', () => {
  const result = classifySupliaIntent('conoces mi empresa?');
  assert.equal(result.intent, 'company_context');
  assert.equal(getSupliaDirectReply(result), null);
});

test('classifies general knowledge questions as out of scope', () => {
  const result = classifySupliaIntent('que es la gravedad?');
  assert.equal(result.intent, 'out_of_scope');
  assert.ok(getSupliaDirectReply(result)?.includes('no esta pensado'));
  assert.equal(classifySupliaIntent('la gravedad po, en el espacio').intent, 'out_of_scope');
  assert.equal(classifySupliaIntent('cuanto es pi?').intent, 'out_of_scope');
  assert.equal(classifySupliaIntent('suma 2+2 cuanto es ?').intent, 'out_of_scope');
  assert.equal(classifySupliaIntent('cuanto es 2+2?').intent, 'out_of_scope');
});

test('keeps commercial concepts inside SUPLIA scope', () => {
  assert.notEqual(classifySupliaIntent('que es un ICP?').intent, 'out_of_scope');
  assert.notEqual(classifySupliaIntent('como mejorar mi campana?').intent, 'out_of_scope');
  assert.notEqual(classifySupliaIntent('calcula conversion de esta campana').intent, 'out_of_scope');
  assert.notEqual(classifySupliaIntent('suma los leads por etapa').intent, 'out_of_scope');
});

test('classifies lead search as operational workflow', () => {
  const result = classifySupliaIntent('busca leads para vender mi software a constructoras');
  assert.equal(result.intent, 'job_workflow');
});

test('classifies gmail analysis as operational workflow', () => {
  const result = classifySupliaIntent('revisa mi Gmail sobre Axis y dime a quienes contacte');
  assert.equal(result.intent, 'job_workflow');
});

test('classifies artifact edits separately from new artifacts', () => {
  assert.equal(classifySupliaIntent('hazlo mas corto y con tono mas directo').intent, 'artifact_update');
  assert.equal(classifySupliaIntent('redacta un email breve para un CEO').intent, 'artifact_create');
});
