import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkEarlierPage, coworkJoinHistory } from './history-pages';
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const turn = (index: number) => ({ run: { id: id(index), root_run_id: id(1), parent_run_id: index > 1 ? id(index - 1) : null,
  message: `Paso ${index}`, mode: 'approval' as const, status: 'completed' as const, created_at: '2026-10-09T00:00:00Z' }, events: [] });
test('earlier pages preserve the ancestry and merge once as a continuation advances', () => {
  const anchor = turn(9), older = Array.from({length:8},(_,i)=>turn(i+1));
  const page = coworkEarlierPage(anchor, {run:anchor.run,ancestors:older,olderTurnsOmitted:false});
  assert.equal(page.more,false);
  assert.equal(coworkJoinHistory([...page.turns,anchor], [anchor,turn(10)]).length,10);
  assert.equal(coworkJoinHistory([...page.turns,anchor], [turn(10),turn(11)])[0].run.id,id(1));
  assert.throws(()=>coworkEarlierPage(anchor,{run:anchor.run,ancestors:[turn(5),turn(8)],olderTurnsOmitted:true}),/versión/);
  assert.throws(()=>coworkEarlierPage(anchor,{run:anchor.run,ancestors:[{...turn(8),run:{...turn(8).run,root_run_id:id(99)}}],olderTurnsOmitted:true}),/otra conversación/);
  assert.deepEqual(coworkJoinHistory(older,[{...turn(7),run:{...turn(7).run,parent_run_id:id(99)}}]),[{...turn(7),run:{...turn(7).run,parent_run_id:id(99)}}]);
});
