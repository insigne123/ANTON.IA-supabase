import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_JEV_TURN_TIMEOUT_MS, coworkJevShadow, coworkReviewEngine } from './review-engine';

test('without a value the review follows the judge flag, so nothing changes for whoever never set the engine', () => {
  assert.equal(coworkReviewEngine({}), 'off');
  assert.equal(coworkReviewEngine({ COWORK_JUDGE_ENABLED: 'false' }), 'off');
  assert.equal(coworkReviewEngine({ COWORK_JUDGE_ENABLED: 'true' }), 'llm');
  assert.equal(coworkReviewEngine({ COWORK_REVIEW_ENGINE: '', COWORK_JUDGE_ENABLED: 'true' }), 'llm');
});

test('the engine says who reviews, whatever the judge flag says', () => {
  for (const engine of ['llm', 'jev', 'jev-llm', 'off'] as const) {
    assert.equal(coworkReviewEngine({ COWORK_REVIEW_ENGINE: engine }), engine);
    assert.equal(coworkReviewEngine({ COWORK_REVIEW_ENGINE: engine, COWORK_JUDGE_ENABLED: 'true' }), engine);
    assert.equal(coworkReviewEngine({ COWORK_REVIEW_ENGINE: engine, COWORK_JUDGE_ENABLED: 'false' }), engine);
  }
  assert.equal(coworkReviewEngine({ COWORK_REVIEW_ENGINE: ' Jev-LLM ' }), 'jev-llm');
});

test('a value that is not an engine is no value: a typo never turns the review on', () => {
  assert.equal(coworkReviewEngine({ COWORK_REVIEW_ENGINE: 'jef' }), 'off');
  assert.equal(coworkReviewEngine({ COWORK_REVIEW_ENGINE: 'true' }), 'off');
  assert.equal(coworkReviewEngine({ COWORK_REVIEW_ENGINE: 'jef', COWORK_JUDGE_ENABLED: 'true' }), 'llm');
});

test('the shadow is explicit and Jev gets a short wait inside a turn', () => {
  assert.equal(coworkJevShadow({}), false);
  assert.equal(coworkJevShadow({ COWORK_JEV_SHADOW: 'false' }), false);
  assert.equal(coworkJevShadow({ COWORK_JEV_SHADOW: 'true' }), true);
  assert.ok(COWORK_JEV_TURN_TIMEOUT_MS >= 1_000 && COWORK_JEV_TURN_TIMEOUT_MS < 3_000);
});
