// Real agent loop and durable gateway; scripted model and isolated in-memory
// ledger. Tests transitions and replay, not model tool-selection quality.
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { runCoworkReadLoop } from './agent-loop';
import { createCoworkGateway } from './capabilities';
import { conversationTurn } from './commercial-facts';

test('AXIS 03 corrected user turn reads fresh tool state instead of replaying another run', async () => {
  const leadId='00000000-0000-4000-8000-000000000001';
  const ledger=new Map<string,unknown>();
  const messages=[{id:'in',direction:'inbound' as 'inbound'|'outbound',at:'2026-08-04T11:46:00-04:00',kind:'human' as const,confirmed:true}];
  let reads=0;
  const gateway=createCoworkGateway([{name:'contacted.timeline',version:1,effect:'read',description:'fixture timeline',
    input:z.string().uuid(),output:z.unknown(),execute:async()=>{ reads++; return conversationTurn(messages,
      {coverageComplete:true,observedAt:'2026-08-04T16:00:00Z',now:'2026-08-04T16:00:00Z',maxAgeMs:60000}); }}],{
    authorize:async()=>{},hasGrant:async()=>true,withOperation:async(scope,op,execute)=>{
      const key=JSON.stringify([scope.runId,op.capability,op.input]);
      if(!ledger.has(key)) ledger.set(key,await execute());
      return ledger.get(key);
    },
  });
  const run=async(runId:string,message:string)=>runCoworkReadLoop({runId,message,
    signal:new AbortController().signal,authorize:async()=>{},record:async()=>{},
    execute:(action,input)=>gateway.invoke({userId:leadId,organizationId:leadId,runId},
      {capability:action,input,operationId:`${runId}:timeline`},new AbortController().signal),
    decide:async observations=>observations.length
      ? {action:'answer',query:null,leadId:null,answer:{reply:(observations[0].result as {status:string}).status,document:null}}
      : {action:'contacted.timeline',query:null,leadId,answer:null},
  });
  assert.equal((await run('first','Revisa pendientes')).reply,'our_turn');
  messages.push({id:'out',direction:'outbound',at:'2026-08-04T11:55:00-04:00',kind:'human',confirmed:true});
  assert.equal((await run('correction','a rafael ya le respondi')).reply,'their_turn');
  assert.equal((await run('correction','a rafael ya le respondi')).reply,'their_turn');
  assert.equal(reads,2,'new turn reads once; retry within that turn replays');
});

test('AXIS 10 adelante alone cannot manufacture an observed send target or approval', async () => {
  let writes=0;
  await assert.rejects(runCoworkReadLoop({runId:'run',message:'adelante',signal:new AbortController().signal,
    authorize:async()=>{},execute:async()=>{throw new Error('unexpected read');},record:async()=>{},
    proposeEffect:async()=>{writes++;},decide:async()=>({action:'email.send',query:null,leadId:null,
      draftId:'00000000-0000-4000-8000-000000000001',answer:null}),
  }),/observed/);
  assert.equal(writes,0);
});
