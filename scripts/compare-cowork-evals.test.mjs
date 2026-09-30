import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('comparison pairs repeated case attempts with the judgement of their own evaluation file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cowork-eval-pairs-'));
  try {
    const files = [join(directory, 'first.json'), join(directory, 'second.json')];
    files.forEach((file, index) => {
      writeFileSync(file, JSON.stringify({ outcomes: [{ id: 'axis-a2', attempt: 1, seconds: index + 1,
        passed: index === 0, checks: [{ passed: index === 0 }] }], summary: { calls: 1 }, usage: [] }));
      writeFileSync(file.replace(/\.json$/, '-judge.json'), JSON.stringify({ rows: [{ id: 'axis-a2', attempt: 1,
        op: 'A2', reference: { veredicto: index === 0 ? 'supera' : 'por_debajo' },
        judgement: { veredicto: index === 0 ? 'buena' : 'mala', scores: { comprension: 4, veracidad: 4, utilidad: 4, claridad: 4, friccion: 4 } } }] }));
    });
    const result = spawnSync(process.execPath, ['scripts/compare-cowork-evals.mjs', `group=${files.join(',')}`, '--axis'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /corridas ok 1\/2/);
    assert.match(result.stdout, /frente a la IA anterior: supera, por_debajo/);
    assert.match(result.stdout, /juez: buena, mala/);
    assert.doesNotMatch(result.stdout, /por_debajo, por_debajo|juez: mala, mala/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
