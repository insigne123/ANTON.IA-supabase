import test from 'node:test';
import assert from 'node:assert/strict';
import { personChips, personNextStep, researchSteps } from '../ui/person-status.ts';

const base = { saved: false, enrichedReady: false, email: '', emailStatus: 'unknown', research: null, researchEnabled: true, phonePending: false, sent: false, hasMessage: false };
const ready = { status: 'completed', researchSnapshotId: 's', reportDocumentV2: { synthesis: { status: 'completed' } } };
const collecting = { status: 'running' };
const writing = { status: 'completed', researchSnapshotId: 's', reportSynthesisV2: { status: 'running' } };

test('the next step follows the order a contact gets ready', () => {
  const steps = [
    [base, 'enrich'],
    [{ ...base, enrichedReady: true }, 'save'],
    [{ ...base, saved: true }, 'find-email'],
    [{ ...base, saved: true, email: 'ana@acme.cl' }, 'research'],
    [{ ...base, saved: true, email: 'ana@acme.cl', research: ready }, 'write'],
    // Without research in the account, writing comes right after the email.
    [{ ...base, saved: true, email: 'ana@acme.cl', researchEnabled: false }, 'write'],
  ];
  for (const [state, id] of steps) assert.equal(personNextStep(state)?.id, id, JSON.stringify(state));
  assert.equal(personNextStep({ ...base, saved: true, email: 'a@b.cl', research: ready }).label, 'Escribir mensaje');
  assert.equal(personNextStep({ ...base, saved: true, email: 'a@b.cl', research: ready, hasMessage: true }).label, 'Revisar el mensaje');
});

test('nothing to press while the research runs or once the message went out', () => {
  assert.equal(personNextStep({ ...base, saved: true, email: 'a@b.cl', research: collecting }), null);
  assert.equal(personNextStep({ ...base, saved: true, email: 'a@b.cl', research: writing }), null);
  assert.equal(personNextStep({ ...base, saved: true, email: 'a@b.cl', research: ready, sent: true }), null);
});

test('the chips say where the contact stands, without repeating what is unknown', () => {
  const label = state => personChips(state).map(chip => `${chip.label}:${chip.tone}`);
  assert.deepEqual(label(base), ['Sin guardar:neutral']);
  assert.deepEqual(label({ ...base, saved: true }), ['Guardado:success', 'Sin correo:neutral']);
  assert.deepEqual(label({ ...base, saved: true, email: 'a@b.cl', emailStatus: 'verified', research: collecting, phonePending: true }),
    ['Guardado:success', 'Correo verificado:success', 'Teléfono pendiente:info', 'Investigando…:info']);
  assert.deepEqual(label({ ...base, saved: true, email: 'a@b.cl', research: ready, sent: true }),
    ['Guardado:success', 'Con correo:info', 'Investigado:success', 'Mensaje enviado:success']);
  assert.deepEqual(label({ ...base, saved: true, email: 'a@b.cl', research: { status: 'failed' } }),
    ['Guardado:success', 'Con correo:info', 'Investigación con problemas:warning']);
});

test('the research steps are the app\'s three, with the current one marked', () => {
  const states = research => researchSteps(research)?.map(step => step.state);
  assert.deepEqual(states(collecting), ['current', 'pending', 'pending']);
  assert.deepEqual(states(writing), ['done', 'current', 'pending']);
  assert.deepEqual(states(ready), ['done', 'done', 'done']);
  assert.equal(researchSteps(null), null);
  assert.equal(researchSteps({ status: 'failed' }), null);
});
