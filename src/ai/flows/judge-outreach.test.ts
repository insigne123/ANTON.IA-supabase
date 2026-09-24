import assert from 'node:assert/strict';
import test from 'node:test';

import { judgeVerdict, type OutreachJudgeScore } from './judge-outreach';

function score(overrides: Partial<OutreachJudgeScore>): OutreachJudgeScore {
  return {
    suena_humano: 5, especificidad: 5, un_solo_pedido: 5, tono_y_tratamiento: 5,
    veracidad: 5, frase_mas_artificial: '', hechos_sin_respaldo: [], motivo: '',
    ...overrides,
  };
}

test('judge verdict is computed in code: truth issues always escalate', () => {
  assert.equal(judgeVerdict(score({})), 'enviar');
  assert.equal(judgeVerdict(score({ suena_humano: 3 })), 'corregir');
  assert.equal(judgeVerdict(score({ veracidad: 4 })), 'revision_humana');
  assert.equal(judgeVerdict(score({ hechos_sin_respaldo: ['cifra sin fuente'] })), 'revision_humana');
});
