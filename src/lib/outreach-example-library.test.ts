import assert from 'node:assert/strict';
import test from 'node:test';

import { outreachExampleById, selectOutreachExamples } from './outreach-example-library';

test('initial examples prefer the recipient role', () => {
  const [first] = selectOutreachExamples({ goal: 'initial', role: 'Gerente de Operaciones', count: 1 });
  assert.ok(first);
  assert.ok(first?.roles.includes('operations'));
});

test('executive role resolves to the short no-bullet example', () => {
  const [first] = selectOutreachExamples({ goal: 'initial', role: 'Gerente General', count: 3 });
  assert.ok(first);
  assert.ok(first?.id === 'initial-executive' || first?.roles.includes('any'));
});

test('proof, angle and close goals each return a distinct example', () => {
  const proof = selectOutreachExamples({ goal: 'proof', count: 1 })[0];
  const angle = selectOutreachExamples({ goal: 'angle', count: 1 })[0];
  const close = selectOutreachExamples({ goal: 'close', count: 1 })[0];
  assert.ok(proof && angle && close);
  assert.notEqual(new Set([proof?.id, angle?.id, close?.id]).size, 1);
});

test('examples never present unresolved personalization as real content', () => {
  for (const example of selectOutreachExamples({ goal: 'initial', count: 3 })) {
    assert.match(example.body, /\[Nombre\]/);
    assert.ok(!/\{\{[^}]+\}\}/.test(example.body));
    assert.ok(outreachExampleById(example.id));
  }
});
