import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoworkEvaluationBudget } from './cowork-evaluation-budget';

test('shared ledger preserves incomplete spend and refuses another model or over-budget admission', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-budget-'));
  try {
    const file = join(dir, 'ledger.json');
    const budget = new CoworkEvaluationBudget(file, 0.01);
    const id = budget.reserve({ model: 'gpt-6-luna', prompt: 'hola', maxOutputTokens: 1000 });
    budget.settle(id);
    assert.equal(new CoworkEvaluationBudget(file, 0.01).summary().incompleteCalls, 1);
    assert.throws(() => budget.reserve({ model: 'gpt-6.1-sol', prompt: '', maxOutputTokens: 1 }));
    assert.throws(() => budget.reserve({ model: 'gpt-6-luna', prompt: '', maxOutputTokens: 30000 }));
    assert.throws(() => new CoworkEvaluationBudget(file, 10));
    const known = budget.reserve({ model: 'gpt-6-luna', prompt: '', maxOutputTokens: 1000 });
    budget.settle(known, { modelName: 'gpt-6-luna', durationMs: 2, usage: { prompt_tokens: 10, completion_tokens: 20 } });
    assert.ok(budget.summary().knownUsd > 0);
    assert.ok(budget.summary().pendingUsd > 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
