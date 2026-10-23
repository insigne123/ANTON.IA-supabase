import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_GUIDE, COWORK_GUIDE_WEB, coworkGuide, coworkGuideForModel } from './capabilities-guide';
import { helpSectionById } from '@/lib/help/manual';

test('the guide covers the seven groups in order, each with examples and its help page', () => {
  assert.deepEqual(COWORK_GUIDE.map(group => group.id), ['buscar', 'contactos', 'investigar', 'correos', 'linkedin', 'seguimiento', 'informes']);
  const messages = new Set<string>();
  for (const group of COWORK_GUIDE) {
    assert.ok(group.summary.length > 40, `${group.id} explains what it does`);
    assert.ok(group.examples.length >= 1 && group.examples.length <= 2, `${group.id} brings one or two examples`);
    assert.ok(helpSectionById(group.helpSection), `${group.id} points to an existing help page`);
    for (const example of group.examples) {
      assert.ok(example.label.length <= 40, `«${example.label}» fits on a button`);
      assert.ok(!/\[|\]/.test(example.message), 'an example is ready to send, with no blanks to fill');
      assert.ok(!messages.has(example.message), 'no example repeats');
      messages.add(example.message);
    }
  }
});

test('the model reads the same guide, one line per group', () => {
  const text = coworkGuideForModel();
  for (const group of COWORK_GUIDE) assert.ok(text.includes(group.title) && text.includes(group.examples[0].label));
  assert.equal(text.split(' · ').length, COWORK_GUIDE.length);
});

test('the web group appears only for whoever has the web, right after «Investigar»', () => {
  assert.equal(coworkGuide(), COWORK_GUIDE, 'without the web the guide is the one everybody had');
  assert.equal(coworkGuide({ web: false }), COWORK_GUIDE);
  const withWeb = coworkGuide({ web: true });
  assert.deepEqual(withWeb.map(group => group.id), ['buscar', 'contactos', 'investigar', 'web', 'correos', 'linkedin', 'seguimiento', 'informes']);
  assert.equal(withWeb.length % 2, 0, 'the two-column grid stays even');
  assert.ok(helpSectionById(COWORK_GUIDE_WEB.helpSection), 'it points to an existing help page');
  assert.ok(COWORK_GUIDE_WEB.summary.includes('enlace'), 'it says the sources come with their link');
  const messages = new Set(COWORK_GUIDE.flatMap(group => group.examples.map(example => example.message)));
  for (const example of COWORK_GUIDE_WEB.examples) {
    assert.ok(example.label.length <= 40, `«${example.label}» fits on a button`);
    assert.ok(!/\[|\]/.test(example.message), 'ready to send, with no blanks to fill');
    assert.ok(/web/i.test(example.message), 'it asks for the web, so the turn searches');
    assert.ok(!messages.has(example.message), 'no example repeats');
  }
  assert.ok(!coworkGuideForModel().includes(COWORK_GUIDE_WEB.title), 'the coordinator loop must not read a promise it cannot keep');
});
