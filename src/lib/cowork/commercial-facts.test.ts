import test from 'node:test';
import assert from 'node:assert/strict';
import { applicableCommercialRules, commercialRate, exactCompanyMatch, titleContainsTerm,
  conversationTurn, observedActionCounts } from './commercial-facts';

test('AXIS P6/P7/P9 exact identity and title boundaries preserve real prospects', () => {
  assert.equal(exactCompanyMatch('GRUPOEXPRO', 'Grúpo Expro'), true);
  assert.equal(exactCompanyMatch('Besalco Construcciones', 'UCC'), false);
  assert.equal(exactCompanyMatch('', ''), false);
  assert.equal(titleContainsTerm('Gerente de servicios transitorios', 'CIO'), false);
  assert.equal(titleContainsTerm('CIO / Tecnología', 'CIO'), true);
  assert.equal(titleContainsTerm('Director adjunto', 'director'), true);
});
test('AXIS 07 contextual sales rule never becomes a global exclusion or overrides suppression', () => {
  const rules = [{id:'assistant',kind:'commercial' as const,channels:['email'],goals:['decision_makers']},
    {id:'privacy',kind:'suppression' as const,channels:['email']}];
  assert.deepEqual(applicableCommercialRules(rules,'linkedin','referrals').map(r => r.id),['privacy']);
  assert.equal(applicableCommercialRules(rules,'email','decision_makers').length,2);
});
test('AXIS 05 metrics retain denominator units and unknown is not zero', () => {
  assert.deepEqual(commercialRate(1,40,'emails'),{numerator:1,denominator:40,denominatorUnit:'emails',percent:2.5});
  assert.equal(commercialRate(0,0,'people').percent,null);
  assert.throws(() => commercialRate(2,1,'people'));
});
test('AXIS 03 fresh outbound corrects stale pending summary; autoresponses cannot change turn', () => {
  const messages = [
    {id:'in',direction:'inbound' as const,at:'2026-08-04T11:46:00-04:00',kind:'human' as const,confirmed:true},
    {id:'out',direction:'outbound' as const,at:'2026-08-04T11:55:00-04:00',kind:'human' as const,confirmed:true},
    {id:'ooo',direction:'inbound' as const,at:'2026-08-04T11:56:00-04:00',kind:'auto_reply' as const,confirmed:true},
  ];
  const options = {coverageComplete:true,observedAt:'2026-08-04T16:00:00Z',now:'2026-08-04T16:00:00Z',maxAgeMs:60000};
  assert.equal(conversationTurn(messages,options).status,'their_turn');
  assert.equal(conversationTurn(messages,{...options,coverageComplete:false}).status,'unknown');
  assert.equal(conversationTurn(messages,{...options,now:'2026-08-05T16:00:00Z'}).status,'unknown');
  assert.equal(conversationTurn(messages.map(m=>m.id==='out'?{...m,confirmed:false}:m),options).status,'unknown');
});
test('AXIS 04/10 clicks never count as confirmation and duplicate events cannot inflate totals', () => {
  assert.deepEqual(observedActionCounts([{id:'a',status:'confirmed'},{id:'b',status:'held'},{id:'c',status:'uncertain'}]),
    {confirmed:1,failed:0,held:1,uncertain:1});
  assert.throws(()=>observedActionCounts([{id:'a',status:'confirmed'},{id:'a',status:'confirmed'}]));
});
