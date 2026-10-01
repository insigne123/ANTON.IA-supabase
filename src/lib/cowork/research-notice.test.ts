import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COWORK_RESEARCH_NOTICE_WAIT_MS, coworkResearchKey, coworkResearchNoticeDue, coworkResearchNoticeMessage, coworkResearchProgressLabel,
  coworkResearchStatusText,
} from './research-notice';

const RUN = '00000000-0000-4000-8000-0000000000a1';
const LEAD = '00000000-0000-4000-8000-0000000000b1';
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 15, minutes)).toISOString();
const job = (id: string, status: string, minute = 0) => ({ id, leadId: LEAD, status, errorCode: null, createdAt: at(minute) });

test('the request key of a Cowork research says which turn started it and for whom', () => {
  assert.deepEqual(coworkResearchKey(`cowork:${RUN}:lead:${LEAD}:research-v1`), { runId: RUN, leadId: LEAD });
  assert.equal(coworkResearchKey(`manual:${RUN}:lead:${LEAD}:research-v1`), null, 'research started outside Cowork is not told to a conversation');
  assert.equal(coworkResearchKey(`cowork:${RUN}:lead:not-a-uuid:research-v1`), null);
  assert.equal(coworkResearchKey(null), null);
});

test('a request is told once everything finished, or after 10 minutes with what finished', () => {
  const now = new Date(Date.parse(at(5)));
  assert.deepEqual(coworkResearchNoticeDue([job('a', 'completed'), job('b', 'partial')], now).map(item => item.id), ['a', 'b']);
  assert.deepEqual(coworkResearchNoticeDue([job('a', 'completed'), job('b', 'running')], now), [], 'one of two still running: wait');
  const later = new Date(Date.parse(at(0)) + COWORK_RESEARCH_NOTICE_WAIT_MS);
  assert.deepEqual(coworkResearchNoticeDue([job('a', 'completed'), job('b', 'running')], later).map(item => item.id), ['a'],
    'after 10 minutes the finished one is told; the other one is told when it finishes');
  assert.deepEqual(coworkResearchNoticeDue([job('a', 'queued'), job('b', 'running')], later), [], 'nothing finished, nothing to tell');
  assert.deepEqual(coworkResearchNoticeDue([job('a', 'failed')], now).map(item => item.id), ['a'], 'a failure is told too');
});

test('the notice names each person, how it ended and what to do with it', () => {
  const message = coworkResearchNoticeMessage([
    { leadId: LEAD, name: 'Rafael Durán', company: 'R&D Montajes', status: 'completed' },
    { leadId: '00000000-0000-4000-8000-0000000000b2', name: 'Susana Cáceres', company: 'MSTI', status: 'partial' },
    { leadId: '00000000-0000-4000-8000-0000000000b3', name: 'Ana Pérez', company: null, status: 'failed', errorCode: 'daily_research_quota_exceeded' },
  ], [{ name: 'Pedro Soto', company: 'Acme' }]);
  assert.match(message, /^Terminaron las investigaciones que pediste en esta conversación:/);
  assert.match(message, new RegExp(`- Rafael Durán \\(R&D Montajes\\), leadId ${LEAD}: lista\\.`));
  assert.match(message, /Susana Cáceres \(MSTI\), leadId [0-9a-f-]+: lista, con vacíos\./);
  assert.match(message, /Ana Pérez, leadId [0-9a-f-]+: no se hizo: se acabó el cupo diario de investigaciones\./);
  assert.match(message, /Sigue en curso: Pedro Soto \(Acme\)\. Te aviso aquí cuando termine\./);
  assert.match(message, /research\.get_existing/);
  assert.match(message, /No inicies investigaciones nuevas/);
  // Only failures: no report to read, say what happened.
  const failed = coworkResearchNoticeMessage([{ leadId: LEAD, name: 'Rafael Durán', company: null, status: 'failed' }]);
  assert.match(failed, /^Terminó la investigación/);
  assert.doesNotMatch(failed, /research\.get_existing/);
  assert.equal(coworkResearchStatusText('insufficient_data'), 'sin datos suficientes para un informe');
});

test('the live card counts what runs and what is ready', () => {
  assert.equal(coworkResearchProgressLabel(['running', 'completed', 'queued']), 'Investigando 2 · 1 lista');
  assert.equal(coworkResearchProgressLabel(['running']), 'Investigando 1');
  assert.equal(coworkResearchProgressLabel(['completed', 'partial']), '2 investigaciones terminadas');
  assert.equal(coworkResearchProgressLabel([]), '');
});
