import test from 'node:test';import assert from 'node:assert/strict';import {homeScope,homeDayStart} from './scope';
test('Chile day handles normal, winter, spring missing midnight and autumn repeated hour',()=>{
  for(const [day,start,length] of [['2026-10-10','2026-10-10T03:00:00.000Z',24],['2026-07-10','2026-07-10T04:00:00.000Z',24],['2026-09-06','2026-09-06T04:00:00.000Z',23],['2026-04-04','2026-04-04T03:00:00.000Z',25]] as const){
    const scope=homeScope('u','o',new Date(day+'T12:00:00Z'));assert.equal(scope.from,start);assert.equal((Date.parse(scope.to)-Date.parse(scope.from))/3600000,length);
  }
  assert.equal(homeScope('u','o',new Date('2026-10-10T02:59:59Z')).dayKey,'2026-10-09');assert.equal(homeDayStart('2026-10-10').toISOString(),'2026-10-10T03:00:00.000Z');
});
