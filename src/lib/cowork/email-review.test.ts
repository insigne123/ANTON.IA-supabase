import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COWORK_EMAIL_REVIEW_THRESHOLDS, coworkEmailReviewIssues, coworkEmailReviewProbabilities, coworkEmailReviewQuestions, coworkEmailReviewState,
} from './email-review';

const answers = (contradicts: number, invents: number, ignores: number) => ({
  contradicts_thread: { type: 'noul' as const, noul: contradicts }, invents_commitment: { type: 'noul' as const, noul: invents }, ignores_question: { type: 'noul' as const, noul: ignores },
});

test('a reply to someone is asked three questions, a first email only the one about the offer', () => {
  assert.deepEqual(Object.keys(coworkEmailReviewQuestions(true)), ['contradicts_thread', 'invents_commitment', 'ignores_question']);
  assert.deepEqual(Object.keys(coworkEmailReviewQuestions(false)), ['invents_commitment']);
});

test('the state carries the seller, what they wrote and the exact draft, with the draft clipped', () => {
  const state = coworkEmailReviewState({ seller: { name: 'Camila', company: 'Contafácil', offer: 'Contabilidad en línea' },
    conversation: { with: 'Ana', theirLastMessage: 'Me interesa' }, draft: { subject: 'Re: hola', body: 'x'.repeat(9_000) } });
  assert.equal(state.conversation?.theirLastMessage, 'Me interesa');
  assert.equal(state.draftReply.body.length, 4_000);
  assert.equal('conversation' in coworkEmailReviewState({ seller: { name: null, company: null, offer: null }, draft: { subject: null, body: 'hola' } }), false);
});

test('only what reaches its threshold is found, each with its line for the card', () => {
  assert.deepEqual(coworkEmailReviewIssues(answers(0.2, 0.3, 0.1)), []);
  const found = coworkEmailReviewIssues(answers(0.95, 0.79, 0.99));
  assert.deepEqual(found.map(item => item.id), ['contradicts_thread'], 'invents is under its threshold and ignores has none: it is measured, never shown');
  assert.match(found[0].text, /contradecir/);
  const own = { contradicts_thread: 0.9, invents_commitment: 0.7 };
  assert.equal(coworkEmailReviewIssues(answers(0.85, 0, 0), own).length, 0, 'each question has its own threshold');
  assert.equal(coworkEmailReviewIssues(answers(0, 0.7, 0), own).length, 1, 'at the threshold counts');
  assert.ok(Object.values(COWORK_EMAIL_REVIEW_THRESHOLDS).every(value => value > 0.5 && value < 1));
  assert.equal(COWORK_EMAIL_REVIEW_THRESHOLDS.ignores_question, undefined);
  assert.equal(coworkEmailReviewIssues(answers(0, 0, 1), { ...own, ignores_question: 0.8 }).length, 1, 'a threshold given for it would show it');
});

test('no answers find nothing, and a missing answer is null, never zero', () => {
  assert.deepEqual(coworkEmailReviewIssues(null), []);
  assert.deepEqual(coworkEmailReviewProbabilities({ invents_commitment: { type: 'noul', noul: 0.4 } }),
    { contradicts_thread: null, invents_commitment: 0.4, ignores_question: null });
});
