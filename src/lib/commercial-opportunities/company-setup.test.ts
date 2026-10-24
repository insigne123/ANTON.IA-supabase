import assert from 'node:assert/strict';
import test from 'node:test';
import { companySetupSteps } from './company-setup';

test('a new workspace sees the four steps, each saying what is missing', () => {
  const steps = companySetupSteps({ documentKinds: ['f30', 'iso'], competitors: 0, assigned: false, ticket: 'shared' });
  assert.deepEqual(steps.map(step => [step.id, step.done]), [['documents', false], ['ticket', false], ['assign', false], ['competitors', false]]);
  assert.equal(steps[0].detail, '1 de 5. Falta: Certificado F30-1, Certificado de vigencia de la sociedad, Vigencia del poder del representante legal y Estados financieros.');
});

test('a step done says so, and one that could not be read is left out instead of asked for again', () => {
  const steps = companySetupSteps({ documentKinds: ['f30', 'f30_1', 'vigencia', 'poder', 'estados_financieros'], competitors: null, assigned: true, ticket: null });
  assert.deepEqual(steps.map(step => [step.id, step.done, step.detail]), [
    ['documents', true, 'Están los cinco: te avisamos antes de que venzan.'],
    ['assign', true, 'Tu equipo ya trabaja oportunidades.'],
  ]);
  assert.equal(companySetupSteps({ documentKinds: [], competitors: 3, assigned: false, ticket: 'own' }).find(step => step.id === 'competitors')?.detail, 'Sigues a 3 empresas.');
});
