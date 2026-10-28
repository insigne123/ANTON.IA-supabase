import assert from 'node:assert/strict';
import test from 'node:test';

import {
  coworkPrepareBatchLabel, coworkPrepareBatchPeople, coworkPrepareBatchSummary, coworkPrepareCost, coworkPrepareCredits, coworkPrepareOverBudget,
  coworkPrepareStatus, coworkPrepareSteps, hashCoworkPrepareBatch, planCoworkPrepareBatch, type CoworkPrepareCandidate, type CoworkPrepareState } from './prepare-batch';

const LEAD = (n: number) => `00000000-0000-4000-8000-0000000000a${n}`;
const fresh = { saved: false, emailChecked: false, researched: false };

test('the people of a proposal: each once, by search result or saved contact, up to 50 whatever the goal', () => {
  assert.deepEqual(coworkPrepareBatchPeople({ goal: 'research', people: [{ providerId: 'apollo:r1' }, { leadId: LEAD(1) }] }),
    { goal: 'research', people: [{ providerId: 'apollo:r1' }, { leadId: LEAD(1) }] });
  assert.throws(() => coworkPrepareBatchPeople({ goal: 'save', people: [{ providerId: 'apollo:r1' }, { providerId: 'apollo:r1' }] }), /repetidas/);
  assert.throws(() => coworkPrepareBatchPeople({ goal: 'save', people: [{ providerId: 'apollo:r1', leadId: LEAD(1) }] }), /una de las dos/);
  assert.throws(() => coworkPrepareBatchPeople({ goal: 'save', people: [{}] }), /una de las dos/);
  const people = (count: number) => Array.from({ length: count }, (_, n) => ({ providerId: `apollo:p${n}` }));
  for (const goal of ['save', 'email', 'research', 'linkedin']) {
    assert.equal(coworkPrepareBatchPeople({ goal, people: people(50) }).people.length, 50, goal);
    assert.throws(() => coworkPrepareBatchPeople({ goal, people: people(51) }), /hasta 50 personas: propón el resto en otro lote/, goal);
  }
  assert.throws(() => coworkPrepareBatchPeople({ goal: 'everything', people: [{ leadId: LEAD(1) }] }));
});

test('a batch spends one daily credit per lookup and per research, and never more than the person has left today', () => {
  assert.equal(coworkPrepareCredits({ lookups: 10, research: 10 }), 20);
  assert.equal(coworkPrepareOverBudget(20, { left: 20, limit: 50 }), null);
  assert.match(coworkPrepareOverBudget(20, { left: 12, limit: 50 }) ?? '', /usa 20 créditos y hoy te quedan 12 de 50.*hasta 12/);
  assert.match(coworkPrepareOverBudget(1, { left: 0, limit: 50 }) ?? '', /Hoy ya usaste tus 50 créditos del día; se renuevan mañana/);
  assert.match(coworkPrepareOverBudget(1, { left: 0, limit: 0 }) ?? '', /Tu cuenta no tiene créditos/);
  assert.equal(coworkPrepareOverBudget(0, { left: 0, limit: 0 }), null, 'saving costs nothing');
});

test('each person gets only what is missing, in order: save, look up the email, research', () => {
  assert.deepEqual(coworkPrepareSteps('research', fresh), ['save', 'enrich', 'research']);
  assert.deepEqual(coworkPrepareSteps('research', { saved: true, emailChecked: true, researched: false }), ['research']);
  assert.deepEqual(coworkPrepareSteps('email', { saved: true, emailChecked: false, researched: false }), ['enrich']);
  assert.deepEqual(coworkPrepareSteps('save', { saved: false, emailChecked: false, researched: true }), ['save'], 'saving never looks up or researches');
  assert.deepEqual(coworkPrepareSteps('email', { saved: true, emailChecked: true, researched: false }), []);
});

test('the plan keeps who still needs something and sets aside, with why, who is already done', () => {
  const candidates: CoworkPrepareCandidate[] = [
    { id: LEAD(1), providerId: 'apollo:r1', name: 'Rafael Du***n', company: 'R&D Montajes', title: 'Jefe', state: fresh,
      contact: { linkedinUrl: null, companyWebsite: 'https://rdmontajes.cl' } },
    { id: LEAD(2), name: 'Susana Cáceres', company: 'MSTI', title: 'RR. HH.', state: { saved: true, emailChecked: true, researched: false } },
    { id: LEAD(3), name: 'Ana Pérez', company: 'Acme', title: 'Gerente', state: { saved: true, emailChecked: true, researched: true } },
  ];
  const plan = planCoworkPrepareBatch('research', candidates);
  assert.deepEqual(plan.items.map(item => [item.id, item.steps, item.done]), [
    [LEAD(1), ['save', 'enrich', 'research'], []],
    [LEAD(2), ['research'], ['save', 'enrich']],
  ]);
  assert.equal(plan.items[0].providerId, 'apollo:r1');
  assert.deepEqual(plan.items[0].contact, { linkedinUrl: null, companyWebsite: 'https://rdmontajes.cl' }, 'what saving needs travels with the person');
  assert.equal(plan.items[1].providerId, undefined, 'a saved contact goes by its id');
  assert.deepEqual(plan.ready.map(person => person.id), [LEAD(3)]);
  assert.match(plan.ready[0].reason, /investigación hecha o en curso/);
  assert.deepEqual(coworkPrepareCost(plan.items), { saves: 1, lookups: 1, research: 2 });
});

test('the label says what will happen and the hash pins who and which steps', () => {
  const save = [{ id: LEAD(1), providerId: 'apollo:r1', steps: ['save' as const] }, { id: LEAD(2), providerId: 'apollo:r2', steps: ['save' as const] }];
  assert.equal(coworkPrepareBatchLabel(save), 'Guardar a 2 personas');
  assert.equal(coworkPrepareBatchLabel([{ steps: ['enrich'] }]), 'Buscar el correo de 1 persona');
  assert.equal(coworkPrepareBatchLabel([{ steps: ['research'] }, { steps: ['research'] }]), 'Investigar a 2 personas');
  assert.equal(coworkPrepareBatchLabel([{ steps: ['save', 'enrich', 'research'] }, { steps: ['research'] }]),
    'Preparar a 2 personas: guardar, buscar su correo e investigar');
  assert.equal(coworkPrepareBatchLabel([{ steps: ['save', 'enrich'] }]), 'Preparar a 1 persona: guardar y buscar su correo');
  const hash = hashCoworkPrepareBatch('run-1', save);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hashCoworkPrepareBatch('run-1', save.map(item => ({ ...item }))), hash, 'names do not change the hash');
  assert.notEqual(hashCoworkPrepareBatch('run-1', [save[0]]), hash);
  assert.notEqual(hashCoworkPrepareBatch('run-2', save), hash);
  assert.notEqual(hashCoworkPrepareBatch('run-1', [{ ...save[0], steps: ['save', 'enrich'] }, save[1]]), hash);
});

test('the result reads person by person, with what was missing and why', () => {
  assert.equal(coworkPrepareStatus([{ step: 'save', status: 'done' }, { step: 'enrich', status: 'reused' }]), 'ready');
  assert.equal(coworkPrepareStatus([{ step: 'save', status: 'done' }, { step: 'enrich', status: 'failed' }]), 'partial');
  assert.equal(coworkPrepareStatus([{ step: 'save', status: 'failed' }]), 'failed');
  const summary = coworkPrepareBatchSummary([
    { id: LEAD(1), name: 'Rafael Durán', company: 'R&D Montajes', status: 'ready', email: 'rduran@rdmontajes.cl',
      steps: [{ step: 'save', status: 'done' }, { step: 'enrich', status: 'done' }, { step: 'research', status: 'done' }] },
    { id: LEAD(2), name: 'Susana Cáceres', company: 'MSTI', status: 'ready',
      steps: [{ step: 'save', status: 'done' }, { step: 'enrich', status: 'done', detail: 'El proveedor no encontró su correo.' }, { step: 'research', status: 'done' }] },
    { id: LEAD(3), name: 'Ana Pérez', company: 'Acme', status: 'removed', steps: [] },
  ]);
  assert.equal(summary, 'Listo con 2 de 2 personas: 2 quedaron guardadas, 1 de 2 con correo y 2 investigaciones en curso o listas.'
    + ' Susana Cáceres: El proveedor no encontró su correo. Quitaste a 1 persona de la lista.');
});

test('a LinkedIn lookup runs for whoever lacks a profile, also with an email, and costs a credit like an email lookup', () => {
  const state = (over: Partial<CoworkPrepareState> = {}): CoworkPrepareState => ({ saved: true, emailChecked: true, researched: false, ...over });
  assert.deepEqual(coworkPrepareSteps('linkedin', state()), ['linkedin']);
  assert.deepEqual(coworkPrepareSteps('linkedin', state({ linkedinChecked: true })), []);
  assert.deepEqual(coworkPrepareSteps('linkedin', state({ saved: false, emailChecked: false })), ['save', 'linkedin']);
  // An email lookup never asks for the profile, and a LinkedIn lookup never for the email.
  assert.deepEqual(coworkPrepareSteps('email', state({ emailChecked: false })), ['enrich']);
  const items = [{ steps: ['linkedin' as const] }, { steps: ['linkedin' as const] }];
  assert.deepEqual(coworkPrepareCost(items), { saves: 0, lookups: 2, research: 0, profiles: 2 });
  assert.equal(coworkPrepareBatchLabel(items), 'Buscar el perfil de LinkedIn de 2 personas');
  assert.equal(coworkPrepareBatchLabel([{ steps: ['save', 'linkedin'] }]), 'Preparar a 1 persona: guardar y buscar su perfil de LinkedIn');
  const plan = planCoworkPrepareBatch('linkedin', [
    { id: 'a', name: 'Ana', company: 'X', title: null, state: state() },
    { id: 'b', name: 'Beto', company: 'Y', title: null, state: state({ linkedinChecked: true }) },
  ]);
  assert.deepEqual(plan.items.map(item => item.id), ['a']);
  assert.match(plan.ready[0].reason, /LinkedIn/);
  const summary = coworkPrepareBatchSummary([
    { id: 'a', name: 'Ana', company: 'X', status: 'ready', steps: [{ step: 'linkedin', status: 'done' }], linkedinUrl: 'https://www.linkedin.com/in/ana' },
    { id: 'c', name: 'Carla', company: 'Z', status: 'ready', steps: [{ step: 'linkedin', status: 'done', detail: 'El proveedor no encontró su perfil de LinkedIn.' }] },
  ]);
  assert.match(summary, /1 de 2 con perfil de LinkedIn/);
  assert.match(summary, /Carla: El proveedor no encontró su perfil de LinkedIn/);
});
