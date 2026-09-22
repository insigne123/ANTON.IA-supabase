import test from 'node:test';
import assert from 'node:assert/strict';
import { replayAxisCase, replayIds, AXIS_LEAD, AXIS_SECOND_LEAD } from './fixtures/cowork-axis-replay';
import { coworkDecisionSchema } from '../src/lib/cowork/agent-loop';

test('AXIS replay traverses actual loop, isolated turns and refreshed tools (scripted model)', async () => {
  for (const id of replayIds) {
    let corrections = 0;
    const result = await replayAxisCase(id, async context => {
      const observations = context.observations as Array<{ action: string; result: { items?: Array<{ sent_at: string }>; contacted?: Array<{ sent_at: string }> } }>;
      const history = context.history as { turns: Array<{ observations: unknown[] }> };
      assert.equal(context.clock.source, 'server');
      assert.match(context.clock.serverNow, /^2026-08/);
      if (!observations.length) {
        if (history.turns.length) { corrections++; assert.ok(history.turns[0].observations.length); }
        return coworkDecisionSchema.parse({ action: 'contacted.search', query: '', leadId: null, answer: null });
      }
      if (observations.length === 1) return coworkDecisionSchema.parse({ action: 'contacted.timeline', query: null, leadId: AXIS_LEAD, answer: null });
      if (id === '08-reuniones' && observations.length === 2) return coworkDecisionSchema.parse({ action: 'contacted.timeline', query: null, leadId: AXIS_SECOND_LEAD, answer: null });
      if (id === '03-ya-respondi' && history.turns.length) {
        assert.equal(observations[1].result.contacted?.[0].sent_at, '2026-08-04T15:55:00Z');
      }
      return coworkDecisionSchema.parse({ action: 'answer', query: null, leadId: null,
        answer: { reply: 'Solicitud entrante: confirmar fecha. Rafael: en los registros de la app consta respuesta a las 15:55, cobertura sin comprobar. Han pasado 19 días.', document: null } });
    });
    assert.equal(result.passed, true);
    assert.equal(corrections, id === '03-ya-respondi' || id === '12-reloj' ? 1 : 0);
  }
});

test('replay rejects unsupported writes and invented targets', async () => {
  await assert.rejects(replayAxisCase('01-hoy', async () => coworkDecisionSchema.parse({
    action: 'email.send', draftId: AXIS_LEAD, query: null, leadId: null, answer: null,
  })), /Effect proposals unavailable/);
  await assert.rejects(replayAxisCase('01-hoy', async () => coworkDecisionSchema.parse({
    action: 'contacted.timeline', query: null, leadId: '00000000-0000-4000-8000-000000000009', answer: null,
  })), /Unobserved fixture target/);
});

test('plausible answer without consulting tools fails acceptance', async () => {
  const result = await replayAxisCase('12-reloj', async () => coworkDecisionSchema.parse({
    action: 'answer', query: null, leadId: null, answer: { reply: 'Han pasado 19 días.', document: null },
  }));
  assert.equal(result.passed, false);
  assert.ok(result.results.every(r => !r.checks.freshRead && !r.checks.timelineForClock));
});
