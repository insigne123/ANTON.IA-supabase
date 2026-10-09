import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkPendingProposalMemory, type CoworkThreadMemory } from './thread-memory';
test('a pending operation preserves offer changes but cannot mark people or decisions as completed', () => {
  const old: CoworkThreadMemory = { offer:'Servicio A',audience:'RR. HH.',people:[],decisions:['Tono cercano'],pending:[] };
  const proposed: CoworkThreadMemory = { ...old,offer:'Servicio B',people:[{leadId:null,name:'Ana',company:'Demo',status:'correo enviado'}],decisions:['Campaña activada'] };
  const pending=coworkPendingProposalMemory(proposed,old);
  assert.equal(pending.offer,'Servicio B');assert.deepEqual(pending.people,[]);assert.deepEqual(pending.decisions,['Tono cercano']);
  assert.match(pending.pending[0],/esperando/);assert.equal(proposed.people.length,1);
});
