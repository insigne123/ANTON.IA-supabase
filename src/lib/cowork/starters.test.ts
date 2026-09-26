import test from 'node:test';
import assert from 'node:assert/strict';
import { COWORK_STARTERS, coworkStarter } from './starters';

test('home starters are few, short and ready to send, with at most one placeholder to fill', () => {
  assert.ok(COWORK_STARTERS.length >= 4 && COWORK_STARTERS.length <= 6, 'one row or two on the home, never a wall of buttons');
  assert.equal(new Set(COWORK_STARTERS.map(item => item.id)).size, COWORK_STARTERS.length);
  for (const item of COWORK_STARTERS) {
    assert.ok(item.title.length <= 28, `${item.id}: the title fits in one pill`);
    assert.ok(item.prompt.length <= 200, `${item.id}: the prompt reads at a glance in the composer`);
    // The home selects the first [placeholder] for the person to replace; a second one would stay unfilled.
    assert.ok((item.prompt.match(/\[[^\]]+\]/g) || []).length <= 1, `${item.id}: at most one placeholder`);
  }
  assert.match(coworkStarter('mejorar').prompt, /\[pega aquí tu correo\]$/);
  assert.throws(() => coworkStarter('no-existe'), /Unknown Cowork starter/);
});
