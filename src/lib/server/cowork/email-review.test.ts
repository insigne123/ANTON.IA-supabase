import test from 'node:test';
import assert from 'node:assert/strict';
import type { askJev } from '@/lib/server/jev';
import { coworkEmailReviewMode, coworkEmailReviewSeller, reviewCoworkEmail } from './email-review';

const input = { seller: { name: 'Camila', company: 'Contafácil', offer: 'Contabilidad en línea para pymes' },
  conversation: { with: 'Ana Ruiz', theirLastMessage: '¿Cuánto cuesta?' }, draft: { subject: 'Re: hola', body: 'Cuesta $4.990 por persona.' } };
const answered = (contradicts: number, invents: number, ignores: number): typeof askJev => async () => ({
  status: 'ok', model: 'jev-latest', durationMs: 120, inputTokens: 500, costUsd: 0.00002,
  answers: { contradicts_thread: { type: 'noul', noul: contradicts }, invents_commitment: { type: 'noul', noul: invents }, ignores_question: { type: 'noul', noul: ignores } } });

test('the mode is off unless it is asked for, and a typo never turns it on', () => {
  assert.equal(coworkEmailReviewMode({}), 'off');
  assert.equal(coworkEmailReviewMode({ COWORK_EMAIL_REVIEW: ' ON ' }), 'on');
  assert.equal(coworkEmailReviewMode({ COWORK_EMAIL_REVIEW: 'shadow' }), 'shadow');
  assert.equal(coworkEmailReviewMode({ COWORK_EMAIL_REVIEW: 'true' }), 'off');
});

test('off asks nobody; an empty draft is not reviewed', async () => {
  let asked = 0;
  const ask = (async () => { asked += 1; throw new Error('must not be called'); }) as unknown as typeof askJev;
  assert.equal(await reviewCoworkEmail(input, { mode: 'off', ask }), null);
  assert.equal(await reviewCoworkEmail({ ...input, draft: { subject: null, body: '  ' } }, { mode: 'on', ask }), null);
  assert.equal(asked, 0);
});

test('on shows what Jev found; nothing found is a checked review with no issues', async () => {
  const lines: string[] = [];
  const found = await reviewCoworkEmail(input, { mode: 'on', ask: answered(0.1, 0.93, 0.05), log: line => lines.push(line) });
  assert.equal(found?.checked, true);
  assert.deepEqual(found?.issues.map(item => item.id), ['invents_commitment']);
  const clean = await reviewCoworkEmail(input, { mode: 'on', ask: answered(0.1, 0.2, 0.05), log: () => undefined });
  assert.deepEqual(clean, { checked: true, issues: [] });
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /4\.990|Ana Ruiz|Contafácil|cuesta/i, 'the email and who it is for never reach the log');
  assert.match(lines[0], /"invents_commitment":0\.93/);
});

test('a first email (no conversation) is asked only about the offer', async () => {
  let questions: string[] = [];
  await reviewCoworkEmail({ ...input, conversation: null }, { mode: 'on', log: () => undefined,
    ask: (async (request: { questions: Record<string, unknown> }) => { questions = Object.keys(request.questions); return { status: 'disabled', answers: null, model: null, durationMs: 0, inputTokens: 0, costUsd: 0 }; }) as unknown as typeof askJev });
  assert.deepEqual(questions, ['invents_commitment']);
});

test('shadow only measures: nothing is returned for the card', async () => {
  const lines: string[] = [];
  assert.equal(await reviewCoworkEmail(input, { mode: 'shadow', ask: answered(0.99, 0.99, 0.99), log: line => lines.push(line) }), null);
  assert.equal(lines.length, 1);
});

test('when Jev does not answer the review fails open: not checked, nothing found', async () => {
  for (const status of ['timeout', 'http_error', 'invalid', 'disabled'] as const) {
    const ask = (async () => ({ status, answers: null, model: null, durationMs: 1, inputTokens: 0, costUsd: 0 })) as typeof askJev;
    assert.deepEqual(await reviewCoworkEmail(input, { mode: 'on', ask, log: () => undefined }), { checked: false, issues: [] });
  }
});

test('the seller side carries only name, company, offer, services and proof points', () => {
  const seller = coworkEmailReviewSeller({ fullName: 'Camila', jobTitle: 'Gerenta', companyName: 'Contafácil', companyDomain: 'contafacil.cl', offer: 'Contabilidad', offerSource: 'profile',
    services: ['Facturas'], proofPoints: ['Cliente desde 2020'], memories: ['no llamar los lunes'] });
  assert.deepEqual(seller, { name: 'Camila', company: 'Contafácil', offer: 'Contabilidad', services: ['Facturas'], proofPoints: ['Cliente desde 2020'] });
  assert.deepEqual(coworkEmailReviewSeller(null), { name: null, company: null, offer: null });
});
