import assert from 'node:assert/strict';
import test from 'node:test';

import { EMPTY_FUNNEL, addFunnels, funnelSentence, hasWork, stallCell, teamStall, workStall, type TeamFunnelPerson, type WorkFunnel } from './team-funnel';

const funnel = (saved: number, withEmail: number, researched: number, drafts: number, contacted: number, conversations = 0): WorkFunnel =>
  ({ saved, withEmail, researched, drafts, contacted, conversations });
const team = (people: TeamFunnelPerson[]) => ({ people, total: people.reduce((sum, person) => addFunnels(sum, person.funnel), { ...EMPTY_FUNNEL }) });

test('the work stops at the biggest fall of at least three, after a step with at least three', () => {
  assert.deepEqual(workStall(funnel(20, 15, 2, 2, 1)), { step: 'researched', lost: 13 });
  assert.deepEqual(workStall(funnel(4, 4, 4, 12, 2)), { step: 'contacted', lost: 10 });
  assert.equal(workStall(funnel(2, 2, 1, 1, 0)), null, 'too little to call it a stall');
  assert.equal(workStall(null), null);
});

test('a later step makes up for a fall: calling everyone saved is no stop at the email', () => {
  // Saved 30 and called 30 with five emails: neither the email, the research nor the draft stopped anything.
  assert.equal(workStall(funnel(30, 5, 0, 0, 30, 8)), null);
  // Contacted with no conversation is not the team's stop: the answer depends on the other side.
  assert.equal(workStall(funnel(0, 0, 0, 0, 40, 0)), null);
});

test('the team stops where most people stop; alone, by name; with nobody stopping alone, the team\'s own fall', () => {
  const people = [
    { userId: 'u1', name: 'Ana Rojas', funnel: funnel(10, 9, 9, 9, 2) }, // 7 drafts unsent
    { userId: 'u2', name: 'Leo Soto', funnel: funnel(8, 8, 8, 8, 1) }, // 7 drafts unsent
    { userId: 'u3', name: 'Pía Mella', funnel: funnel(20, 18, 3, 3, 3) }, // 15 with an email not researched
    { userId: 'u4', name: 'Sin uso', funnel: { ...EMPTY_FUNNEL } },
  ];
  assert.deepEqual(teamStall(team(people)), { step: 'contacted', people: 2, of: 3, lost: 14, name: null });
  assert.equal(funnelSentence(team(people), false), '2 de 3 personas se frenan al enviar: tienen borradores, pero no los envían.');
  assert.equal(funnelSentence(team([people[2], people[3]]), false), 'Pía Mella se frena al investigar: 15 con correo sin investigar.');
  // Five people with two drafts unsent each: nobody stops alone, the team leaves ten.
  const small = Array.from({ length: 5 }, (_, index) => ({ userId: `p${index}`, funnel: funnel(2, 2, 2, 2, 0) }));
  assert.equal(funnelSentence(team(small), false), 'El equipo se frena al enviar: 10 borradores sin enviar.');
});

test('one person, a period where nothing stops and one with no work read as such', () => {
  const ana = team([{ userId: 'u1', name: 'Ana Rojas', funnel: funnel(12, 4, 4, 4, 4) }]);
  assert.equal(funnelSentence(ana, true), 'Se frena al conseguir el correo: 8 guardados sin correo.');
  assert.equal(funnelSentence(team([{ userId: 'u1', funnel: funnel(3, 3, 3, 3, 3, 1) }]), false), 'Ningún paso se queda atrás en este período.');
  assert.equal(funnelSentence(team([]), false), 'En este período nadie guardó, escribió ni llamó a un contacto.');
  assert.equal(funnelSentence(team([{ userId: 'u1', funnel: { ...EMPTY_FUNNEL } }]), true), 'En este período no guardó, escribió ni llamó a ningún contacto.');
});

test('each row says where that person stops, that nothing stops, or that they did nothing', () => {
  assert.equal(stallCell(funnel(10, 9, 9, 9, 2)), 'Al enviar (7)');
  assert.equal(stallCell(funnel(1, 1, 0, 0, 1)), '—');
  assert.equal(stallCell({ ...EMPTY_FUNNEL }), 'Sin actividad');
  assert.equal(hasWork({ ...EMPTY_FUNNEL, conversations: 1 }), true);
});
